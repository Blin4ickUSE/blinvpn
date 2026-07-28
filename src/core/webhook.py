"""
Модуль для обработки webhook'ов от платежных систем
"""
import os
import logging
import json
from typing import Dict, Any, Optional
from flask import Flask, request, jsonify
from src.api import heleket, platega
from src.database import database
from src.core import core
from src.core import messages as notify_msgs
from src.core import payment_wait

from src.core.admin_error_reporter import setup_service_logging

setup_service_logging('webhook')
logger = logging.getLogger(__name__)

app = Flask(__name__)

def notify_admin_about_deposit(user: Dict, amount: float, method: str, provider: str):
    """Уведомить администратора только о успешном пополнении баланса"""
    core.send_notification_to_admin(
        notify_msgs.build_admin_deposit_notification(
            float(amount),
            user.get('username', 'N/A'),
            user.get('telegram_id', 'N/A'),
            method,
            provider,
        )
    )


def _calc_deposit_bonus(amount: float, method_name: str) -> tuple[float, Optional[str]]:
    """Бонусы при пополнении (auto_discounts). Возвращает (bonus_amount, bonus_name)."""
    bonus_amount = 0.0
    bonus_name = None
    try:
        conn = database.get_db_connection()
        cursor = conn.cursor()
        cursor.execute("""
            SELECT * FROM auto_discounts
            WHERE is_active = 1 AND condition_type = 'payment_amount'
            ORDER BY CAST(condition_value AS REAL) DESC
        """)
        for discount in cursor.fetchall():
            try:
                min_amount = float(discount['condition_value'])
                if amount >= min_amount:
                    if discount['discount_type'] == 'percent':
                        bonus_amount = round(amount * float(discount['discount_value']) / 100, 2)
                    else:
                        bonus_amount = float(discount['discount_value'])
                    bonus_name = discount['name']
                    break
            except (ValueError, TypeError):
                continue
        if bonus_amount == 0:
            cursor.execute("""
                SELECT * FROM auto_discounts
                WHERE is_active = 1 AND condition_type = 'payment_method'
                  AND LOWER(condition_value) = LOWER(?)
            """, (method_name,))
            method_discount = cursor.fetchone()
            if method_discount:
                if method_discount['discount_type'] == 'percent':
                    bonus_amount = round(amount * float(method_discount['discount_value']) / 100, 2)
                else:
                    bonus_amount = float(method_discount['discount_value'])
                bonus_name = method_discount['name']
        conn.close()
    except Exception as e:
        logger.error("Error checking auto-discounts: %s", e)
    return bonus_amount, bonus_name


def credit_deposit_from_payment(
    user_id: int,
    amount: float,
    payment_id: str,
    provider: str,
    method_name: str,
) -> bool:
    """
    Зачислить пополнение на баланс (идемпотентно по payment_id + provider).
    Pending-транзакция при создании платежа обновляется до Success, а не дублируется.
    Возвращает True если зачисление выполнено, False если платёж уже обработан.
    """
    conn = database.get_db_connection()
    cursor = conn.cursor()
    cursor.execute(
        """
        SELECT id, status, amount FROM transactions
        WHERE payment_id = ? AND payment_provider = ?
        ORDER BY id DESC
        LIMIT 1
        """,
        (payment_id, provider),
    )
    existing = cursor.fetchone()
    if existing and str(existing["status"] or "") == "Success":
        conn.close()
        logger.info("%s платёж %s уже обработан", provider, payment_id)
        return False

    pending_tx_id = None
    credit_amount = float(amount)
    if existing and str(existing["status"] or "") == "Pending":
        pending_tx_id = int(existing["id"])
        try:
            pending_amount = float(existing["amount"])
            if pending_amount > 0:
                credit_amount = pending_amount
        except (TypeError, ValueError):
            pass

    # Акция xN к пополнению (только депозит, не покупка)
    promo_credit, promo_bonus, promo = database.calc_deposit_credit(credit_amount)
    if promo and promo.get('uses_limit') is not None:
        if not database.consume_promotion_use(int(promo['id'])):
            promo_credit, promo_bonus, promo = float(credit_amount), 0.0, None
    elif promo:
        database.consume_promotion_use(int(promo['id']))

    if promo and promo_bonus > 0:
        total_amount = float(promo_credit)
        bonus_amount = float(promo_bonus)
        bonus_name = f"x{promo['value']}: {promo.get('name') or 'акция'}"
    else:
        bonus_amount, bonus_name = _calc_deposit_bonus(credit_amount, method_name)
        total_amount = float(credit_amount) + float(bonus_amount)

    database.update_user_balance(user_id, total_amount)

    if pending_tx_id is not None:
        cursor.execute(
            """
            UPDATE transactions
            SET amount = ?, status = 'Success', payment_method = ?, description = NULL
            WHERE id = ?
            """,
            (total_amount, method_name, pending_tx_id),
        )
    else:
        cursor.execute(
            """
            INSERT INTO transactions (user_id, type, amount, status, payment_method, payment_provider, payment_id)
            VALUES (?, 'deposit', ?, 'Success', ?, ?, ?)
            """,
            (user_id, total_amount, method_name, provider, payment_id),
        )
    if bonus_amount > 0:
        cursor.execute("""
            INSERT INTO transactions (user_id, type, amount, status, description)
            VALUES (?, 'bonus', ?, 'Success', ?)
        """, (user_id, bonus_amount, f"Бонус: {bonus_name}"))
    conn.commit()
    conn.close()

    user = database.get_user_by_id(user_id)
    if user:
        core.send_notification_to_user(
            user['telegram_id'],
            notify_msgs.build_balance_deposit_message(float(total_amount)),
        )
        notify_admin_about_deposit(user, credit_amount, method_name, provider)
    logger.info(
        "%s платёж %s успешно обработан: %s₽ для user %s",
        provider,
        payment_id,
        credit_amount,
        user_id,
    )
    payment_wait.notify_payment_completed(int(user_id))
    return True

@app.route('/heleket', methods=['POST'])
def heleket_webhook():
    """Обработка webhook от Heleket"""
    try:
        data = request.json
        
        logger.info(f"Heleket webhook: {data}")
        
        # Проверяем подпись
        if not heleket.heleket_api.verify_webhook_signature(data):
            logger.error("Heleket webhook: неверная подпись")
            return jsonify({'error': 'Invalid signature'}), 401
        
        status = data.get('status', '').lower()
        order_id = data.get('order_id', '')
        uuid = data.get('uuid', '')
        amount = float(data.get('amount', 0))
        
        if status in ('paid', 'paid_over'):
            # Извлекаем user_id из order_id (формат: heleket_{user_id}_{timestamp}_{hex})
            parts = order_id.split('_')
            if len(parts) >= 2 and parts[0] == 'heleket':
                user_id = int(parts[1])
                payment_ref = uuid or order_id
                credit_deposit_from_payment(
                    user_id=user_id,
                    amount=amount,
                    payment_id=payment_ref,
                    provider="Heleket",
                    method_name="Crypto",
                )
            else:
                logger.error(f"Heleket webhook: некорректный order_id {order_id}")
        
        return jsonify({'status': 'ok'}), 200
    except Exception as e:
        logger.error(f"Heleket webhook error: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/platega', methods=['POST'])
def platega_webhook():
    """Обработка webhook от Platega (по документации API)"""
    try:
        data = request.json
        
        logger.info(f"Platega webhook: {data}")
        
        # Проверяем авторизацию по документации: X-MerchantId и X-Secret в заголовках
        received_merchant = request.headers.get('X-MerchantId', '')
        received_secret = request.headers.get('X-Secret', '')
        
        if platega.platega_api.is_configured:
            if (received_merchant != platega.platega_api.merchant_id or 
                received_secret != platega.platega_api.secret_key):
                logger.error("Platega webhook: неверные X-MerchantId или X-Secret")
                return jsonify({'error': 'Unauthorized'}), 401
        
        status = str(data.get('status', '')).upper()
        transaction_id = data.get('id')  # По документации: поле "id"
        payload = data.get('payload', '')
        # По документации: amount приходит в рублях (float), не в копейках!
        amount = float(data.get('amount', 0))
        
        if status == 'CONFIRMED':
            # Извлекаем user_id из payload (формат: platega_{user_id}_{hash})
            user_id = None
            if payload:
                # Убираем возможный префикс platega:
                clean_payload = payload.replace('platega:', '') if payload.startswith('platega:') else payload
                parts = clean_payload.split('_')
                if len(parts) >= 2 and parts[0] == 'platega':
                    try:
                        user_id = int(parts[1])
                    except ValueError:
                        pass
            
            if not user_id:
                logger.error(f"Platega webhook: не удалось извлечь user_id из payload {payload}")
                return jsonify({'status': 'ok'}), 200
            
            # Проверяем, не был ли уже обработан этот платеж
            conn = database.get_db_connection()
            cursor = conn.cursor()
            cursor.execute(
                "SELECT id FROM transactions WHERE payment_id = ? AND payment_provider = 'Platega' AND status = 'Success'",
                (transaction_id,)
            )
            existing = cursor.fetchone()
            conn.close()
            
            if existing:
                logger.info(f"Platega платеж {transaction_id} уже обработан")
                return jsonify({'status': 'ok'}), 200

            # Определяем метод оплаты из данных (по документации)
            payment_method = data.get('paymentMethod', 0)
            # 2=СБП QR, 10=Карты RUB, 11=Карточный, 12=Международный, 13=Крипто
            if payment_method == 2:
                method_name = 'СБП'
            elif payment_method in (10, 11, 12):
                method_name = 'Карта'
            elif payment_method == 13:
                method_name = 'Крипто'
            else:
                method_name = 'Platega'

            credit_deposit_from_payment(
                user_id=user_id,
                amount=amount,
                payment_id=str(transaction_id),
                provider="Platega",
                method_name=method_name,
            )
        
        return jsonify({'status': 'ok'}), 200
    except Exception as e:
        logger.error(f"Platega webhook error: {e}")
        return jsonify({'error': str(e)}), 500




@app.route('/health', methods=['GET'])
def health_check():
    """Проверка здоровья сервиса"""
    return jsonify({
        'status': 'ok',
        'heleket_configured': heleket.heleket_api.is_configured,
        'platega_configured': platega.platega_api.is_configured,
    })

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=int(os.getenv('WEBHOOK_PORT', 5000)))
