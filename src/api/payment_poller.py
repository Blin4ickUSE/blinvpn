"""
Модуль перестрахования платежей.

Если вебхук по какой-то причине не дошёл — раз в 5 минут на протяжении
часа проверяем статус каждого Pending-платежа через API платёжной системы
и зачисляем баланс при необходимости.

Защита от двойного зачисления обеспечивается функцией credit_deposit_from_payment
из webhook.py (идемпотентна по паре payment_id + provider).

Использование (в server.py или точке входа):
    from src.api.payment_poller import start_payment_poller
    start_payment_poller()
"""

from __future__ import annotations

import logging
import threading
from datetime import datetime, timezone
from typing import Any, Dict, Optional

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
        dt = datetime.fromisoformat(str(created_at_str).replace("Z", "+00:00"))
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
              AND created_at >= datetime('now', ?)
            ORDER BY id DESC
            """,
            (f"-{MAX_PENDING_AGE_SECONDS} seconds",),
        )
        rows = cursor.fetchall() or []
        return [dict(r) for r in rows]
    except Exception as e:
        logger.error("payment_poller: ошибка получения Pending-транзакций: %s", e)
        return []
    finally:
        conn.close()


def _is_already_credited(payment_id: str, provider: str) -> bool:
    """Проверить, существует ли уже успешная транзакция с этим payment_id."""
    from src.database import database

    conn = database.get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute(
            "SELECT id FROM transactions WHERE payment_id = ? AND payment_provider = ? AND status = 'Success'",
            (payment_id, provider),
        )
        return cursor.fetchone() is not None
    except Exception:
        return False
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Проверка по провайдерам
# ---------------------------------------------------------------------------

def _check_cryptopay(tx: Dict[str, Any]) -> None:
    """Проверить и при необходимости зачислить CryptoPay-платёж."""
    from src.api import cryptopay
    from src.core.webhook import credit_deposit_from_payment  # type: ignore

    payment_id = str(tx.get("payment_id") or "")
    if not payment_id.startswith("cryptopay:"):
        return

    result = cryptopay.cryptopay_api.check_payment_status(payment_id)
    if not result or not result.get("is_paid"):
        return

    amount = float(result.get("amount") or tx.get("amount") or 0)
    if amount <= 0:
        return

    user_id = int(tx["user_id"])

    # Извлекаем user_id из payload как дополнительную проверку
    payload_str = str(result.get("payload") or "")
    uid_from_payload = cryptopay.cryptopay_api.extract_user_id_from_payload(payload_str)
    if uid_from_payload and uid_from_payload != user_id:
        logger.warning(
            "payment_poller CryptoPay: user_id из БД (%s) не совпадает с payload (%s), пропускаем",
            user_id, uid_from_payload,
        )
        return

    logger.info(
        "payment_poller: CryptoPay платёж %s оплачен (%.2f₽), зачисляем user %s",
        payment_id, amount, user_id,
    )
    credit_deposit_from_payment(
        user_id=user_id,
        amount=amount,
        payment_id=payment_id,
        provider="CryptoPay",
        method_name="CryptoPay",
    )


def _check_heleket(tx: Dict[str, Any]) -> None:
    """Проверить и при необходимости зачислить Heleket-платёж."""
    from src.api import heleket
    from src.core.webhook import credit_deposit_from_payment  # type: ignore

    payment_id = str(tx.get("payment_id") or "")
    # payment_id хранится как uuid или order_id
    # Если это uuid (32 hex символа с дефисами) — ищем по uuid, иначе по order_id
    is_uuid = len(payment_id) == 36 and payment_id.count("-") == 4

    result = heleket.heleket_api.check_payment_status(
        uuid=payment_id if is_uuid else None,
        order_id=None if is_uuid else payment_id,
    )
    if not result or not result.get("is_paid"):
        return

    amount = float(result.get("amount") or tx.get("amount") or 0)
    if amount <= 0:
        return

    user_id = int(tx["user_id"])
    logger.info(
        "payment_poller: Heleket платёж %s оплачен (%.2f₽), зачисляем user %s",
        payment_id, amount, user_id,
    )
    credit_deposit_from_payment(
        user_id=user_id,
        amount=amount,
        payment_id=payment_id,
        provider="Heleket",
        method_name="Crypto",
    )


def _check_platega(tx: Dict[str, Any]) -> None:
    """Проверить и при необходимости зачислить Platega-платёж."""
    from src.api import platega
    from src.core.webhook import credit_deposit_from_payment  # type: ignore

    payment_id = str(tx.get("payment_id") or "")
    if not payment_id:
        return

    result = platega.platega_api.check_payment_status(payment_id)
    if not result or not result.get("is_paid"):
        return

    amount = float(result.get("amount") or tx.get("amount") or 0)
    if amount <= 0:
        return

    # Определяем метод из payment_method в транзакции
    method_name = str(tx.get("payment_method") or "Platega")

    user_id = int(tx["user_id"])
    logger.info(
        "payment_poller: Platega платёж %s подтверждён (%.2f₽), зачисляем user %s",
        payment_id, amount, user_id,
    )
    credit_deposit_from_payment(
        user_id=user_id,
        amount=amount,
        payment_id=payment_id,
        provider="Platega",
        method_name=method_name,
    )


def _check_rollypay(tx: Dict[str, Any]) -> None:
    """Проверить и при необходимости зачислить RollyPay-платёж."""
    from src.api import rollypay
    from src.core.webhook import credit_deposit_from_payment  # type: ignore

    payment_id = str(tx.get("payment_id") or "")
    if not payment_id:
        return

    result = rollypay.rollypay_api.check_payment_status(payment_id)
    if not result or not result.get("is_paid"):
        return

    amount = float(result.get("amount") or tx.get("amount") or 0)
    if amount <= 0:
        return

    user_id = int(tx["user_id"])
    logger.info(
        "payment_poller: RollyPay платёж %s оплачен (%.2f₽), зачисляем user %s",
        payment_id, amount, user_id,
    )
    credit_deposit_from_payment(
        user_id=user_id,
        amount=amount,
        payment_id=payment_id,
        provider="RollyPay",
        method_name="СБП",
    )


# ---------------------------------------------------------------------------
# Основной цикл опроса
# ---------------------------------------------------------------------------

_CHECKER_MAP = {
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

        # Быстрая проверка — вдруг уже зачислилось пока мы итерировались
        if _is_already_credited(payment_id, provider):
            continue

        checker = _CHECKER_MAP.get(provider)
        if not checker:
            continue

        try:
            checker(tx)
        except Exception as e:
            logger.error(
                "payment_poller: ошибка при проверке %s платёжа %s: %s",
                provider, payment_id, e,
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
        from apscheduler.schedulers.background import BackgroundScheduler  # type: ignore

        scheduler = BackgroundScheduler()
        scheduler.add_job(
            _poll_once,
            "interval",
            seconds=POLL_INTERVAL_SECONDS,
            id="payment_poller",
            name="Payment fallback poller",
            replace_existing=True,
            max_instances=1,  # не запускать новый если предыдущий ещё идёт
        )
        scheduler.start()
        logger.info(
            "payment_poller запущен через APScheduler (интервал %d сек, горизонт %d сек)",
            POLL_INTERVAL_SECONDS,
            MAX_PENDING_AGE_SECONDS,
        )
    except ImportError:
        # Fallback на threading.Timer
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
            _schedule_timer()  # перезапустить после выполнения

    t = threading.Timer(POLL_INTERVAL_SECONDS, _run)
    t.daemon = True
    t.start()
