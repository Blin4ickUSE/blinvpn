"""
Основной модуль, соединяющий весь проект
"""
import os
import logging
import asyncio
import requests
from typing import Optional, Dict, Any, List
from datetime import datetime, timedelta
from backend.database import database
from backend.api import remnawave, yookassa, heleket, platega
from backend.core import abuse_detected

logger = logging.getLogger(__name__)

# Telegram Bot API
TELEGRAM_BOT_TOKEN = os.getenv('TELEGRAM_BOT_TOKEN', '')
SUPPORT_BOT_TOKEN = os.getenv('SUPPORT_BOT_TOKEN', '')
TELEGRAM_ADMIN_ID = os.getenv('TELEGRAM_ADMIN_ID', '')
TELEGRAM_SUPPORT_GROUP_ID = os.getenv('TELEGRAM_SUPPORT_GROUP_ID', '')

def send_notification_via_support_bot(telegram_id: int, message: str) -> bool:
    """Отправить сообщение через бот поддержки (приоритет для тикетов)"""
    if not SUPPORT_BOT_TOKEN:
        return False
    
    try:
        url = f"https://api.telegram.org/bot{SUPPORT_BOT_TOKEN}/sendMessage"
        data = {
            'chat_id': telegram_id,
            'text': message,
            'parse_mode': 'HTML'
        }
        response = requests.post(url, json=data, timeout=5)
        if response.status_code == 200:
            return True
        logger.warning(f"Support bot failed to send to {telegram_id}: {response.text}")
        return False
    except Exception as e:
        logger.error(f"Failed to send via support bot to {telegram_id}: {e}")
        return False

def send_support_message_to_user(telegram_id: int, message: str) -> bool:
    """Отправить сообщение поддержки - сначала через бот поддержки, потом через основной"""
    # Сначала пробуем бот поддержки
    if send_notification_via_support_bot(telegram_id, message):
        return True
    # Если не удалось - через основной бот
    return send_notification_to_user(telegram_id, message)

def send_notification_to_user(telegram_id: int, message: str, reply_markup: dict = None) -> bool:
    """Отправить уведомление пользователю в Telegram"""
    if not TELEGRAM_BOT_TOKEN:
        return False
    
    try:
        url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage"
        data = {
            'chat_id': telegram_id,
            'text': message,
            'parse_mode': 'HTML'
        }
        if reply_markup:
            data['reply_markup'] = reply_markup
        response = requests.post(url, json=data, timeout=5)
        return response.status_code == 200
    except Exception as e:
        logger.error(f"Failed to send notification to user {telegram_id}: {e}")
        return False


def send_key_created_notification(telegram_id: int, days: int, traffic_gb: int, devices: int) -> bool:
    """Отправить уведомление о создании ключа с кнопкой открытия приложения"""
    if not TELEGRAM_BOT_TOKEN:
        return False
    
    miniapp_url = os.getenv('MINIAPP_URL', 'https://your-domain.com/miniapp')
    
    message = (
        "🎉 <b>Ваш VPN ключ готов!</b>\n\n"
        f"📅 Срок действия: {days} дней\n"
        f"📊 Лимит трафика: {traffic_gb} ГБ\n"
        f"📱 Устройства: {devices}\n\n"
        "🔗 Нажмите, чтобы увидеть инструкцию"
    )
    
    reply_markup = {
        'inline_keyboard': [[{
            'text': '📱 Открыть приложение',
            'web_app': {'url': miniapp_url}
        }]]
    }
    
    return send_notification_to_user(telegram_id, message, reply_markup)

def send_notification_to_admin(message: str, reply_markup: dict = None) -> bool:
    """Отправить уведомление администратору"""
    if not TELEGRAM_ADMIN_ID or not TELEGRAM_BOT_TOKEN:
        return False
    
    return send_notification_to_user(int(TELEGRAM_ADMIN_ID), message, reply_markup)


def send_withdrawal_request_to_admin(transaction_id: int, user_id: int, telegram_id: int, 
                                     username: str, amount: float, method: str, 
                                     details: str) -> bool:
    """Отправить запрос на вывод админу с кнопками Принять/Отказать"""
    if not TELEGRAM_ADMIN_ID or not TELEGRAM_BOT_TOKEN:
        return False
    
    message = (
        f"💸 <b>Запрос на вывод средств</b>\n\n"
        f"🆔 ID заявки: #{transaction_id}\n"
        f"👤 Пользователь: @{username}\n"
        f"🔢 Telegram ID: {telegram_id}\n"
        f"💵 Сумма: {amount}₽\n"
        f"💳 Метод: {method}\n"
        f"📝 Детали: {details}"
    )
    
    reply_markup = {
        'inline_keyboard': [
            [
                {'text': '✅ Принять', 'callback_data': f'withdraw_approve_{transaction_id}'},
                {'text': '❌ Отказать', 'callback_data': f'withdraw_reject_{transaction_id}'}
            ]
        ]
    }
    
    return send_notification_to_admin(message, reply_markup)

def send_formatted_notification(telegram_id: int, message: str, parse_mode: str = 'HTML', 
                                 reply_markup: dict = None) -> bool:
    """Отправить форматированное уведомление пользователю с поддержкой HTML/Markdown"""
    if not TELEGRAM_BOT_TOKEN:
        return False
    
    try:
        url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage"
        data = {
            'chat_id': telegram_id,
            'text': message,
            'parse_mode': parse_mode
        }
        if reply_markup:
            data['reply_markup'] = reply_markup
        
        response = requests.post(url, json=data, timeout=10)
        if response.status_code != 200:
            # Если ошибка парсинга - пробуем без форматирования
            if 'parse_error' in response.text.lower() or "can't parse" in response.text.lower():
                data['parse_mode'] = None
                response = requests.post(url, json=data, timeout=10)
        
        return response.status_code == 200
    except Exception as e:
        logger.error(f"Failed to send formatted notification to {telegram_id}: {e}")
        return False


def send_photo_to_user(telegram_id: int, photo_url: str, caption: str = None, 
                       parse_mode: str = 'HTML', reply_markup: dict = None) -> bool:
    """Отправить фото пользователю с подписью"""
    if not TELEGRAM_BOT_TOKEN:
        return False
    
    try:
        url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendPhoto"
        data = {
            'chat_id': telegram_id,
            'photo': photo_url
        }
        if caption:
            data['caption'] = caption
            data['parse_mode'] = parse_mode
        if reply_markup:
            data['reply_markup'] = reply_markup
        
        response = requests.post(url, json=data, timeout=15)
        return response.status_code == 200
    except Exception as e:
        logger.error(f"Failed to send photo to {telegram_id}: {e}")
        return False


def send_notification_to_support_group(message: str) -> bool:
    """Отправить уведомление в группу поддержки"""
    if not TELEGRAM_SUPPORT_GROUP_ID or not TELEGRAM_BOT_TOKEN:
        return False
    
    try:
        url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage"
        data = {
            'chat_id': TELEGRAM_SUPPORT_GROUP_ID,
            'text': message,
            'parse_mode': 'HTML'
        }
        response = requests.post(url, json=data, timeout=5)
        return response.status_code == 200
    except Exception as e:
        logger.error(f"Failed to send notification to support group: {e}")
        return False

def sanitize_username(username: str, telegram_id: int) -> str:
    """Санитизация username для Remnawave - только буквы, цифры, _ и -"""
    import re
    if not username:
        return f"user_{telegram_id}"
    
    # Удаляем все символы кроме букв, цифр, _ и -
    sanitized = re.sub(r'[^a-zA-Z0-9_-]', '', username)
    
    # Если после санитизации пусто - используем telegram_id
    if not sanitized:
        return f"user_{telegram_id}"
    
    # Username должен начинаться с буквы или цифры
    if sanitized[0] in '_-':
        sanitized = f"u{sanitized}"
    
    return sanitized


def create_user_and_subscription(telegram_id: int, username: str, days: int, 
                                 referred_by: int = None, traffic_limit: int = None,
                                 squad_uuids: list = None, plan_type: str = 'vpn') -> Optional[Dict]:
    """Создать пользователя и подписку"""
    try:
        # Создаем пользователя в БД
        user_id = database.create_user(telegram_id, username, referred_by=referred_by)
        
        # Получаем лучший сквад с балансировкой нагрузки, если не указаны явно
        if squad_uuids is None:
            best_squad = database.get_best_squad_for_subscription(plan_type)
            if best_squad:
                squad_uuids = [best_squad['squad_uuid']]
                logger.info(f"Auto-selected squad {best_squad['squad_name']} for {plan_type} (users: {best_squad['current_users']})")
            else:
                # Fallback на дефолтные сквады
                squad_uuids = database.get_default_squads(plan_type)
        
        logger.info(f"Creating subscription for {telegram_id}, plan_type={plan_type}, squads={squad_uuids}")
        
        # Генерируем уникальный username для каждой новой подписки
        # Формат: username_telegramid_timestamp
        import time
        timestamp = int(time.time() * 1000) % 1000000  # Последние 6 цифр timestamp
        base_username = sanitize_username(username, telegram_id)
        unique_username = f"{base_username}_{timestamp}"
        
        # Создаем нового пользователя в Remnawave с уникальным username
        try:
            remnawave_user = remnawave.remnawave_api.create_user_with_params(
                telegram_id=telegram_id,
                username=unique_username,
                days=days,
                traffic_limit_bytes=traffic_limit or 0,
                active_internal_squads=squad_uuids if squad_uuids else None
            )
        except Exception as create_error:
            error_msg = str(create_error).lower()
            # Если username уже существует, пробуем с еще более уникальным именем
            if 'already exists' in error_msg or 'a019' in error_msg:
                import random
                unique_username = f"{base_username}_{telegram_id}_{random.randint(1000, 9999)}"
                logger.info(f"Username collision, trying {unique_username}")
                remnawave_user = remnawave.remnawave_api.create_user_with_params(
                    telegram_id=telegram_id,
                    username=unique_username,
                    days=days,
                    traffic_limit_bytes=traffic_limit or 0,
                    active_internal_squads=squad_uuids if squad_uuids else None
                )
            else:
                raise create_error
        
        if not remnawave_user:
            logger.error(f"Failed to create user in Remnawave: {telegram_id}")
            return None
        
        # Получаем uuid - может быть dataclass или dict
        user_uuid = remnawave_user.uuid if hasattr(remnawave_user, 'uuid') else remnawave_user.get('uuid')
        subscription_url = remnawave_user.subscription_url if hasattr(remnawave_user, 'subscription_url') else remnawave_user.get('subscription_url', '')
        
        # Подписка создана при создании пользователя
        subscription = remnawave_user
        
        if not subscription:
            logger.error(f"Failed to create subscription: {user_uuid}")
            return None
        
        # Получаем subscription_url из subscription если доступен
        if subscription:
            subscription_url = subscription.subscription_url if hasattr(subscription, 'subscription_url') else (subscription.get('subscription_url') if isinstance(subscription, dict) else subscription_url)
        
        # Конвертируем subscription в JSON-сериализуемый формат
        subscription_data = None
        if subscription:
            if hasattr(subscription, '__dict__'):
                # Это dataclass - конвертируем в dict
                subscription_data = {
                    'uuid': subscription.uuid if hasattr(subscription, 'uuid') else None,
                    'username': subscription.username if hasattr(subscription, 'username') else None,
                    'status': subscription.status.value if hasattr(subscription, 'status') and hasattr(subscription.status, 'value') else str(subscription.status) if hasattr(subscription, 'status') else None,
                    'subscription_url': subscription.subscription_url if hasattr(subscription, 'subscription_url') else None,
                    'expire_at': subscription.expire_at.isoformat() if hasattr(subscription, 'expire_at') and subscription.expire_at else None,
                    'traffic_limit_bytes': subscription.traffic_limit_bytes if hasattr(subscription, 'traffic_limit_bytes') else None,
                }
            elif isinstance(subscription, dict):
                subscription_data = subscription
            else:
                subscription_data = str(subscription)
        
        # Сохраняем ключ в БД
        conn = database.get_db_connection()
        cursor = conn.cursor()
        expiry_date = (datetime.now() + timedelta(days=days)).isoformat()
        
        # Проверяем существует ли уже ключ для этого пользователя
        cursor.execute("SELECT id FROM vpn_keys WHERE user_id = ? AND key_uuid = ?", (user_id, user_uuid))
        existing_key = cursor.fetchone()
        
        # Определяем squad_uuid для сохранения (первый из списка)
        assigned_squad_uuid = squad_uuids[0] if squad_uuids else None
        
        vpn_key_id = None
        if existing_key:
            # Обновляем существующий ключ
            vpn_key_id = existing_key['id']
            cursor.execute("""
                UPDATE vpn_keys SET status = 'Active', expiry_date = ?, traffic_limit = ?, 
                       key_config = ?, squad_uuid = ?, plan_type = ?
                WHERE id = ?
            """, (expiry_date, traffic_limit, subscription_url, assigned_squad_uuid, plan_type, vpn_key_id))
        else:
            # Создаем новый ключ
            cursor.execute("""
                INSERT INTO vpn_keys (user_id, key_uuid, key_config, status, expiry_date, 
                                     devices_limit, traffic_limit, squad_uuid, plan_type)
                VALUES (?, ?, ?, 'Active', ?, 1, ?, ?, ?)
            """, (user_id, user_uuid, subscription_url, expiry_date, traffic_limit, 
                  assigned_squad_uuid, plan_type))
            vpn_key_id = cursor.lastrowid
        
        # Создаем или обновляем устройство для отображения в приложении
        device_name = f"{'Whitelist' if plan_type == 'whitelist' else 'VPN'} подписка"
        cursor.execute("""
            SELECT id FROM devices WHERE user_id = ? AND vpn_key_id = ?
        """, (user_id, vpn_key_id))
        existing_device = cursor.fetchone()
        
        device_id = None
        if existing_device:
            device_id = existing_device['id']
            cursor.execute("""
                UPDATE devices SET is_active = 1, name = ?
                WHERE id = ?
            """, (device_name, device_id))
        else:
            cursor.execute("""
                INSERT INTO devices (user_id, name, platform, vpn_key_id, is_active, added_date)
                VALUES (?, ?, 'universal', ?, 1, CURRENT_TIMESTAMP)
            """, (user_id, device_name, vpn_key_id))
            device_id = cursor.lastrowid
        
        conn.commit()
        conn.close()
        
        # Обновляем счётчик пользователей в скваде
        if assigned_squad_uuid:
            database.update_squad_user_count(assigned_squad_uuid, 1)
        
        # Уведомление администратору убрано - оставляем только для пополнений и запросов на вывод
        
        return {
            'user_id': user_id,
            'remnawave_uuid': user_uuid,
            'subscription_url': subscription_url,
            'subscription': subscription_data,
            'squad_uuid': assigned_squad_uuid,
            'plan_type': plan_type
        }
    except Exception as e:
        logger.error(f"Error creating user and subscription: {e}")
        import traceback
        traceback.print_exc()
        return None

def process_payment(user_id: int, amount: float, payment_method: str, 
                   payment_provider: str) -> Optional[Dict]:
    """Обработать платеж"""
    try:
        # Обновляем баланс
        database.update_user_balance(user_id, amount)
        
        # Создаем транзакцию
        conn = database.get_db_connection()
        cursor = conn.cursor()
        cursor.execute("""
            INSERT INTO transactions (user_id, type, amount, status, payment_method, payment_provider)
            VALUES (?, 'deposit', ?, 'Success', ?, ?)
        """, (user_id, amount, payment_method, payment_provider))
        conn.commit()
        conn.close()
        
        # Уведомление
        user = database.get_user_by_id(user_id)
        if user:
            send_notification_to_admin(
                f"💳 Платеж получен:\n"
                f"Пользователь: @{user.get('username', 'N/A')}\n"
                f"Сумма: {amount}₽\n"
                f"Метод: {payment_method} ({payment_provider})"
            )
        
        return {'success': True}
    except Exception as e:
        logger.error(f"Error processing payment: {e}")
        return None

def check_blacklist(telegram_id: int) -> bool:
    """Проверить, находится ли пользователь в черном списке"""
    conn = database.get_db_connection()
    cursor = conn.cursor()
    
    try:
        cursor.execute("SELECT id FROM blacklist WHERE telegram_id = ?", (telegram_id,))
        return cursor.fetchone() is not None
    finally:
        conn.close()

def apply_promocode(user_id: int, code: str) -> Dict[str, Any]:
    """Применить промокод"""
    conn = database.get_db_connection()
    cursor = conn.cursor()
    
    try:
        # Проверяем промокод
        cursor.execute("""
            SELECT * FROM promocodes
            WHERE code = ? AND is_active = 1
            AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)
        """, (code.upper(),))
        
        promo = cursor.fetchone()
        if not promo:
            return {'success': False, 'error': 'Промокод не найден или истек'}
        
        promo_dict = dict(promo)
        
        # Проверяем лимит использований
        if promo_dict['uses_limit'] and promo_dict['uses_count'] >= promo_dict['uses_limit']:
            return {'success': False, 'error': 'Промокод исчерпан'}
        
        # Проверяем, использовал ли пользователь уже этот промокод
        cursor.execute("""
            SELECT id FROM promocode_uses
            WHERE promocode_id = ? AND user_id = ?
        """, (promo_dict['id'], user_id))
        
        if cursor.fetchone():
            return {'success': False, 'error': 'Вы уже использовали этот промокод'}
        
        # Применяем промокод
        promo_type = promo_dict['type']
        promo_value = promo_dict['value']
        
        if promo_type == 'balance':
            # Пополнение баланса
            amount = float(promo_value)
            database.update_user_balance(user_id, amount)
            result_message = f"Баланс пополнен на {amount}₽"
        elif promo_type == 'discount':
            # Скидка (будет применена при следующей покупке)
            result_message = f"Получена скидка {promo_value}%"
        elif promo_type == 'subscription':
            # Бесплатная подписка
            days = int(promo_value)
            user = database.get_user_by_id(user_id)
            if user:
                create_user_and_subscription(user['telegram_id'], user['username'], days)
            result_message = f"Активирована подписка на {days} дней"
        else:
            return {'success': False, 'error': 'Неизвестный тип промокода'}
        
        # Записываем использование
        cursor.execute("""
            INSERT INTO promocode_uses (promocode_id, user_id)
            VALUES (?, ?)
        """, (promo_dict['id'], user_id))
        
        # Увеличиваем счетчик использований
        cursor.execute("""
            UPDATE promocodes
            SET uses_count = uses_count + 1
            WHERE id = ?
        """, (promo_dict['id'],))
        
        conn.commit()
        
        return {'success': True, 'message': result_message}
    finally:
        conn.close()

def get_referral_stats(user_id: int) -> Dict[str, Any]:
    """Получить статистику рефералов"""
    conn = database.get_db_connection()
    cursor = conn.cursor()
    
    try:
        user = database.get_user_by_id(user_id)
        if not user:
            return {}
        
        # Получаем всех рефералов
        cursor.execute("""
            SELECT COUNT(*) as count
            FROM users
            WHERE referred_by = ?
        """, (user_id,))
        
        result = cursor.fetchone()
        referrals_count = result[0] if result else 0
        
        # Получаем фактический заработок из БД (уже начисленный partner_balance и total_earned)
        partner_balance = user.get('partner_balance', 0) or 0
        total_earned = user.get('total_earned', 0) or 0
        
        return {
            'referrals_count': referrals_count,
            'partner_balance': partner_balance,  # Доступно для вывода
            'total_earned': total_earned,  # Всего заработано за всё время
            'rate': user.get('partner_rate', 20)
        }
    finally:
        conn.close()


def sync_keys_with_remnawave() -> Dict:
    """
    Синхронизировать ключи с Remnawave.
    Удаляет из БД бота ключи, которых нет в Remnawave.
    """
    try:
        # Получаем все ключи из Remnawave (постранично)
        remnawave_uuids = set()
        start = 0
        size = 100
        
        while True:
            result = remnawave.remnawave_api.get_all_users_sync(start=start, size=size)
            users = result.get('users', [])
            total = result.get('total', 0)
            
            for user in users:
                if hasattr(user, 'uuid'):
                    remnawave_uuids.add(user.uuid)
                elif isinstance(user, dict):
                    remnawave_uuids.add(user.get('uuid'))
            
            start += size
            if start >= total:
                break
        
        logger.info(f"Found {len(remnawave_uuids)} users in Remnawave")
        
        # Получаем все ключи из БД
        conn = database.get_db_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT id, key_uuid, user_id FROM vpn_keys WHERE key_uuid IS NOT NULL")
        db_keys = cursor.fetchall()
        
        deleted_count = 0
        for key in db_keys:
            key_id = key['id']
            key_uuid = key['key_uuid']
            user_id = key['user_id']
            
            if key_uuid and key_uuid not in remnawave_uuids:
                # Ключ не найден в Remnawave - удаляем из БД
                logger.info(f"Key {key_uuid} not found in Remnawave, deleting from DB")
                
                # Удаляем связанные устройства
                cursor.execute("DELETE FROM devices WHERE vpn_key_id = ?", (key_id,))
                
                # Удаляем ключ
                cursor.execute("DELETE FROM vpn_keys WHERE id = ?", (key_id,))
                deleted_count += 1
        
        conn.commit()
        conn.close()
        
        logger.info(f"Sync completed: deleted {deleted_count} keys from DB")
        return {
            'success': True,
            'remnawave_users': len(remnawave_uuids),
            'deleted_keys': deleted_count
        }
    except Exception as e:
        logger.error(f"Error syncing with Remnawave: {e}")
        import traceback
        traceback.print_exc()
        return {'success': False, 'error': str(e)}

