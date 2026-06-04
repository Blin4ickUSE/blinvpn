"""
Модуль для обработки webhook'ов от платежных систем
"""
import os
import logging
import json
from typing import Dict, Any, Optional
from flask import Flask, request, jsonify
from src.api import heleket, platega, rollypay, cryptopay
from src.database import database
from src.core import core
from src.core import messages as notify_msgs
from src.core import payment_wait

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
        SELECT id, status FROM transactions
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
    if existing and str(existing["status"] or "") == "Pending":
        pending_tx_id = int(existing["id"])

    bonus_amount, bonus_name = _calc_deposit_bonus(amount, method_name)
    total_amount = amount + bonus_amount
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
        notify_admin_about_deposit(user, amount, method_name, provider)
    logger.info(
        "%s платёж %s успешно обработан: %s₽ для user %s",
        provider,
        payment_id,
        amount,
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
        payer_amount = data.get('payer_amount')
        payer_currency = data.get('payer_currency')
        
        if status in ('paid', 'paid_over'):
            # Извлекаем user_id из order_id (формат: heleket_{user_id}_{timestamp}_{hex})
            parts = order_id.split('_')
            if len(parts) >= 2 and parts[0] == 'heleket':
                user_id = int(parts[1])
                
                payment_ref = uuid or order_id
                # Проверяем, не был ли уже обработан этот платеж (только Success, Pending не считается)
                conn = database.get_db_connection()
                cursor = conn.cursor()
                cursor.execute(
                    "SELECT id FROM transactions WHERE payment_id = ? AND payment_provider = 'Heleket' AND status = 'Success'",
                    (payment_ref,)
                )
                existing = cursor.fetchone()
                conn.close()
                
                if existing:
                    logger.info(f"Heleket платеж {payment_ref} уже обработан")
                    return jsonify({'status': 'ok'}), 200
                
                # Обновляем баланс
                database.update_user_balance(user_id, amount)
                
                # Обновляем существующую Pending-транзакцию или создаём новую
                conn = database.get_db_connection()
                cursor = conn.cursor()
                description = f"Пополнение через Heleket"
                if payer_amount and payer_currency:
                    description += f" ({payer_amount} {payer_currency})"
                cursor.execute(
                    "SELECT id FROM transactions WHERE payment_id = ? AND payment_provider = 'Heleket' AND status = 'Pending'",
                    (payment_ref,)
                )
                pending = cursor.fetchone()
                if pending:
                    cursor.execute("""
                        UPDATE transactions SET status = 'Success', amount = ?, description = ?
                        WHERE id = ?
                    """, (amount, description, pending['id']))
                else:
                    cursor.execute("""
                        INSERT INTO transactions (user_id, type, amount, status, payment_method, payment_provider, payment_id, description)
                        VALUES (?, 'deposit', ?, 'Success', 'Crypto', 'Heleket', ?, ?)
                    """, (user_id, amount, payment_ref, description))
                conn.commit()
                conn.close()
                
                # Уведомление пользователю
                user = database.get_user_by_id(user_id)
                if user:
                    core.send_notification_to_user(
                        user['telegram_id'],
                        notify_msgs.build_balance_deposit_message(float(amount)),
                    )
                    
                    # Уведомление администратору о пополнении
                    notify_admin_about_deposit(user, amount, 'Криптовалюта', 'Heleket')
                
                logger.info(f"Heleket платеж {uuid or order_id} успешно обработан: {amount}₽ для user {user_id}")
                payment_wait.notify_payment_completed(user_id)
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
            
            # Проверяем авто-скидки на пополнение
            bonus_amount = 0
            bonus_name = None
            try:
                conn = database.get_db_connection()
                cursor = conn.cursor()
                
                # Проверяем скидки по сумме пополнения
                cursor.execute("""
                    SELECT * FROM auto_discounts 
                    WHERE is_active = 1 AND condition_type = 'payment_amount'
                    ORDER BY CAST(condition_value AS REAL) DESC
                """)
                discounts = cursor.fetchall()
                
                for discount in discounts:
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
                
                # Проверяем скидки по методу оплаты
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
                logger.error(f"Error checking auto-discounts for Platega: {e}")
            
            # Обновляем баланс (с бонусом если есть)
            total_amount = amount + bonus_amount
            database.update_user_balance(user_id, total_amount)
            
            # Создаем транзакцию
            conn = database.get_db_connection()
            cursor = conn.cursor()
            cursor.execute("""
                INSERT INTO transactions (user_id, type, amount, status, payment_method, payment_provider, payment_id)
                VALUES (?, 'deposit', ?, 'Success', ?, 'Platega', ?)
            """, (user_id, total_amount, method_name, transaction_id))
            
            # Если был бонус, создаем отдельную транзакцию для него
            if bonus_amount > 0:
                cursor.execute("""
                    INSERT INTO transactions (user_id, type, amount, status, description)
                    VALUES (?, 'bonus', ?, 'Success', ?)
                """, (user_id, bonus_amount, f"Бонус: {bonus_name}"))
            
            conn.commit()
            conn.close()
            
            # Уведомление пользователю
            user = database.get_user_by_id(user_id)
            if user:
                core.send_notification_to_user(
                    user['telegram_id'],
                    notify_msgs.build_balance_deposit_message(float(total_amount)),
                )
                
                # Уведомление администратору о пополнении
                notify_admin_about_deposit(user, amount, method_name, 'Platega')
            
            logger.info(f"Platega платеж {transaction_id} успешно обработан: {amount}₽ для user {user_id}")
            payment_wait.notify_payment_completed(user_id)
        
        return jsonify({'status': 'ok'}), 200
    except Exception as e:
        logger.error(f"Platega webhook error: {e}")
        return jsonify({'error': str(e)}), 500


@app.route('/rollypay', methods=['POST'])
def rollypay_webhook():
    """Обработка webhook от RollyPay (СБП). Документация: https://docs.rollypay.io/api/callbacks/"""
    try:
        raw_body = request.get_data(cache=True) or b""
        signature = request.headers.get("X-Signature", "") or request.headers.get("x-signature", "")
        timestamp = request.headers.get("X-Timestamp", "") or request.headers.get("x-timestamp", "")

        if rollypay.rollypay_api.can_verify_webhooks:
            if not rollypay.rollypay_api.verify_webhook_signature(
                raw_body, str(timestamp), str(signature)
            ):
                logger.error("RollyPay webhook: неверная подпись")
                return jsonify({"error": "Invalid signature"}), 403

        try:
            data = json.loads(raw_body.decode("utf-8") or "{}")
        except Exception:
            data = request.json if request.is_json else {}

        logger.info("RollyPay webhook: %s", data)

        event_type = str(data.get("event_type") or "").strip().lower()
        status = str(data.get("status") or "").strip().lower()
        if event_type != "payment.paid" and status != "paid":
            return jsonify({"status": "ok"}), 200

        order_id = str(data.get("order_id") or "")
        payment_id = str(data.get("payment_id") or order_id)
        try:
            amount = float(str(data.get("amount", "0")).replace(",", "."))
        except (ValueError, TypeError):
            amount = 0.0

        user_id = None
        parts = order_id.split("_")
        if len(parts) >= 2 and parts[0] == "rollypay":
            try:
                user_id = int(parts[1])
            except ValueError:
                pass

        if not user_id:
            logger.error("RollyPay webhook: не удалось извлечь user_id из order_id %s", order_id)
            return jsonify({"status": "ok"}), 200

        if amount <= 0:
            logger.error("RollyPay webhook: некорректная сумма %s", data.get("amount"))
            return jsonify({"status": "ok"}), 200

        credit_deposit_from_payment(
            user_id=user_id,
            amount=amount,
            payment_id=payment_id,
            provider="RollyPay",
            method_name="СБП",
        )
        return jsonify({"status": "ok"}), 200
    except Exception as e:
        logger.error("RollyPay webhook error: %s", e)
        return jsonify({"error": str(e)}), 500


def handle_cryptopay_webhook():
    """Shared webhook handler for Crypto Pay API (CryptoBot)."""
    try:
        raw_body = request.get_data(cache=True) or b""
        signature = (
            request.headers.get("crypto-pay-api-signature", "")
            or request.headers.get("Crypto-Pay-API-Signature", "")
            or ""
        )
        signature = str(signature).strip().lower()
        if not cryptopay.cryptopay_api.verify_webhook_signature(raw_body, signature):
            logger.error(
                "CryptoPay webhook: invalid signature (token_configured=%s, sig_present=%s, body_len=%s)",
                cryptopay.cryptopay_api.is_configured,
                bool(signature),
                len(raw_body),
            )
            return jsonify({"error": "Invalid signature"}), 401

        data = request.json if request.is_json else None
        if not isinstance(data, dict):
            try:
                data = json.loads(raw_body.decode("utf-8") or "{}")
            except Exception:
                data = {}

        update_type = str(data.get("update_type") or "").strip().lower().replace("-", "_")

        # CryptoPay may send invoice details in different wrappers.
        invoice = {}
        for key in ("payload", "invoice", "data", "result"):
            value = data.get(key)
            if isinstance(value, dict):
                invoice = value
                break
            if isinstance(value, str):
                try:
                    parsed = json.loads(value)
                    if isinstance(parsed, dict):
                        invoice = parsed
                        break
                except Exception:
                    pass
        if not invoice:
            # Fallback: some versions put invoice fields at root level.
            invoice = data

        payload_str = str(invoice.get("payload") or "")
        invoice_id = invoice.get("invoice_id") or data.get("invoice_id")
        try:
            # For fiat invoices amount can be sent as `fiat_amount` or `paid_fiat_amount`.
            # Keep broad fallbacks for backward compatibility.
            fiat_amount = (
                invoice.get("paid_fiat_amount")
                or invoice.get("fiat_amount")
                or invoice.get("amount")
                or data.get("paid_fiat_amount")
                or data.get("fiat_amount")
                or data.get("amount")
                or 0
            )
            amount = float(str(fiat_amount).replace(",", "."))
        except Exception:
            amount = 0.0

        invoice_status = str(invoice.get("status") or data.get("status") or "").strip().lower()
        logger.info(
            "CryptoPay webhook: update_type=%s status=%s invoice_id=%s payload=%s amount=%s",
            update_type,
            invoice_status,
            invoice_id,
            payload_str[:100],
            amount,
        )

        # Primary event is `invoice_paid`, but some integrations send only status=paid.
        is_paid_event = update_type == "invoice_paid" or invoice_status == "paid"
        if not is_paid_event:
            return jsonify({"status": "ok"}), 200

        user_id = cryptopay.cryptopay_api.extract_user_id_from_payload(payload_str)
        if not user_id:
            logger.error("CryptoPay webhook: cannot extract user_id from payload=%s", payload_str)
            return jsonify({"status": "ok"}), 200

        if not invoice_id:
            invoice_id = payload_str  # fallback uniqueness
        payment_id = f"cryptopay:{invoice_id}"

        # Idempotency: check existing transaction
        conn = database.get_db_connection()
        cursor = conn.cursor()
        cursor.execute(
            "SELECT id, status FROM transactions WHERE payment_id = ? AND payment_provider = 'CryptoPay' ORDER BY id DESC LIMIT 1",
            (payment_id,),
        )
        existing = cursor.fetchone()
        if existing and str(existing["status"]) == "Success":
            conn.close()
            logger.info("CryptoPay invoice %s already processed", payment_id)
            return jsonify({"status": "ok"}), 200

        if amount and amount > 0:
            database.update_user_balance(int(user_id), float(amount))

        if existing:
            cursor.execute(
                """
                UPDATE transactions
                SET status = 'Success',
                    amount = ?,
                    payment_method = 'CryptoPay',
                    description = ?
                WHERE id = ?
                """,
                (float(amount or 0), "Пополнение через CryptoPay (CryptoBot)", int(existing["id"])),
            )
        else:
            cursor.execute(
                """
                INSERT INTO transactions (user_id, type, amount, status, payment_method, payment_provider, payment_id, description)
                VALUES (?, 'deposit', ?, 'Success', 'CryptoPay', 'CryptoPay', ?, ?)
                """,
                (int(user_id), float(amount or 0), payment_id, f"Пополнение через CryptoPay (CryptoBot)"),
            )
        conn.commit()
        conn.close()

        user = database.get_user_by_id(int(user_id))
        if user:
            core.send_notification_to_user(
                user["telegram_id"],
                notify_msgs.build_balance_deposit_message(float(amount or 0)),
            )
            notify_admin_about_deposit(user, float(amount or 0), "CryptoPay", "CryptoPay")

        payment_wait.notify_payment_completed(int(user_id))
        return jsonify({"status": "ok"}), 200
    except Exception as e:
        logger.error("CryptoPay webhook error: %s", e)
        return jsonify({"error": str(e)}), 500


@app.route('/cryptopay', methods=['POST'])
def cryptopay_webhook():
    """Webhook from Crypto Pay API (CryptoBot)."""
    return handle_cryptopay_webhook()

@app.route('/health', methods=['GET'])
def health_check():
    """Проверка здоровья сервиса"""
    return jsonify({
        'status': 'ok',
        'heleket_configured': heleket.heleket_api.is_configured,
        'platega_configured': platega.platega_api.is_configured,
        'rollypay_configured': rollypay.rollypay_api.is_configured,
    })

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=int(os.getenv('WEBHOOK_PORT', 5000)))
