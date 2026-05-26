"""
Ожидание завершения оплаты в miniapp: уведомление после webhook + проверка БД.
"""
from __future__ import annotations

import logging
import os
import threading
import time
from typing import Callable, Optional

from src.database import database

logger = logging.getLogger(__name__)

_lock = threading.Lock()
_user_conditions: dict[int, threading.Condition] = {}


def _get_condition(user_id: int) -> threading.Condition:
    with _lock:
        if user_id not in _user_conditions:
            _user_conditions[user_id] = threading.Condition()
        return _user_conditions[user_id]


def _notify_local(user_id: int) -> None:
    cond = _get_condition(int(user_id))
    with cond:
        cond.notify_all()


def _notify_api_service(user_id: int) -> None:
    """Webhook-контейнер → API-контейнер (разные процессы в Docker)."""
    api_url = (os.getenv('API_INTERNAL_NOTIFY_URL') or '').strip().rstrip('/')
    secret = (os.getenv('INTERNAL_API_SECRET') or '').strip()
    if not api_url or not secret:
        return
    try:
        import requests

        requests.post(
            f'{api_url}/api/internal/payment-completed',
            json={'user_id': int(user_id)},
            headers={'X-Internal-Secret': secret},
            timeout=2,
        )
    except Exception as e:
        logger.debug('payment notify to api failed: %s', e)


def wake_payment_waiters(user_id: int) -> None:
    """Разбудить long-poll в текущем API-процессе."""
    _notify_local(int(user_id))


def notify_payment_completed(user_id: int) -> None:
    """После webhook: разбудить API (локально или через internal HTTP)."""
    wake_payment_waiters(int(user_id))
    _notify_api_service(int(user_id))


def is_payment_completed(
    user_id: int,
    payment_id: Optional[str] = None,
    baseline_balance: Optional[float] = None,
) -> bool:
    """Платёж зачислен: баланс вырос или транзакция Success по payment_id."""
    user = database.get_user_by_id(int(user_id))
    if not user:
        return False

    balance = float(user.get('balance') or 0)
    if baseline_balance is not None and balance > float(baseline_balance) + 0.001:
        return True

    pid = (payment_id or '').strip()
    if not pid:
        return False

    conn = database.get_db_connection()
    try:
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT 1 FROM transactions
            WHERE user_id = ? AND payment_id = ? AND status = 'Success'
            LIMIT 1
            """,
            (int(user_id), pid),
        )
        return cursor.fetchone() is not None
    finally:
        conn.close()


def wait_for_user_payment(
    user_id: int,
    timeout_sec: float,
    check_fn: Callable[[], bool],
) -> bool:
    """Ждать webhook-уведомление или таймаут, периодически проверяя БД."""
    deadline = time.monotonic() + max(0.0, float(timeout_sec))
    cond = _get_condition(int(user_id))

    while True:
        if check_fn():
            return True
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            return check_fn()
        with cond:
            cond.wait(timeout=min(remaining, 1.0))
