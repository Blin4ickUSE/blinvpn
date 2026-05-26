"""
Модуль для автоматического обновления черного списка.
Обновляется раз в 60 минут из GitHub.
"""
import requests
import logging
import time
import threading
from src.database import database
from src.api import remnawave

logger = logging.getLogger(__name__)

BLACKLIST_URL = "https://raw.githubusercontent.com/Blin4ickUSE/ban-vpn/refs/heads/main/blacklist.txt"
UPDATE_INTERVAL = 3600  # 60 минут
REMOTE_CACHE_TTL_SECONDS = 300  # 5 минут

_remote_blacklist_cache: set[int] = set()
_remote_blacklist_cache_ts = 0.0
_cache_lock = threading.Lock()


def _fetch_remote_blacklist_ids() -> set[int]:
    response = requests.get(BLACKLIST_URL, timeout=10)
    response.raise_for_status()
    ids: set[int] = set()
    for line in response.text.strip().split('\n'):
        line = line.strip()
        if line and line.isdigit():
            ids.add(int(line))
    return ids


def _get_cached_remote_blacklist_ids() -> set[int]:
    global _remote_blacklist_cache, _remote_blacklist_cache_ts
    now = time.time()
    with _cache_lock:
        if now - _remote_blacklist_cache_ts <= REMOTE_CACHE_TTL_SECONDS and _remote_blacklist_cache:
            return set(_remote_blacklist_cache)

    ids = _fetch_remote_blacklist_ids()
    with _cache_lock:
        _remote_blacklist_cache = set(ids)
        _remote_blacklist_cache_ts = now
    return ids


def _get_user_key_uuids(cursor, user_id: int) -> set[str]:
    cursor.execute("""
        SELECT key_uuid FROM vpn_keys
        WHERE user_id = ? AND key_uuid IS NOT NULL
    """, (user_id,))
    uuids: set[str] = set()
    for row in cursor.fetchall():
        key_uuid = row['key_uuid']
        if key_uuid:
            uuids.add(str(key_uuid))
    return uuids


def _disable_remnawave_for_telegram(telegram_id: int, initial_uuids: set[str] | None = None) -> int:
    disabled_count = 0
    remnawave_uuids = set(initial_uuids or set())
    try:
        rw_users = remnawave.remnawave_api.get_user_by_telegram_id(int(telegram_id)) or []
        for rw_user in rw_users:
            rw_uuid = rw_user.uuid if hasattr(rw_user, 'uuid') else (rw_user.get('uuid') if isinstance(rw_user, dict) else None)
            if rw_uuid:
                remnawave_uuids.add(str(rw_uuid))
    except Exception as e:
        logger.warning(f"Failed to fetch Remnawave users for {telegram_id}: {e}")

    for rw_uuid in remnawave_uuids:
        try:
            remnawave.remnawave_api.update_user_sync(
                uuid=rw_uuid,
                status=remnawave.UserStatus.DISABLED
            )
            disabled_count += 1
        except Exception as e:
            logger.warning(f"Failed to disable Remnawave key {rw_uuid} for {telegram_id}: {e}")
    return disabled_count


def enforce_blacklist_for_telegram_id(telegram_id: int) -> dict:
    """
    Принудительно применить blacklisting для конкретного telegram_id:
    - занести в таблицу blacklist
    - забанить пользователя в БД с причиной "Вы в черном списке"
    - заблокировать его ключи в БД и Remnawave
    """
    conn = database.get_db_connection()
    cursor = conn.cursor()
    blocked_keys = 0
    remnawave_uuids: set[str] = set()
    try:
        cursor.execute("INSERT OR IGNORE INTO blacklist (telegram_id) VALUES (?)", (telegram_id,))
        cursor.execute("SELECT id FROM users WHERE telegram_id = ?", (telegram_id,))
        user_row = cursor.fetchone()
        if user_row:
            user_id = user_row['id']
            cursor.execute("""
                UPDATE vpn_keys SET status = 'Banned'
                WHERE user_id = ? AND status != 'Deleted'
            """, (user_id,))
            blocked_keys = cursor.rowcount
            remnawave_uuids = _get_user_key_uuids(cursor, user_id)
            cursor.execute("""
                UPDATE users SET is_banned = 1, ban_reason = 'Вы в черном списке'
                WHERE id = ?
            """, (user_id,))
        conn.commit()
    finally:
        conn.close()

    disabled_remnawave = _disable_remnawave_for_telegram(telegram_id, remnawave_uuids)
    return {'blocked_keys': blocked_keys, 'disabled_remnawave': disabled_remnawave}


def is_telegram_id_blacklisted(telegram_id: int) -> bool:
    """
    Проверить blacklist с fallback к удалённому списку.
    Если ID найден в удалённом списке — сразу применяем блокировку.
    """
    conn = database.get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("SELECT 1 FROM blacklist WHERE telegram_id = ?", (telegram_id,))
        if cursor.fetchone():
            return True
    finally:
        conn.close()

    try:
        remote_ids = _get_cached_remote_blacklist_ids()
    except Exception as e:
        logger.warning(f"Failed to fetch remote blacklist for instant check ({telegram_id}): {e}")
        return False

    if telegram_id not in remote_ids:
        return False

    result = enforce_blacklist_for_telegram_id(telegram_id)
    logger.info(
        f"Instant blacklist enforcement for {telegram_id}: "
        f"blocked {result['blocked_keys']} DB keys, disabled {result['disabled_remnawave']} Remnawave keys"
    )
    return True

def update_blacklist():
    """Обновить blacklist и реально заблокировать пользователей в Remnawave."""
    try:
        telegram_ids = sorted(_fetch_remote_blacklist_ids())
        
        # Обновляем БД
        conn = database.get_db_connection()
        cursor = conn.cursor()
        
        # Очищаем старый список
        cursor.execute("DELETE FROM blacklist")
        
        # Добавляем новые записи
        for telegram_id in telegram_ids:
            try:
                cursor.execute("INSERT OR IGNORE INTO blacklist (telegram_id) VALUES (?)", (telegram_id,))
            except Exception as e:
                logger.warning(f"Failed to add {telegram_id} to blacklist: {e}")
        
        # Блокируем VPN ключи для пользователей из blacklist в БД и Remnawave
        blocked_keys = 0
        blocked_remnawave = 0
        for telegram_id in telegram_ids:
            try:
                result = enforce_blacklist_for_telegram_id(telegram_id)
                blocked_keys += result['blocked_keys']
                blocked_remnawave += result['disabled_remnawave']
            except Exception as e:
                logger.warning(f"Failed to block keys for {telegram_id}: {e}")
        
        conn.commit()
        conn.close()
        
        logger.info(
            f"Blacklist updated: {len(telegram_ids)} entries, "
            f"blocked {blocked_keys} DB keys, disabled {blocked_remnawave} Remnawave keys"
        )
        return len(telegram_ids)
    except Exception as e:
        logger.error(f"Failed to update blacklist: {e}")
        return 0

def blacklist_updater_worker():
    """Рабочий поток для обновления черного списка"""
    while True:
        try:
            update_blacklist()
        except Exception as e:
            logger.error(f"Blacklist updater error: {e}")
        
        time.sleep(UPDATE_INTERVAL)

def start_blacklist_updater():
    """Запустить обновление черного списка в отдельном потоке"""
    # Первое обновление сразу
    update_blacklist()
    
    # Запускаем в отдельном потоке
    thread = threading.Thread(target=blacklist_updater_worker, daemon=True)
    thread.start()
    logger.info("Blacklist updater started")

