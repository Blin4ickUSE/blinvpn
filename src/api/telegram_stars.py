"""
Telegram Stars (XTR): pre_checkout, successful_payment, reconcile.
Используется в API webhook и в aiogram polling (основной путь).
"""
import logging
import os
from typing import Any, Dict, Optional, Tuple

import requests

from src.database import database
from src.core import core
from src.core import messages as notify_msgs

logger = logging.getLogger(__name__)


def parse_user_id_from_payload(payload: str) -> Optional[int]:
    if not payload:
        return None
    try:
        parts = str(payload).split("_")
        if len(parts) >= 2 and parts[0] == "stars":
            return int(parts[1])
    except Exception:
        pass
    return None


def _get_pending_stars_tx(payload: str) -> Optional[Dict[str, Any]]:
    conn = database.get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute(
            """
            SELECT id, user_id, amount, status
            FROM transactions
            WHERE payment_id = ?
              AND payment_provider = 'Telegram'
              AND payment_method = 'Telegram Stars'
            ORDER BY id DESC
            LIMIT 1
            """,
            (payload,),
        )
        row = cursor.fetchone()
        return dict(row) if row else None
    finally:
        conn.close()


def validate_pre_checkout(pcq: Dict[str, Any]) -> Tuple[bool, Optional[str]]:
    """Проверка pre_checkout_query перед answerPreCheckoutQuery."""
    currency = str(pcq.get("currency", "")).upper()
    if currency != "XTR":
        return False, "Поддерживается только оплата Telegram Stars"

    payload = str(pcq.get("invoice_payload", "") or "")
    if not payload:
        return False, "Некорректный платёж"

    try:
        total_amount = int(pcq.get("total_amount") or 0)
    except Exception:
        total_amount = 0
    if total_amount <= 0:
        return False, "Некорректная сумма"

    tx = _get_pending_stars_tx(payload)
    if not tx:
        return False, "Платёж не найден или уже обработан"

    if str(tx.get("status")) == "Success":
        return False, "Этот платёж уже выполнен"

    try:
        expected = int(round(float(tx.get("amount") or 0)))
    except Exception:
        expected = 0
    if expected != total_amount:
        return False, "Сумма не совпадает с заказом"

    user_id = parse_user_id_from_payload(payload)
    if user_id is None or int(tx.get("user_id") or 0) != int(user_id):
        return False, "Некорректный заказ"

    return True, None


def answer_pre_checkout_query(query_id: str, ok: bool, error_message: Optional[str] = None) -> bool:
    bot_token = os.getenv("TELEGRAM_BOT_TOKEN", "")
    if not bot_token or not query_id:
        return False
    body: Dict[str, Any] = {"pre_checkout_query_id": query_id, "ok": ok}
    if not ok and error_message:
        body["error_message"] = str(error_message)[:256]
    try:
        r = requests.post(
            f"https://api.telegram.org/bot{bot_token}/answerPreCheckoutQuery",
            json=body,
            timeout=8,
        )
        if not r.ok:
            logger.warning("answerPreCheckoutQuery HTTP %s: %s", r.status_code, r.text[:300])
            return False
        data = r.json()
        if not data.get("ok"):
            logger.warning("answerPreCheckoutQuery failed: %s", data)
            return False
        return True
    except Exception as e:
        logger.error("answerPreCheckoutQuery error: %s", e)
        return False


def process_pre_checkout_query(pcq: Dict[str, Any]) -> bool:
    query_id = pcq.get("id")
    if not query_id:
        return False
    ok, err = validate_pre_checkout(pcq)
    return answer_pre_checkout_query(str(query_id), ok, err)


def process_successful_payment(successful: Dict[str, Any]) -> bool:
    """Зачислить Stars на баланс (идемпотентно). Возвращает True если обработано."""
    currency = str(successful.get("currency", "")).upper()
    if currency != "XTR":
        return False

    payload = str(successful.get("invoice_payload", "") or "")
    try:
        total_amount = int(successful.get("total_amount") or 0)
    except Exception:
        total_amount = 0
    if not payload or total_amount <= 0:
        return False

    tg_charge_id = str(successful.get("telegram_payment_charge_id", "") or "")
    provider_charge_id = str(successful.get("provider_payment_charge_id", "") or "")
    charge_ref = tg_charge_id or provider_charge_id

    conn = database.get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute(
            """
            SELECT id, status, user_id FROM transactions
            WHERE payment_id = ? AND payment_provider = 'Telegram'
            ORDER BY id DESC LIMIT 1
            """,
            (payload,),
        )
        row = cursor.fetchone()
        if row and str(row["status"]) == "Success":
            return True

        user_id = parse_user_id_from_payload(payload)
        if not user_id and row:
            user_id = int(row["user_id"])
        if not user_id:
            logger.error("Stars payment: cannot resolve user_id for payload=%s", payload)
            return False

        database.update_user_balance(int(user_id), float(total_amount))

        desc = f"Telegram Stars: {charge_ref}" if charge_ref else "Telegram Stars"
        if row:
            cursor.execute(
                """
                UPDATE transactions
                SET status = 'Success', amount = ?, description = ?, payment_method = 'Telegram Stars'
                WHERE id = ?
                """,
                (float(total_amount), desc, row["id"]),
            )
        else:
            cursor.execute(
                """
                INSERT INTO transactions (
                    user_id, type, amount, status, payment_method,
                    payment_provider, payment_id, description
                )
                VALUES (?, 'deposit', ?, 'Success', 'Telegram Stars', 'Telegram', ?, ?)
                """,
                (int(user_id), float(total_amount), payload, desc),
            )
        conn.commit()
    except Exception as e:
        logger.error("process_successful_payment error: %s", e, exc_info=True)
        try:
            conn.rollback()
        except Exception:
            pass
        return False
    finally:
        conn.close()

    user = database.get_user_by_id(int(user_id))
    if user:
        try:
            core.send_notification_to_user(
                user["telegram_id"],
                notify_msgs.build_balance_deposit_message(float(total_amount)),
            )
            core.send_notification_to_admin(
                notify_msgs.build_admin_deposit_notification(
                    float(total_amount),
                    user.get("username", "N/A"),
                    user.get("telegram_id", "N/A"),
                    "Telegram Stars",
                )
            )
        except Exception as e:
            logger.warning("Stars payment notifications failed: %s", e)

    logger.info("Stars payment credited: user_id=%s amount=%s payload=%s", user_id, total_amount, payload)
    return True


def reconcile_pending_stars_for_user(user_id: int) -> None:
    """Заглушка для симметрии с CryptoPay; зачисление — только через successful_payment."""
    pass
