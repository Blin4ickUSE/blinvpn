"""
Модуль перестрахования платежей.

Если вебхук по какой-то причине не дошёл — раз в 5 минут на протяжении
часа проверяем статус каждого Pending-платежа через API платёжной системы
и зачисляем баланс при необходимости.

Защита от двойного зачисления обеспечивается функцией credit_deposit_from_payment
из webhook.py (идемпотентна по паре payment_id + provider, учитывает Pending).

Использование (в server.py или точке входа):
    from src.api.payment_poller import start_payment_poller
    start_payment_poller()
"""

from __future__ import annotations

import logging
import threading
from datetime import datetime, timezone
from typing import Any, Callable, Dict, Optional

logger = logging.getLogger(__name__)

# Интервал между проверками (сек) и максимальный возраст Pending-платежа (сек)
POLL_INTERVAL_SECONDS = 5 * 60       # 5 минут
MAX_PENDING_AGE_SECONDS = 60 * 60    # 1 час

_poller_started = False
_poller_lock = threading.Lock()


# ---------------------------------------------------------------------------
# Вспомогательные функции
# ---------------------------------------------------------------------------

def _seconds_since_created(created_at_str: Optional[str]) -> float:
    """Вернуть количество секунд с момента создания транзакции."""
    if not created_at_str:
        return 0.0
    try:
        raw = str(created_at_str).strip()
        if raw.endswith("Z"):
            raw = raw[:-1] + "+00:00"
        dt = datetime.fromisoformat(raw)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return (datetime.now(timezone.utc) - dt).total_seconds()
    except Exception:
        return 0.0


def _get_pending_transactions() -> list[Dict[str, Any]]:
    """Получить все Pending-транзакции не старше MAX_PENDING_AGE_SECONDS."""
    from src.database import database  # локальный импорт во избежание циклов

    conn = database.get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute(
            """
            SELECT id, user_id, payment_id, payment_provider, payment_method,
                   amount, status, created_at
            FROM transactions
            WHERE status = 'Pending'
              AND payment_provider IN ('CryptoPay', 'Heleket', 'Platega', 'RollyPay')
              AND payment_id IS NOT NULL
              AND TRIM(payment_id) != ''
            ORDER BY id DESC
            """
        )
        rows = cursor.fetchall() or []
        pending: list[Dict[str, Any]] = []
        for row in rows:
            tx = dict(row)
            age = _seconds_since_created(tx.get("created_at"))
            if age <= MAX_PENDING_AGE_SECONDS:
                pending.append(tx)
        return pending
    except Exception as e:
        logger.error("payment_poller: ошибка получения Pending-транзакций: %s", e)
        return []
    finally:
        conn.close()


def _is_already_credited(payment_id: str, provider: str) -> bool:
    """Проверить, существует ли уже успешная транзакция с этим payment_id."""
    from src.database import database

    if not payment_id or not provider:
        return False

    conn = database.get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute(
            """
            SELECT id FROM transactions
            WHERE payment_id = ? AND payment_provider = ? AND status = 'Success'
            """,
            (payment_id, provider),
        )
        return cursor.fetchone() is not None
    except Exception:
        return False
    finally:
        conn.close()


def _credit_if_paid(
    tx: Dict[str, Any],
    *,
    provider: str,
    method_name: str,
    amount: float,
    log_label: str,
) -> None:
    """Зачислить платёж, если сумма валидна и платёж ещё не зачислен."""
    from src.core.webhook import credit_deposit_from_payment  # type: ignore

    payment_id = str(tx.get("payment_id") or "")
    if amount <= 0:
        logger.warning(
            "payment_poller %s: некорректная сумма %.2f для %s, пропускаем",
            provider,
            amount,
            payment_id,
        )
        return

    user_id = int(tx["user_id"])
    logger.info(
        "payment_poller: %s платёж %s оплачен (%.2f₽), зачисляем user %s",
        log_label,
        payment_id,
        amount,
        user_id,
    )
    credit_deposit_from_payment(
        user_id=user_id,
        amount=amount,
        payment_id=payment_id,
        provider=provider,
        method_name=method_name,
    )


# ---------------------------------------------------------------------------
# Проверка по провайдерам
# ---------------------------------------------------------------------------

def _check_cryptopay(tx: Dict[str, Any]) -> None:
    """Проверить и при необходимости зачислить CryptoPay-платёж."""
    from src.api import cryptopay

    payment_id = str(tx.get("payment_id") or "")
    if not payment_id.startswith("cryptopay:"):
        return

    result = cryptopay.cryptopay_api.check_payment_status(payment_id)
    if not result or not result.get("is_paid"):
        return

    amount = float(result.get("amount") or tx.get("amount") or 0)

    payload_str = str(result.get("payload") or "")
    uid_from_payload = cryptopay.cryptopay_api.extract_user_id_from_payload(payload_str)
    user_id = int(tx["user_id"])
    if uid_from_payload and uid_from_payload != user_id:
        logger.warning(
            "payment_poller CryptoPay: user_id из БД (%s) не совпадает с payload (%s), пропускаем",
            user_id,
            uid_from_payload,
        )
        return

    _credit_if_paid(tx, provider="CryptoPay", method_name="CryptoPay", amount=amount, log_label="CryptoPay")


def _check_heleket(tx: Dict[str, Any]) -> None:
    """Проверить и при необходимости зачислить Heleket-платёж."""
    from src.api import heleket

    payment_id = str(tx.get("payment_id") or "")
    if not payment_id:
        return

    is_uuid = len(payment_id) == 36 and payment_id.count("-") == 4
    result = heleket.heleket_api.check_payment_status(
        uuid=payment_id if is_uuid else None,
        order_id=None if is_uuid else payment_id,
    )
    if (not result or not result.get("is_paid")) and is_uuid:
        result = heleket.heleket_api.check_payment_status(order_id=payment_id)
    if (not result or not result.get("is_paid")) and not is_uuid:
        result = heleket.heleket_api.check_payment_status(uuid=payment_id)

    if not result or not result.get("is_paid"):
        return

    amount = float(result.get("amount") or tx.get("amount") or 0)
    _credit_if_paid(tx, provider="Heleket", method_name="Crypto", amount=amount, log_label="Heleket")


def _check_platega(tx: Dict[str, Any]) -> None:
    """Проверить и при необходимости зачислить Platega-платёж."""
    from src.api import platega

    payment_id = str(tx.get("payment_id") or "")
    if not payment_id:
        return

    result = platega.platega_api.check_payment_status(payment_id)
    if not result or not result.get("is_paid"):
        return

    amount = float(result.get("amount") or tx.get("amount") or 0)
    method_name = str(tx.get("payment_method") or "Platega")
    _credit_if_paid(tx, provider="Platega", method_name=method_name, amount=amount, log_label="Platega")


def _check_rollypay(tx: Dict[str, Any]) -> None:
    """Проверить и при необходимости зачислить RollyPay-платёж (legacy)."""
    from src.api import rollypay

    payment_id = str(tx.get("payment_id") or "")
    if not payment_id:
        return

    result = rollypay.rollypay_api.check_payment_status(payment_id)
    if not result or not result.get("is_paid"):
        return

    amount = float(result.get("amount") or tx.get("amount") or 0)
    _credit_if_paid(tx, provider="RollyPay", method_name="СБП", amount=amount, log_label="RollyPay")


# ---------------------------------------------------------------------------
# Основной цикл опроса
# ---------------------------------------------------------------------------

_CHECKER_MAP: Dict[str, Callable[[Dict[str, Any]], None]] = {
    "CryptoPay": _check_cryptopay,
    "Heleket": _check_heleket,
    "Platega": _check_platega,
    "RollyPay": _check_rollypay,
}


def _poll_once() -> None:
    """Один обход всех Pending-транзакций."""
    pending = _get_pending_transactions()
    if not pending:
        return

    logger.info("payment_poller: проверяем %d Pending-транзакций", len(pending))
    for tx in pending:
        provider = str(tx.get("payment_provider") or "")
        payment_id = str(tx.get("payment_id") or "")

        if _is_already_credited(payment_id, provider):
            continue

        checker = _CHECKER_MAP.get(provider)
        if not checker:
            logger.debug("payment_poller: нет обработчика для провайдера %s", provider)
            continue

        try:
            checker(tx)
        except Exception as e:
            logger.error(
                "payment_poller: ошибка при проверке %s платёжа %s: %s",
                provider,
                payment_id,
                e,
                exc_info=True,
            )


# ---------------------------------------------------------------------------
# Запуск планировщика
# ---------------------------------------------------------------------------

def start_payment_poller() -> None:
    """
    Запустить фоновый поллер платежей.
    Вызывается один раз при старте приложения.
    Использует APScheduler если доступен, иначе threading.Timer.
    """
    global _poller_started
    with _poller_lock:
        if _poller_started:
            logger.debug("payment_poller уже запущен, пропускаем")
            return
        _poller_started = True

    try:
        _poll_once()
    except Exception as e:
        logger.error("payment_poller: ошибка при стартовой проверке: %s", e)

    try:
        from apscheduler.schedulers.background import BackgroundScheduler  # type: ignore

        scheduler = BackgroundScheduler()
        scheduler.add_job(
            _poll_once,
            "interval",
            seconds=POLL_INTERVAL_SECONDS,
            id="payment_poller",
            name="Payment fallback poller",
            replace_existing=True,
            max_instances=1,
            coalesce=True,
            misfire_grace_time=POLL_INTERVAL_SECONDS,
        )
        scheduler.start()
        logger.info(
            "payment_poller запущен через APScheduler (интервал %d сек, горизонт %d сек)",
            POLL_INTERVAL_SECONDS,
            MAX_PENDING_AGE_SECONDS,
        )
    except ImportError:
        logger.warning(
            "APScheduler не найден, используем threading.Timer для payment_poller"
        )
        _schedule_timer()


def _schedule_timer() -> None:
    """Запустить повторяющийся таймер через threading (fallback без APScheduler)."""
    def _run() -> None:
        try:
            _poll_once()
        except Exception as e:
            logger.error("payment_poller (_run): %s", e)
        finally:
            _schedule_timer()

    t = threading.Timer(POLL_INTERVAL_SECONDS, _run)
    t.daemon = True
    t.start()
