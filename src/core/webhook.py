"""
Модуль для обработки webhook'ов от платежных систем
"""
import os
import logging
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
    """Уведомить в топик форума о успешном пополнении баланса"""
    core.send_to_forum_topic(
        notify_msgs.build_admin_deposit_notification(
            float(amount),
            user.get('username', 'N/A'),
            user.get('telegram_id', 'N/A'),
            method,
            provider,
        ),
        core.NOTIFY_THREAD_DEPOSITS
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


def _webhook_log_summary(provider: str, data: Any) -> None:
    """Логировать вебхук без полного тела (PII/платёжные детали)."""
    if not isinstance(data, dict):
        logger.info("%s webhook: non-dict payload", provider)
        return
    logger.info(
        "%s webhook: status=%s id=%s order_id=%s uuid=%s",
        provider,
        data.get('status') or data.get('Status'),
        data.get('id'),
        data.get('order_id'),
        data.get('uuid'),
    )


def credit_deposit_from_payment(
    user_id: int,
    amount: float,
    payment_id: str,
    provider: str,
    method_name: str,
    *,
    require_pending: bool = True,
) -> bool:
    """
    Зачислить пополнение на баланс (идемпотентно по payment_id + provider).

    Атомарно захватывает Pending → Processing, затем Success.
    user_id и сумма берутся из Pending-транзакции (не из недоверенного payload).
    Возвращает True если зачисление выполнено, False если уже обработан / нет Pending.
    """
    if not payment_id or not provider:
        logger.error("credit_deposit_from_payment: missing payment_id/provider")
        return False

    conn = database.get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("BEGIN IMMEDIATE")
        cursor.execute(
            """
            SELECT id, user_id, status, amount FROM transactions
            WHERE payment_id = ? AND payment_provider = ?
            ORDER BY id DESC
            LIMIT 1
            """,
            (str(payment_id), provider),
        )
        existing = cursor.fetchone()

        if existing and str(existing["status"] or "") in ("Success", "Processing"):
            conn.commit()
            logger.info("%s платёж %s уже обработан (status=%s)", provider, payment_id, existing["status"])
            return False

        pending_tx_id = None
        credit_user_id = int(user_id)
        credit_amount = float(amount)

        if existing and str(existing["status"] or "") == "Pending":
            cursor.execute(
                """
                UPDATE transactions
                SET status = 'Processing'
                WHERE id = ? AND status = 'Pending'
                """,
                (int(existing["id"]),),
            )
            if cursor.rowcount != 1:
                conn.commit()
                logger.info("%s платёж %s: race — уже захвачен другим воркером", provider, payment_id)
                return False
            pending_tx_id = int(existing["id"])
            credit_user_id = int(existing["user_id"])
            try:
                pending_amount = float(existing["amount"])
                if pending_amount > 0:
                    credit_amount = pending_amount
            except (TypeError, ValueError):
                pass
        elif require_pending:
            conn.commit()
            logger.error(
                "%s платёж %s: нет Pending-транзакции — отказ (user_id/amount из webhook не доверяем)",
                provider,
                payment_id,
            )
            return False
        else:
            # Legacy path: insert Success напрямую (не используется вебхуками)
            if credit_amount <= 0 or credit_user_id <= 0:
                conn.rollback()
                return False

        if credit_amount <= 0 or credit_user_id <= 0:
            if pending_tx_id is not None:
                cursor.execute(
                    "UPDATE transactions SET status = 'Pending' WHERE id = ? AND status = 'Processing'",
                    (pending_tx_id,),
                )
            conn.commit()
            logger.error("%s платёж %s: некорректные user/amount", provider, payment_id)
            return False

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

        # Баланс в той же транзакции SQLite
        cursor.execute(
            "UPDATE users SET balance = balance + ? WHERE id = ?",
            (total_amount, credit_user_id),
        )
        if cursor.rowcount != 1:
            conn.rollback()
            logger.error("%s платёж %s: user %s не найден", provider, payment_id, credit_user_id)
            return False

        if pending_tx_id is not None:
            cursor.execute(
                """
                UPDATE transactions
                SET amount = ?, status = 'Success', payment_method = ?, description = NULL
                WHERE id = ? AND status = 'Processing'
                """,
                (total_amount, method_name, pending_tx_id),
            )
            if cursor.rowcount != 1:
                conn.rollback()
                logger.error("%s платёж %s: не удалось финализировать Processing", provider, payment_id)
                return False
        else:
            cursor.execute(
                """
                INSERT INTO transactions (user_id, type, amount, status, payment_method, payment_provider, payment_id)
                VALUES (?, 'deposit', ?, 'Success', ?, ?, ?)
                """,
                (credit_user_id, total_amount, method_name, provider, str(payment_id)),
            )
        if bonus_amount > 0:
            cursor.execute("""
                INSERT INTO transactions (user_id, type, amount, status, description)
                VALUES (?, 'bonus', ?, 'Success', ?)
            """, (credit_user_id, bonus_amount, f"Бонус: {bonus_name}"))
        conn.commit()
    except Exception:
        try:
            conn.rollback()
        except Exception:
            pass
        raise
    finally:
        conn.close()

    user = database.get_user_by_id(credit_user_id)
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
        credit_user_id,
    )
    payment_wait.notify_payment_completed(int(credit_user_id))
    return True


def _resolve_pending_user(
    payment_ids: list[str],
    provider: str,
) -> tuple[Optional[int], Optional[str], Optional[float]]:
    """Найти Pending по одному из payment_id. Возвращает (user_id, matched_payment_id, amount)."""
    conn = database.get_db_connection()
    cursor = conn.cursor()
    try:
        for pid in payment_ids:
            if not pid:
                continue
            cursor.execute(
                """
                SELECT user_id, payment_id, amount, status FROM transactions
                WHERE payment_id = ? AND payment_provider = ?
                ORDER BY id DESC LIMIT 1
                """,
                (str(pid), provider),
            )
            row = cursor.fetchone()
            if row:
                return int(row["user_id"]), str(row["payment_id"]), float(row["amount"] or 0)
        return None, None, None
    finally:
        conn.close()


@app.route('/heleket', methods=['POST'])
def heleket_webhook():
    """Обработка webhook от Heleket"""
    try:
        if not heleket.heleket_api.is_configured:
            logger.error("Heleket webhook: провайдер не настроен — отказ")
            return jsonify({'error': 'Provider not configured'}), 503

        data = request.json
        _webhook_log_summary("Heleket", data)

        if not heleket.heleket_api.verify_webhook_signature(data):
            logger.error("Heleket webhook: неверная подпись")
            return jsonify({'error': 'Invalid signature'}), 401

        status = str(data.get('status', '') or '').lower()
        order_id = str(data.get('order_id', '') or '')
        uuid = str(data.get('uuid', '') or '')

        if status in ('paid', 'paid_over'):
            user_id, payment_ref, amount = _resolve_pending_user(
                [uuid, order_id],
                "Heleket",
            )
            if not payment_ref or not user_id:
                logger.error(
                    "Heleket webhook: нет Pending для uuid=%s order_id=%s",
                    uuid,
                    order_id,
                )
                return jsonify({'status': 'ok'}), 200

            credit_deposit_from_payment(
                user_id=user_id,
                amount=float(amount or 0),
                payment_id=payment_ref,
                provider="Heleket",
                method_name="Crypto",
            )

        return jsonify({'status': 'ok'}), 200
    except Exception as e:
        logger.error("Heleket webhook error: %s", e)
        return jsonify({'error': 'Internal error'}), 500


@app.route('/platega', methods=['POST'])
def platega_webhook():
    """Обработка webhook от Platega (по документации API)"""
    try:
        if not platega.platega_api.is_configured:
            logger.error("Platega webhook: провайдер не настроен — отказ")
            return jsonify({'error': 'Provider not configured'}), 503

        data = request.json
        _webhook_log_summary("Platega", data)

        headers = {
            'X-MerchantId': request.headers.get('X-MerchantId', ''),
            'X-Secret': request.headers.get('X-Secret', ''),
        }
        if not platega.platega_api.verify_webhook(headers, data or {}):
            logger.error("Platega webhook: неверные X-MerchantId или X-Secret")
            return jsonify({'error': 'Unauthorized'}), 401

        status = str(data.get('status', '')).upper()
        transaction_id = data.get('id')

        if status == 'CONFIRMED':
            if not transaction_id:
                logger.error("Platega webhook: нет id транзакции")
                return jsonify({'status': 'ok'}), 200

            user_id, payment_ref, amount = _resolve_pending_user(
                [str(transaction_id)],
                "Platega",
            )
            if not payment_ref or not user_id:
                logger.error(
                    "Platega webhook: нет Pending для payment_id=%s",
                    transaction_id,
                )
                return jsonify({'status': 'ok'}), 200

            payment_method = data.get('paymentMethod', 0)
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
                amount=float(amount or 0),
                payment_id=payment_ref,
                provider="Platega",
                method_name=method_name,
            )

        return jsonify({'status': 'ok'}), 200
    except Exception as e:
        logger.error("Platega webhook error: %s", e)
        return jsonify({'error': 'Internal error'}), 500


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
