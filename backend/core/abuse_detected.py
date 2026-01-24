"""
Алгоритм определения злоупотреблений трафиком
"""
import logging
import os
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Any
from backend.database import database

logger = logging.getLogger(__name__)

# Константы
MAX_SIMULTANEOUS_DEVICES = 1
MAX_SIMULTANEOUS_IPS = 1
MAX_DAILY_TRAFFIC_GB = 80
MAX_BANNED_KEYS_FOR_BAN = 3
IP_CHECK_WINDOW_SECONDS = 300  # 5 минут


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
    Максимум 1 устройство одновременно (по HWID и IP)
    """
    conn = database.get_db_connection()
    cursor = conn.cursor()
    
    try:
        hwid_hash = database.hash_hwid(hwid) if hwid else None
        
        # Получаем активные ключи пользователя
        cursor.execute("""
            SELECT vk.id, vk.hwid_hash, vk.last_used, vk.last_ip, u.telegram_id, u.username
            FROM vpn_keys vk
            JOIN users u ON vk.user_id = u.id
            WHERE vk.user_id = ? AND vk.status = 'Active'
        """, (user_id,))
        
        active_keys = cursor.fetchall()
        
        # Проверяем, используется ли уже другое устройство
        for key in active_keys:
            key_hwid = key['hwid_hash']
            last_used = key['last_used']
            last_ip = key['last_ip'] if 'last_ip' in key.keys() else None
            telegram_id = key['telegram_id']
            username = key['username'] or f"user_{user_id}"
            
            # Проверяем временное окно
            if last_used:
                try:
                    if isinstance(last_used, str):
                        last_used_dt = datetime.fromisoformat(last_used.replace('Z', '+00:00'))
                    else:
                        last_used_dt = last_used
                    
                    time_since_last = (datetime.now() - last_used_dt.replace(tzinfo=None)).total_seconds()
                    
                    if time_since_last < IP_CHECK_WINDOW_SECONDS:
                        # Проверка по HWID
                        if key_hwid and hwid_hash and key_hwid != hwid_hash:
                            notify_admin_about_abuse(
                                user_id, telegram_id, username,
                                "Множественные HWID",
                                f"Попытка подключения с другого устройства. "
                                f"Текущий HWID: {hwid_hash[:8]}..., Предыдущий: {key_hwid[:8]}..."
                            )
                            return {
                                'allowed': False,
                                'reason': 'Одновременное использование нескольких устройств запрещено. Одна подписка = одно устройство.'
                            }
                        
                        # Проверка по IP
                        if ip_address and last_ip and ip_address != last_ip:
                            notify_admin_about_abuse(
                                user_id, telegram_id, username,
                                "Множественные IP",
                                f"Одновременное подключение с разных IP. "
                                f"Текущий IP: {ip_address}, Предыдущий: {last_ip}"
                            )
                            return {
                                'allowed': False,
                                'reason': 'Одновременное подключение с разных IP-адресов запрещено.'
                            }
                except (ValueError, TypeError) as e:
                    logger.warning(f"Error parsing last_used timestamp: {e}")
        
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
    Если более 1 IP одновременно - блокировка
    """
    if not ip_address:
        return {'allowed': True}
    
    conn = database.get_db_connection()
    cursor = conn.cursor()
    
    try:
        # Получаем информацию о ключе
        cursor.execute("""
            SELECT vk.last_ip, vk.last_used, u.telegram_id, u.username
            FROM vpn_keys vk
            JOIN users u ON vk.user_id = u.id
            WHERE vk.id = ?
        """, (vpn_key_id,))
        
        row = cursor.fetchone()
        if not row:
            return {'allowed': True}
        
        last_ip = row['last_ip']
        last_used = row['last_used']
        telegram_id = row['telegram_id']
        username = row['username'] or f"user_{user_id}"
        
        # Если нет предыдущего IP - всё OK
        if not last_ip:
            return {'allowed': True}
        
        # Если IP совпадает - всё OK
        if last_ip == ip_address:
            return {'allowed': True}
        
        # Проверяем временное окно
        if last_used:
            try:
                if isinstance(last_used, str):
                    last_used_dt = datetime.fromisoformat(last_used.replace('Z', '+00:00'))
                else:
                    last_used_dt = last_used
                
                time_since_last = (datetime.now() - last_used_dt.replace(tzinfo=None)).total_seconds()
                
                # Если прошло больше 5 минут - считаем что пользователь переподключился
                if time_since_last > IP_CHECK_WINDOW_SECONDS:
                    return {'allowed': True}
                
                # Иначе - это одновременное использование с разных IP
                notify_admin_about_abuse(
                    user_id, telegram_id, username,
                    "Одновременные IP",
                    f"Подключение с IP {ip_address} в то время как активно подключение с {last_ip}"
                )
                
                # Блокируем ключ
                cursor.execute("""
                    UPDATE vpn_keys SET status = 'Banned' WHERE id = ?
                """, (vpn_key_id,))
                
                cursor.execute("""
                    UPDATE users SET banned_keys_count = banned_keys_count + 1 WHERE id = ?
                """, (user_id,))
                
                conn.commit()
                
                return {
                    'allowed': False,
                    'reason': 'Обнаружено одновременное использование с разных IP-адресов. Ключ заблокирован.'
                }
                
            except (ValueError, TypeError) as e:
                logger.warning(f"Error parsing last_used timestamp: {e}")
        
        return {'allowed': True}
    finally:
        conn.close()

