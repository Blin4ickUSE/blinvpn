"""
Основной модуль, соединяющий весь проект
"""
import os
import logging
import asyncio
import requests
from typing import Optional, Dict, Any, List
from datetime import datetime, timedelta, timezone
from src.database import database
from src.api import remnawave
from src.core import messages as notify_msgs

logger = logging.getLogger(__name__)

# Telegram Bot API
TELEGRAM_BOT_TOKEN = os.getenv('TELEGRAM_BOT_TOKEN', '')
SUPPORT_BOT_TOKEN = os.getenv('SUPPORT_BOT_TOKEN', '')
TELEGRAM_ADMIN_ID = os.getenv('TELEGRAM_ADMIN_ID', '')
TELEGRAM_ADMIN_IDS = os.getenv('TELEGRAM_ADMIN_IDS', '')
TELEGRAM_SUPPORT_GROUP_ID = os.getenv('TELEGRAM_SUPPORT_GROUP_ID', '')

# Форум-группа для служебных уведомлений
NOTIFY_GROUP_ID = os.getenv('NOTIFY_GROUP_ID', '')
NOTIFY_THREAD_DEPOSITS  = os.getenv('NOTIFY_THREAD_DEPOSITS', '')   # Пополнения
NOTIFY_THREAD_ERRORS    = os.getenv('NOTIFY_THREAD_ERRORS', '')     # Ошибки
NOTIFY_THREAD_WITHDRAWALS = os.getenv('NOTIFY_THREAD_WITHDRAWALS', '')  # Заявки на вывод


def send_to_forum_topic(message: str, thread_id_str: str, reply_markup: dict = None) -> bool:
    """Отправить сообщение в топик форум-группы. Fallback → личка админов."""
    if not TELEGRAM_BOT_TOKEN:
        return False
    group_id = NOTIFY_GROUP_ID.strip()
    thread_id = thread_id_str.strip() if thread_id_str else ''
    if group_id and thread_id:
        try:
            url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage"
            data: dict = {
                'chat_id': int(group_id),
                'message_thread_id': int(thread_id),
                'text': message,
                'parse_mode': 'HTML',
            }
            if reply_markup:
                data['reply_markup'] = reply_markup
            resp = requests.post(url, json=data, timeout=10)
            if resp.status_code == 200 and resp.json().get('ok'):
                return True
            logger.warning("send_to_forum_topic failed: %s", resp.text[:200])
        except Exception as e:
            logger.error("send_to_forum_topic error: %s", e)
    # Fallback — личка всех админов
    return send_notification_to_admin(message, reply_markup)



def get_admin_telegram_ids() -> List[int]:
    ids: List[int] = []
    raw_values = []
    if TELEGRAM_ADMIN_IDS:
        raw_values.extend([v.strip() for v in TELEGRAM_ADMIN_IDS.split(',') if v.strip()])
    if TELEGRAM_ADMIN_ID:
        raw_values.append(str(TELEGRAM_ADMIN_ID).strip())
    for value in raw_values:
        try:
            ids.append(int(value))
        except Exception:
            continue
    # Убираем дубликаты, сохраняя порядок
    unique: List[int] = []
    for admin_id in ids:
        if admin_id not in unique:
            unique.append(admin_id)
    return unique

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

_UNREACHABLE_CHAT_MARKERS = (
    'chat not found',
    'bot was blocked by the user',
    'user is deactivated',
    'peer_id_invalid',
    'input user deactivated',
)


def _is_unreachable_chat_error(status_code: int, response_text: str, body: Optional[Dict] = None) -> bool:
    """Чат недоступен — повторные отправки бессмысленны."""
    haystack = (response_text or '').lower()
    if body:
        haystack = f"{haystack} {str(body.get('description', '')).lower()}"
    if status_code == 403:
        return True
    return any(marker in haystack for marker in _UNREACHABLE_CHAT_MARKERS)


def send_notification_to_user_ex(
    telegram_id: int, message: str, reply_markup: dict = None
) -> tuple[bool, bool]:
    """Отправить уведомление. Возвращает (sent, unreachable)."""
    if not TELEGRAM_BOT_TOKEN:
        return False, False

    try:
        url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage"
        data = {
            'chat_id': telegram_id,
            'text': message,
            'parse_mode': 'HTML',
        }
        if reply_markup:
            data['reply_markup'] = reply_markup
        response = requests.post(url, json=data, timeout=10)
        body = None
        try:
            body = response.json()
        except Exception:
            pass

        if response.status_code == 200 and body and body.get('ok'):
            return True, False

        unreachable = _is_unreachable_chat_error(response.status_code, response.text, body)
        if unreachable:
            logger.debug(
                "sendMessage skipped (unreachable chat) for %s: %s",
                telegram_id,
                (body or {}).get('description', response.text[:200]),
            )
        else:
            logger.warning(
                "sendMessage HTTP %s to %s: %s",
                response.status_code,
                telegram_id,
                response.text[:300],
            )
        return False, unreachable
    except Exception as e:
        logger.error(f"Failed to send notification to user {telegram_id}: {e}")
        return False, False


def send_notification_to_user(telegram_id: int, message: str, reply_markup: dict = None) -> bool:
    """Отправить уведомление пользователю в Telegram"""
    sent, _ = send_notification_to_user_ex(telegram_id, message, reply_markup)
    return sent


def send_key_created_notification(telegram_id: int, days: int, traffic_gb: int, devices: int) -> bool:
    """Отправить уведомление о создании ключа с кнопкой открытия приложения"""
    if not TELEGRAM_BOT_TOKEN:
        return False
    
    miniapp_url = os.getenv('MINIAPP_URL', 'https://your-domain.com/miniapp')
    message = notify_msgs.build_key_created_message(days, traffic_gb, devices)
    reply_markup = {
        'inline_keyboard': [[{
            'text': notify_msgs.BUTTON_OPEN_MINIAPP,
            'web_app': {'url': miniapp_url}
        }]]
    }
    
    return send_notification_to_user(telegram_id, message, reply_markup)

def send_notification_to_admin(message: str, reply_markup: dict = None) -> bool:
    """Отправить уведомление администратору"""
    admin_ids = get_admin_telegram_ids()
    if not admin_ids or not TELEGRAM_BOT_TOKEN:
        return False
    sent_any = False
    for admin_id in admin_ids:
        sent_any = send_notification_to_user(int(admin_id), message, reply_markup) or sent_any
    return sent_any


def send_withdrawal_request_to_admin(transaction_id: int, user_id: int, telegram_id: int, 
                                     username: str, amount: float, method: str, 
                                     details: str) -> bool:
    """Отправить запрос на вывод в топик форума (или личку админов)."""
    if not TELEGRAM_BOT_TOKEN:
        return False
    
    message = notify_msgs.build_withdrawal_admin_request_message(
        transaction_id, username, telegram_id, amount, method, details
    )
    
    reply_markup = {
        'inline_keyboard': [
            [
                {'text': '✅ Одобрить', 'callback_data': f'withdraw_approve_{transaction_id}'},
                {'text': '❌ Отказать', 'callback_data': f'withdraw_reject_{transaction_id}'}
            ]
        ]
    }
    
    return send_to_forum_topic(message, NOTIFY_THREAD_WITHDRAWALS, reply_markup)

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
                                 squad_uuids: list = None, plan_type: str = 'vpn',
                                 devices_limit: int = 1) -> Optional[Dict]:
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

        assigned_squad_uuid = squad_uuids[0] if squad_uuids else None
        expiry_date = (datetime.now() + timedelta(days=days)).isoformat()

        traffic_strategy = (
            remnawave.TrafficLimitStrategy.NO_RESET
            if plan_type == 'trial' or not (traffic_limit or 0)
            else remnawave.TrafficLimitStrategy.MONTH
        )

        # Резервируем key_id в БД, чтобы имя подписки было TELEGRAMID_KEYID
        conn = database.get_db_connection()
        cursor = conn.cursor()
        cursor.execute("""
            INSERT INTO vpn_keys (user_id, key_uuid, key_config, status, expiry_date,
                                 devices_limit, traffic_limit, squad_uuid, plan_type)
            VALUES (?, NULL, NULL, 'Pending', ?, ?, ?, ?, ?)
        """, (user_id, expiry_date, devices_limit, traffic_limit, assigned_squad_uuid, plan_type))
        key_id = cursor.lastrowid
        conn.commit()

        subscription_username = remnawave.format_subscription_username(telegram_id, key_id)
        remnawave_user = None

        try:
            remnawave_user = remnawave.remnawave_api.create_user_with_params(
                telegram_id=telegram_id,
                username=subscription_username,
                days=days,
                traffic_limit_bytes=traffic_limit or 0,
                hwid_device_limit=int(devices_limit),
                active_internal_squads=squad_uuids if squad_uuids else None,
                traffic_limit_strategy=traffic_strategy,
            )
        except Exception as create_error:
            error_msg = str(create_error).lower()
            if 'already exists' in error_msg or 'a019' in error_msg:
                logger.warning(
                    'Remnawave username collision for %s, key_id=%s',
                    subscription_username, key_id,
                )
            cursor.execute("DELETE FROM vpn_keys WHERE id = ? AND key_uuid IS NULL", (key_id,))
            conn.commit()
            conn.close()
            raise create_error

        if not remnawave_user:
            cursor.execute("DELETE FROM vpn_keys WHERE id = ? AND key_uuid IS NULL", (key_id,))
            conn.commit()
            conn.close()
            logger.error(f"Failed to create user in Remnawave: {telegram_id}")
            return None

        user_uuid = remnawave_user.uuid if hasattr(remnawave_user, 'uuid') else remnawave_user.get('uuid')
        subscription_url = remnawave_user.subscription_url if hasattr(remnawave_user, 'subscription_url') else remnawave_user.get('subscription_url', '')

        subscription = remnawave_user

        if subscription:
            subscription_url = subscription.subscription_url if hasattr(subscription, 'subscription_url') else (subscription.get('subscription_url') if isinstance(subscription, dict) else subscription_url)

        subscription_data = None
        if subscription:
            if hasattr(subscription, '__dict__'):
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

        cursor.execute("""
            UPDATE vpn_keys SET key_uuid = ?, key_config = ?, status = 'Active',
                   expiry_date = ?, traffic_limit = ?, squad_uuid = ?, plan_type = ?,
                   devices_limit = ?
            WHERE id = ?
        """, (user_uuid, subscription_url, expiry_date, traffic_limit, assigned_squad_uuid,
              plan_type, devices_limit, key_id))
        conn.commit()
        conn.close()

        # Синхронизируем лимит устройств (HWID) и срок в Remnawave после сохранения ключа
        if user_uuid:
            try:
                if isinstance(expiry_date, str):
                    exp_sync = datetime.fromisoformat(
                        expiry_date.replace('Z', '+00:00').replace('+00:00', '')
                    )
                else:
                    exp_sync = expiry_date
                remnawave.remnawave_api.update_user_sync(
                    uuid=user_uuid,
                    expire_at=exp_sync,
                    traffic_limit_bytes=int(traffic_limit or 0),
                    hwid_device_limit=int(devices_limit),
                    traffic_limit_strategy=traffic_strategy,
                )
            except Exception as sync_err:
                logger.error(f"Remnawave sync after create_user_and_subscription: {sync_err}")
        
        # Обновляем счётчик пользователей в скваде
        if assigned_squad_uuid:
            database.update_squad_user_count(assigned_squad_uuid, 1)
        
        # Уведомление администратору убрано - оставляем только для пополнений и запросов на вывод
        
        return {
            'user_id': user_id,
            'key_id': key_id,
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
                notify_msgs.build_admin_payment_received_message(
                    user.get('username', 'N/A'),
                    float(amount),
                    payment_method,
                    payment_provider,
                )
            )
        
        return {'success': True}
    except Exception as e:
        logger.error(f"Error processing payment: {e}")
        return None

def check_blacklist(telegram_id: int) -> bool:
    """Проверить, находится ли пользователь в черном списке (с online fallback)."""
    try:
        from src.core.blacklist import is_telegram_id_blacklisted
        return is_telegram_id_blacklisted(int(telegram_id))
    except Exception:
        conn = database.get_db_connection()
        cursor = conn.cursor()
        try:
            cursor.execute("SELECT id FROM blacklist WHERE telegram_id = ?", (telegram_id,))
            return cursor.fetchone() is not None
        finally:
            conn.close()


# МСК = UTC+3 для единообразного отображения времени окончания
MSK_UTC_OFFSET_HOURS = 3


def _utc_to_msk(dt: datetime) -> datetime:
    """Преобразовать datetime (UTC или naive как UTC) в наивное МСК для отображения."""
    if getattr(dt, 'tzinfo', None):
        off = dt.utcoffset()
        dt = dt.replace(tzinfo=None) - (timedelta(seconds=off.total_seconds()) if off else timedelta(0))
    return dt + timedelta(hours=MSK_UTC_OFFSET_HOURS)


def format_expiry_for_notification(expiry_date_str: str) -> str:
    """Форматировать дату истечения для уведомлений в читаемом формате МСК."""
    try:
        if isinstance(expiry_date_str, str):
            dt = datetime.fromisoformat(expiry_date_str.replace('Z', '+00:00').replace('+00:00', ''))
        else:
            dt = expiry_date_str
        if getattr(dt, 'tzinfo', None):
            off = dt.utcoffset()
            dt = dt.replace(tzinfo=None) - (timedelta(seconds=off.total_seconds()) if off else timedelta(0))
        dt_msk = _utc_to_msk(dt)
        months = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
                  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря']
        return f"{dt_msk.day} {months[dt_msk.month-1]} {dt_msk.year} в {dt_msk.strftime('%H:%M')}"
    except Exception:
        return str(expiry_date_str) if expiry_date_str else ''


def sync_expiry_from_remnawave() -> None:
    """
    Синхронизировать expiry_date из Remnawave для всех активных ключей.
    Единый источник истины для даты окончания подписки (уведомления, панель, miniapp).
    """
    conn = database.get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("""
            SELECT DISTINCT u.telegram_id FROM vpn_keys vk
            JOIN users u ON vk.user_id = u.id
            WHERE vk.status = 'Active' AND vk.key_uuid IS NOT NULL AND u.telegram_id IS NOT NULL
        """)
        telegram_ids = [row['telegram_id'] for row in cursor.fetchall()]
        for telegram_id in telegram_ids:
            try:
                rw_users = remnawave.remnawave_api.get_user_by_telegram_id(telegram_id)
                for rw_user in rw_users or []:
                    rw_uuid = rw_user.uuid if hasattr(rw_user, 'uuid') else rw_user.get('uuid')
                    expire_at = getattr(rw_user, 'expire_at', None) or (rw_user.get('expireAt') if isinstance(rw_user, dict) else None)
                    if not rw_uuid or not expire_at:
                        continue
                    if isinstance(expire_at, str):
                        expire_at = datetime.fromisoformat(expire_at.replace('Z', '+00:00').replace('+00:00', ''))
                    if hasattr(expire_at, 'tzinfo') and expire_at.tzinfo:
                        expire_at = expire_at.replace(tzinfo=None) - timedelta(seconds=expire_at.utcoffset().total_seconds() if expire_at.utcoffset() else 0)
                    cursor.execute("""
                        UPDATE vpn_keys SET expiry_date = ? WHERE key_uuid = ?
                    """, (expire_at.isoformat(), rw_uuid))
            except Exception as e:
                logger.warning(f"sync_expiry_from_remnawave for telegram_id {telegram_id}: {e}")
        conn.commit()
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
            result_message = notify_msgs.build_promo_balance_message(amount)
        elif promo_type == 'discount':
            # Скидка на следующую покупку подписки
            try:
                percent = int(float(promo_value))
            except Exception:
                percent = 0
            if percent <= 0 or percent > 90:
                return {'success': False, 'error': 'Некорректный процент скидки'}
            cursor.execute("UPDATE users SET next_discount_percent = ? WHERE id = ?", (percent, user_id))
            result_message = notify_msgs.build_promo_discount_message(percent)
        elif promo_type == 'subscription':
            # +N дней ко всем подпискам пользователя; если подписок нет — предложить создать
            days = int(float(promo_value))
            if days <= 0 or days > 3650:
                return {'success': False, 'error': 'Некорректное количество дней'}
            cursor.execute("SELECT COUNT(*) AS cnt FROM vpn_keys WHERE user_id = ? AND status != 'Deleted'", (user_id,))
            cnt = cursor.fetchone()['cnt'] or 0
            if cnt <= 0:
                result_message = notify_msgs.build_promo_subscription_days_message(days)
                # Mark use but let client initiate create flow
                cursor.execute("""
                    INSERT INTO promocode_uses (promocode_id, user_id)
                    VALUES (?, ?)
                """, (promo_dict['id'], user_id))
                cursor.execute("""
                    UPDATE promocodes SET uses_count = uses_count + 1 WHERE id = ?
                """, (promo_dict['id'],))
                conn.commit()
                return {'success': True, 'message': result_message, 'subscription_days': days, 'needs_subscription_create': True}

            cursor.execute("""
                UPDATE vpn_keys
                SET expiry_date = datetime(
                    CASE WHEN expiry_date > datetime('now') THEN expiry_date ELSE datetime('now') END,
                    '+' || ? || ' days'
                )
                WHERE user_id = ? AND status != 'Deleted'
            """, (days, user_id))
            result_message = notify_msgs.build_promo_subscription_extended_message(days)
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
            'rate': 20,
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
                
                # Удаляем ключ/устройство (теперь одна запись)
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
