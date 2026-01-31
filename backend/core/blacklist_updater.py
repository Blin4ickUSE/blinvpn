"""
Модуль для автоматического обновления черного списка
Обновляется раз в 60 минут из GitHub
"""
import os
import requests
import logging
import time
import threading
from backend.database import database

logger = logging.getLogger(__name__)

BLACKLIST_URL = "https://raw.githubusercontent.com/Blin4ickUSE/ban-vpn/refs/heads/main/blacklist.txt"
UPDATE_INTERVAL = 3600  # 60 минут

def update_blacklist():
    """Обновить черный список из GitHub и заблокировать VPN ключи забаненных пользователей"""
    try:
        response = requests.get(BLACKLIST_URL, timeout=10)
        response.raise_for_status()
        
        telegram_ids = []
        for line in response.text.strip().split('\n'):
            line = line.strip()
            if line and line.isdigit():
                telegram_ids.append(int(line))
        
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
        
        # Блокируем VPN ключи для пользователей из blacklist
        blocked_keys = 0
        for telegram_id in telegram_ids:
            try:
                # Получаем user_id по telegram_id
                cursor.execute("SELECT id FROM users WHERE telegram_id = ?", (telegram_id,))
                user_row = cursor.fetchone()
                if user_row:
                    user_id = user_row['id']
                    # Блокируем все активные ключи пользователя
                    cursor.execute("""
                        UPDATE vpn_keys SET status = 'Banned' 
                        WHERE user_id = ? AND status = 'Active'
                    """, (user_id,))
                    blocked_keys += cursor.rowcount
                    # Помечаем пользователя как забаненного
                    cursor.execute("""
                        UPDATE users SET is_banned = 1, ban_reason = 'В черном списке' 
                        WHERE id = ?
                    """, (user_id,))
            except Exception as e:
                logger.warning(f"Failed to block keys for {telegram_id}: {e}")
        
        conn.commit()
        conn.close()
        
        logger.info(f"Blacklist updated: {len(telegram_ids)} entries, blocked {blocked_keys} keys")
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

