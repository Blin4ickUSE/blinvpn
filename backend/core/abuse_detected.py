"""
Алгоритм определения злоупотреблений трафиком
Контроль только по трафику: более 80 ГБ за сутки = бан ключа
HWID и IP лимиты отключены
"""
import logging
import os
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Any
from backend.database import database

logger = logging.getLogger(__name__)

# Константы
# HWID и IP лимиты отключены - контроль только по трафику
MAX_DAILY_TRAFFIC_GB = 80  # Лимит трафика за сутки
MAX_BANNED_KEYS_FOR_BAN = 3  # Авто-бан пользователя после 3 забаненных ключей


def notify_admin_about_abuse(user_id: int, telegram_id: int, username: str, 
                             abuse_type: str, details: str):
    """Уведомить администратора об abuse"""
    try:
        from backend.core import core
        
        message = (
            f"🚨 <b>Обнаружено злоупотребление!</b>\n\n"
            f"👤 Пользователь: @{username}\n"
            f"🆔 Telegram ID: {telegram_id}\n"
            f"📊 User ID: {user_id}\n"
            f"⚠️ Тип: {abuse_type}\n"
            f"📝 Детали: {details}"
        )
        
        core.send_notification_to_admin(message)
        logger.warning(f"Abuse notification sent for user {user_id}: {abuse_type}")
    except Exception as e:
        logger.error(f"Failed to send abuse notification: {e}")


def check_device_limit(user_id: int, hwid: str, ip_address: str = None) -> Dict[str, Any]:
    """
    Проверка ограничения на одновременное использование устройств
    ОТКЛЮЧЕНО: теперь контроль только по трафику (>80 ГБ/сутки)
    Всегда возвращает allowed=True
    """
    # HWID и IP лимиты отключены - контроль только по трафику
    return {'allowed': True}

def check_traffic_abuse(user_id: int, vpn_key_id: int, traffic_bytes: float) -> Dict[str, Any]:
    """
    Проверка злоупотребления трафиком
    Если использование > 80 ГБ за сутки - блокировка
    """
    conn = database.get_db_connection()
    cursor = conn.cursor()
    
    try:
        today = datetime.now().date()
        traffic_gb = traffic_bytes / (1024 ** 3)  # Конвертируем в ГБ
        
        # Получаем трафик за сегодня
        cursor.execute("""
            SELECT traffic_bytes FROM traffic_stats
            WHERE device_id = ? AND date = ?
        """, (vpn_key_id, today))
        
        result = cursor.fetchone()
        current_traffic = (result[0] if result else 0) / (1024 ** 3)
        total_traffic = current_traffic + traffic_gb
        
        if total_traffic > MAX_DAILY_TRAFFIC_GB:
            # Получаем информацию о пользователе
            cursor.execute("""
                SELECT u.telegram_id, u.username
                FROM users u
                WHERE u.id = ?
            """, (user_id,))
            user_row = cursor.fetchone()
            
            # Блокируем подписку
            cursor.execute("""
                UPDATE vpn_keys
                SET status = 'Banned'
                WHERE id = ?
            """, (vpn_key_id,))
            
            # Увеличиваем счетчик забаненных ключей
            cursor.execute("""
                UPDATE users
                SET banned_keys_count = banned_keys_count + 1
                WHERE id = ?
            """, (user_id,))
            
            conn.commit()
            
            # Уведомляем администратора
            if user_row:
                notify_admin_about_abuse(
                    user_id, user_row['telegram_id'], user_row['username'] or f"user_{user_id}",
                    "Превышение лимита трафика",
                    f"Использовано {total_traffic:.2f} ГБ за сутки (лимит {MAX_DAILY_TRAFFIC_GB} ГБ). "
                    f"Ключ #{vpn_key_id} заблокирован."
                )
            
            return {
                'abuse_detected': True,
                'reason': f'Превышен лимит трафика: {total_traffic:.2f} ГБ за сутки (максимум {MAX_DAILY_TRAFFIC_GB} ГБ)',
                'action': 'blocked'
            }
        
        return {'abuse_detected': False}
    finally:
        conn.close()

def check_blacklist(telegram_id: int) -> bool:
    """
    Проверка наличия telegram_id в черном списке
    """
    conn = database.get_db_connection()
    cursor = conn.cursor()
    
    try:
        cursor.execute("SELECT 1 FROM blacklist WHERE telegram_id = ?", (telegram_id,))
        return cursor.fetchone() is not None
    finally:
        conn.close()


def check_user_ban_status(user_id: int, telegram_id: int = None) -> Dict[str, Any]:
    """
    Проверка статуса бана пользователя
    Проверяет: 1) черный список, 2) is_banned флаг, 3) лимит забаненных ключей
    """
    conn = database.get_db_connection()
    cursor = conn.cursor()
    
    try:
        # Сначала получаем данные пользователя
        cursor.execute("""
            SELECT banned_keys_count, is_banned, ban_reason, telegram_id
            FROM users
            WHERE id = ?
        """, (user_id,))
        
        result = cursor.fetchone()
        if not result:
            return {'banned': False}
        
        banned_keys_count = result['banned_keys_count'] or 0
        is_banned = result['is_banned']
        ban_reason = result['ban_reason']
        user_telegram_id = telegram_id or result['telegram_id']
        
        # Проверка черного списка (приоритетная)
        if user_telegram_id:
            cursor.execute("SELECT 1 FROM blacklist WHERE telegram_id = ?", (user_telegram_id,))
            if cursor.fetchone():
                return {
                    'banned': True,
                    'reason': 'Ваш аккаунт находится в черном списке',
                    'blacklisted': True
                }
        
        # Проверка флага is_banned
        if is_banned:
            return {
                'banned': True,
                'reason': ban_reason or 'Аккаунт заблокирован',
                'banned_keys_count': banned_keys_count
            }
        
        # Авто-бан при превышении лимита забаненных ключей
        if banned_keys_count >= MAX_BANNED_KEYS_FOR_BAN:
            cursor.execute("""
                UPDATE users
                SET is_banned = 1, ban_reason = 'Превышен лимит забаненных ключей (3+)'
                WHERE id = ?
            """, (user_id,))
            conn.commit()
            
            return {
                'banned': True,
                'reason': 'Аккаунт заблокирован из-за превышения лимита забаненных ключей (3+)'
            }
        
        return {
            'banned': False,
            'banned_keys_count': banned_keys_count
        }
    finally:
        conn.close()

def update_traffic_stats(vpn_key_id: int, user_id: int, traffic_bytes: float):
    """Обновить статистику трафика"""
    conn = database.get_db_connection()
    cursor = conn.cursor()
    
    try:
        today = datetime.now().date()
        
        cursor.execute("""
            INSERT INTO traffic_stats (device_id, user_id, date, traffic_bytes)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(device_id, date) DO UPDATE SET
                traffic_bytes = traffic_bytes + ?
        """, (vpn_key_id, user_id, today, traffic_bytes, traffic_bytes))
        
        conn.commit()
    finally:
        conn.close()

def update_key_hwid(vpn_key_id: int, hwid: str, ip_address: str = None):
    """Обновить HWID, IP ключа и время последнего использования"""
    conn = database.get_db_connection()
    cursor = conn.cursor()
    
    try:
        hwid_hash = database.hash_hwid(hwid) if hwid else None
        
        if ip_address:
            cursor.execute("""
                UPDATE vpn_keys
                SET hwid_hash = ?, last_ip = ?, last_used = CURRENT_TIMESTAMP
                WHERE id = ?
            """, (hwid_hash, ip_address, vpn_key_id))
        else:
            cursor.execute("""
                UPDATE vpn_keys
                SET hwid_hash = ?, last_used = CURRENT_TIMESTAMP
                WHERE id = ?
            """, (hwid_hash, vpn_key_id))
        
        conn.commit()
    finally:
        conn.close()


def check_ip_abuse(user_id: int, vpn_key_id: int, ip_address: str) -> Dict[str, Any]:
    """
    Проверка на одновременное использование с разных IP-адресов
    ОТКЛЮЧЕНО: теперь контроль только по трафику (>80 ГБ/сутки)
    Всегда возвращает allowed=True
    """
    # IP лимиты отключены - контроль только по трафику
    return {'allowed': True}

