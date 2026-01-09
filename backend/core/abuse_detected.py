"""
Алгоритм определения злоупотреблений трафиком
"""
import logging
from datetime import datetime, timedelta
from typing import Dict, List, Optional
from backend.database import database

logger = logging.getLogger(__name__)

# Константы
MAX_SIMULTANEOUS_DEVICES = 1
MAX_DAILY_TRAFFIC_GB = 80
MAX_BANNED_KEYS_FOR_BAN = 3

def check_device_limit(user_id: int, hwid: str) -> Dict[str, Any]:
    """
    Проверка ограничения на одновременное использование устройств
    Максимум 1 устройство одновременно
    """
    conn = database.get_db_connection()
    cursor = conn.cursor()
    
    try:
        hwid_hash = database.hash_hwid(hwid)
        
        # Получаем активные ключи пользователя
        cursor.execute("""
            SELECT id, hwid_hash, last_used
            FROM vpn_keys
            WHERE user_id = ? AND status = 'Active'
        """, (user_id,))
        
        active_keys = cursor.fetchall()
        
        # Проверяем, используется ли уже другое устройство
        for key in active_keys:
            key_hwid = key[1]
            last_used = key[2]
            
            # Если это другое устройство и оно использовалось недавно (в последние 5 минут)
            if key_hwid and key_hwid != hwid_hash:
                if last_used:
                    try:
                        if isinstance(last_used, str):
                            last_used_dt = datetime.fromisoformat(last_used.replace('Z', '+00:00'))
                        else:
                            last_used_dt = last_used
                        if (datetime.now() - last_used_dt.replace(tzinfo=None)).total_seconds() < 300:  # 5 минут
                            return {
                                'allowed': False,
                                'reason': 'Одновременное использование нескольких устройств запрещено. Одно подписка = одно устройство.'
                            }
                    except (ValueError, TypeError) as e:
                        logger.warning(f"Error parsing last_used timestamp: {e}")
                        # Продолжаем проверку, если не удалось распарсить дату
        
        return {'allowed': True}
    finally:
        conn.close()

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
            WHERE vpn_key_id = ? AND date = ?
        """, (vpn_key_id, today))
        
        result = cursor.fetchone()
        current_traffic = (result[0] if result else 0) / (1024 ** 3)
        total_traffic = current_traffic + traffic_gb
        
        if total_traffic > MAX_DAILY_TRAFFIC_GB:
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
            
            return {
                'abuse_detected': True,
                'reason': f'Превышен лимит трафика: {total_traffic:.2f} ГБ за сутки (максимум {MAX_DAILY_TRAFFIC_GB} ГБ)',
                'action': 'blocked'
            }
        
        return {'abuse_detected': False}
    finally:
        conn.close()

def check_user_ban_status(user_id: int) -> Dict[str, Any]:
    """
    Проверка статуса бана пользователя
    Если у пользователя 3+ забаненных ключей - бан аккаунта
    """
    conn = database.get_db_connection()
    cursor = conn.cursor()
    
    try:
        cursor.execute("""
            SELECT banned_keys_count, is_banned
            FROM users
            WHERE id = ?
        """, (user_id,))
        
        result = cursor.fetchone()
        if not result:
            return {'banned': False}
        
        banned_keys_count = result[0]
        is_banned = result[1]
        
        if banned_keys_count >= MAX_BANNED_KEYS_FOR_BAN and not is_banned:
            # Баним аккаунт
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
            'banned': bool(is_banned),
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
            INSERT INTO traffic_stats (vpn_key_id, user_id, date, traffic_bytes)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(vpn_key_id, date) DO UPDATE SET
                traffic_bytes = traffic_bytes + ?
        """, (vpn_key_id, user_id, today, traffic_bytes, traffic_bytes))
        
        conn.commit()
    finally:
        conn.close()

def update_key_hwid(vpn_key_id: int, hwid: str):
    """Обновить HWID ключа и время последнего использования"""
    conn = database.get_db_connection()
    cursor = conn.cursor()
    
    try:
        hwid_hash = database.hash_hwid(hwid)
        cursor.execute("""
            UPDATE vpn_keys
            SET hwid_hash = ?, last_used = CURRENT_TIMESTAMP
            WHERE id = ?
        """, (hwid_hash, vpn_key_id))
        conn.commit()
    finally:
        conn.close()

