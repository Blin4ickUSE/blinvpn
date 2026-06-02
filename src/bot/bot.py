"""
Основной бот Telegram
"""
import asyncio
import logging
import os
import sys
from aiogram import Bot, Dispatcher, types, F
from aiogram.filters import CommandStart, Command
from aiogram.types import (
    InlineKeyboardMarkup,
    InlineKeyboardButton,
    WebAppInfo,
    CallbackQuery,
    PreCheckoutQuery,
    Message,
)
from aiogram.enums import ParseMode, ButtonStyle

# Добавляем путь к backend
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '../../'))

from src.database import database
from src.core import core
from src.core import messages as notify_msgs
from src.core.blacklist import start_blacklist_updater
from src.api import telegram_stars
from src.api import remnawave
import re
import aiohttp

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

BOT_TOKEN = os.getenv('TELEGRAM_BOT_TOKEN', '')
SUPPORT_BOT_TOKEN = os.getenv('SUPPORT_BOT_TOKEN', '')
WEB_APP_URL = os.getenv('MINIAPP_URL', 'https://your-domain.com/miniapp')

# Валидация токенов
if not BOT_TOKEN:
    logger.error("❌ TELEGRAM_BOT_TOKEN не указан в .env!")
    sys.exit(1)

if BOT_TOKEN == SUPPORT_BOT_TOKEN:
    logger.error("❌ КРИТИЧЕСКАЯ ОШИБКА: TELEGRAM_BOT_TOKEN совпадает с SUPPORT_BOT_TOKEN!")
    logger.error("   Это вызовет ошибку 'Conflict: terminated by other getUpdates request'")
    logger.error("   Создайте ОТДЕЛЬНОГО бота в @BotFather для службы поддержки!")
    sys.exit(1)

bot = Bot(token=BOT_TOKEN)
dp = Dispatcher()

_GRACE_PERIOD_DAYS = 7
_AUTO_RENEWAL_DAYS = 30
# Проверка каждые 5 мин; догон пропущенных уведомлений до _NOTIF_CATCHUP_SEC
_NOTIF_TICK_SEC = 300
_NOTIF_WINDOW_SEC = 150
_NOTIF_CATCHUP_SEC = 6 * 3600  # до 6 ч после целевого момента (тик 5 мин не пропустит)
_NO_SUB_INTERVAL_SEC = 3 * 86400
_NO_SUB_AFTER_START_SEC = 30 * 60
_NO_SUB_MAX_DAYS = 30
_COMEBACK_INTERVAL_SEC = 7 * 86400


def _parse_expiry_utc(expiry_str: str):
    from datetime import datetime, timedelta
    dt = datetime.fromisoformat(str(expiry_str).replace('Z', '+00:00').replace('+00:00', ''))
    if getattr(dt, 'tzinfo', None):
        off = dt.utcoffset()
        dt = dt.replace(tzinfo=None) - (timedelta(seconds=off.total_seconds()) if off else timedelta(0))
    return dt


def _parse_dt_utc(dt_str: str):
    if not dt_str:
        return None
    return _parse_expiry_utc(dt_str)


def _seconds_until_expiry(expiry_str: str, now_utc) -> float:
    return (_parse_expiry_utc(expiry_str) - now_utc).total_seconds()


def _days_until_expiry(expiry_str: str, now_utc) -> float:
    return _seconds_until_expiry(expiry_str, now_utc) / 86400.0


def _in_notif_window(actual_seconds: float, target_seconds: float) -> bool:
    """Целевой момент наступил: в окне ±2.5 мин или догон до 6 ч после него."""
    if abs(actual_seconds - target_seconds) <= _NOTIF_WINDOW_SEC:
        return True
    return target_seconds - _NOTIF_CATCHUP_SEC <= actual_seconds < target_seconds - _NOTIF_WINDOW_SEC


def _get_renewal_price(devices_limit: int) -> float:
    devices = max(1, int(devices_limit or 1))
    price = database.compute_vpn_subscription_price(_AUTO_RENEWAL_DAYS, devices)
    return float(price if price is not None else 99)


def _expiry_notification_sent(cursor, key_id: int, notif_type: str) -> bool:
    cursor.execute(
        """
        SELECT COUNT(*) as cnt FROM transactions
        WHERE type = ? AND description LIKE ?
        """,
        (notif_type, f'key_id={key_id}|%'),
    )
    return cursor.fetchone()['cnt'] > 0


def _mark_expiry_notification_sent(cursor, user_id: int, key_id: int, notif_type: str) -> None:
    cursor.execute(
        """
        INSERT INTO transactions (user_id, type, amount, status, description)
        VALUES (?, ?, 0, 'Info', ?)
        """,
        (user_id, notif_type, f'key_id={key_id}|sent'),
    )


def _delete_subscription_fully(
    cursor, key_id: int, key_uuid: str, user_id: int, telegram_id: int, expiry_date: str
) -> None:
    """Удалить подписку из Remnawave и БД, уведомить пользователя."""
    if not _expiry_notification_sent(cursor, key_id, 'subscription_deleted'):
        msg = notify_msgs.build_subscription_deleted_message(key_id)
        if telegram_id and core.send_notification_to_user(telegram_id, msg):
            _mark_expiry_notification_sent(cursor, user_id, key_id, 'subscription_deleted')

    if key_uuid:
        try:
            remnawave.remnawave_api.delete_user_sync(key_uuid)
            logger.info(f"Deleted key {key_uuid} from Remnawave")
        except Exception as e:
            logger.error(f"Failed to delete key {key_uuid} from Remnawave: {e}")

    cursor.execute("DELETE FROM vpn_keys WHERE id = ?", (key_id,))
    expiry_part = f"|expiry={expiry_date}" if expiry_date else ""
    cursor.execute(
        """
        INSERT INTO transactions (user_id, type, amount, status, description)
        VALUES (?, 'key_deleted_unpaid', 0, 'Info', ?)
        """,
        (user_id, f"key_id={key_id}{expiry_part}|deleted"),
    )


def _user_notification_sent(cursor, user_id: int, notif_type: str) -> bool:
    cursor.execute(
        "SELECT COUNT(*) as cnt FROM transactions WHERE user_id = ? AND type = ?",
        (user_id, notif_type),
    )
    return cursor.fetchone()['cnt'] > 0


def _mark_user_notification_sent(cursor, user_id: int, notif_type: str) -> None:
    cursor.execute(
        """
        INSERT INTO transactions (user_id, type, amount, status, description)
        VALUES (?, ?, 0, 'Info', 'sent')
        """,
        (user_id, notif_type),
    )


def _last_user_notification_at(cursor, user_id: int, notif_type: str):
    cursor.execute(
        """
        SELECT created_at FROM transactions
        WHERE user_id = ? AND type = ?
        ORDER BY created_at DESC LIMIT 1
        """,
        (user_id, notif_type),
    )
    row = cursor.fetchone()
    return _parse_dt_utc(row['created_at']) if row and row['created_at'] else None


def _should_send_expiry_warning(row, now_utc, target_seconds: float, notif_type: str, cursor) -> bool:
    key_id = row['id']
    secs_left = _seconds_until_expiry(row['expiry_date'], now_utc)
    if not _in_notif_window(secs_left, target_seconds):
        return False
    if _expiry_notification_sent(cursor, key_id, notif_type):
        return False
    renewal_price = _get_renewal_price(row['devices_limit'])
    balance = float(row['balance'] or 0)
    return balance < renewal_price


def extract_referral_id(text: str) -> int:
    """Извлечь referral ID из команды /start
    
    Поддерживаемые форматы:
    - /start ref123456789
    - /start ref=123456789
    """
    # Пробуем формат ref123456789 (без =)
    match = re.search(r'ref(\d+)', text)
    if match:
        return int(match.group(1))
    # Пробуем формат ref=123456789 (с =)
    match = re.search(r'ref=(\d+)', text)
    return int(match.group(1)) if match else None


def extract_promo_code(text: str) -> str | None:
    # /start promo_CODE
    m = re.search(r'promo_([A-Za-z0-9_-]+)', text or '')
    return m.group(1).upper() if m else None


def extract_tracking_code(text: str) -> str | None:
    m = re.search(r'trk_([A-Za-z0-9_-]+)', text or '')
    return m.group(1) if m else None

async def send_streaming_message(
    chat_id: int,
    full_text: str,
    parse_mode: str = "HTML",
    reply_markup=None,
    chunk_size: int = 15,
    delay: float = 0.07,
) -> None:
    """
    Плавно отправляет текст через sendMessageDraft (Bot API 9.3+).
    Если черновики не поддерживаются — падает на editMessageText-стриминг.
    В конце всегда фиксирует финальное сообщение через sendMessage.
    """
    token = BOT_TOKEN
    base_url = f"https://api.telegram.org/bot{token}"
    draft_id = 1  # фиксированный draft_id для чата

    # Разбиваем текст на нарастающие чанки
    chunks = []
    for i in range(chunk_size, len(full_text) + chunk_size, chunk_size):
        chunks.append(full_text[:i])
    if not chunks or chunks[-1] != full_text:
        chunks.append(full_text)

    payload_base = {
        "chat_id": chat_id,
        "parse_mode": parse_mode,
    }
    if reply_markup:
        import json
        from aiogram.utils.serialization import bitwise_compatible
        payload_base["reply_markup"] = reply_markup.model_dump_json() if hasattr(reply_markup, "model_dump_json") else None

    async with aiohttp.ClientSession() as session:
        # --- Пробуем sendMessageDraft ---
        draft_ok = False
        try:
            payload = {**payload_base, "draft_id": draft_id, "text": chunks[0]}
            async with session.post(f"{base_url}/sendMessageDraft", json=payload, timeout=aiohttp.ClientTimeout(total=5)) as resp:
                data = await resp.json()
                draft_ok = data.get("ok", False)
        except Exception:
            draft_ok = False

        if draft_ok:
            # Стримим через sendMessageDraft
            for chunk in chunks[1:]:
                try:
                    payload = {**payload_base, "draft_id": draft_id, "text": chunk}
                    async with session.post(f"{base_url}/sendMessageDraft", json=payload, timeout=aiohttp.ClientTimeout(total=5)) as resp:
                        pass
                except Exception:
                    pass
                await asyncio.sleep(delay)

            # Финализируем: отправляем настоящее сообщение
            final_payload = {**payload_base, "text": full_text}
            if reply_markup:
                final_payload["reply_markup"] = reply_markup.model_dump_json() if hasattr(reply_markup, "model_dump_json") else None
            async with session.post(f"{base_url}/sendMessage", json=final_payload) as resp:
                pass

        else:
            # Fallback: sendMessage + editMessageText
            send_payload = {"chat_id": chat_id, "text": chunks[0], "parse_mode": parse_mode}
            async with session.post(f"{base_url}/sendMessage", json=send_payload) as resp:
                data = await resp.json()
                message_id = data.get("result", {}).get("message_id")

            if message_id:
                for chunk in chunks[1:-1]:
                    await asyncio.sleep(delay)
                    edit_payload = {
                        "chat_id": chat_id,
                        "message_id": message_id,
                        "text": chunk,
                        "parse_mode": parse_mode,
                    }
                    try:
                        async with session.post(f"{base_url}/editMessageText", json=edit_payload, timeout=aiohttp.ClientTimeout(total=5)) as resp:
                            pass
                    except Exception:
                        pass

                # Финальное редактирование с клавиатурой
                final_edit = {
                    "chat_id": chat_id,
                    "message_id": message_id,
                    "text": full_text,
                    "parse_mode": parse_mode,
                }
                if reply_markup:
                    final_edit["reply_markup"] = reply_markup.model_dump_json() if hasattr(reply_markup, "model_dump_json") else None
                async with session.post(f"{base_url}/editMessageText", json=final_edit) as resp:
                    pass


@dp.message(CommandStart())
async def cmd_start(message: types.Message):
    """Обработчик команды /start"""
    telegram_id = message.from_user.id
    
    # Проверка черного списка
    if core.check_blacklist(telegram_id):
        await message.answer(
            notify_msgs.build_ban_message(),
            parse_mode=ParseMode.HTML,
        )
        return
    
    # Извлекаем referral ID / promo из start payload
    referral_id = None
    promo_code = None
    if message.text and 'ref' in message.text:
        referral_id = extract_referral_id(message.text)
    tracking_code = None
    if message.text and 'promo_' in message.text:
        promo_code = extract_promo_code(message.text)
    if message.text and 'trk_' in message.text:
        tracking_code = extract_tracking_code(message.text)
    
    # Нельзя быть своим собственным рефералом
    if referral_id == telegram_id:
        referral_id = None
    
    # Получаем или создаем пользователя
    user = database.get_user_by_telegram_id(telegram_id)
    database.ensure_first_start_at(user['id']) if user else None
    if not user:
        # Создаем нового пользователя
        username = message.from_user.username
        full_name = message.from_user.full_name
        
        # Проверяем referral и рейт-лимит
        referred_by = None
        if referral_id:
            ref_user = database.get_user_by_telegram_id(referral_id)
            if ref_user:
                # Проверяем рейт-лимит: не более 25 рефералов в минуту
                if database.check_referral_rate_limit(referral_id, limit=25, window_seconds=60):
                    referred_by = ref_user['id']
                    logger.info(f"Referral accepted: user {telegram_id} referred by {referral_id}")
                else:
                    logger.warning(f"Referral rate limit exceeded for referrer {referral_id}")
        
        user_id = database.create_user(telegram_id, username, full_name, referred_by)
        user = database.get_user_by_id(user_id)
        database.ensure_first_start_at(user_id)
    else:
        # Пользователь уже существует - попробуем установить реферера, если его нет
        if referral_id and user.get('referred_by') is None:
            ref_user = database.get_user_by_telegram_id(referral_id)
            if ref_user:
                # Проверяем рейт-лимит
                if database.check_referral_rate_limit(referral_id, limit=25, window_seconds=60):
                    if database.set_referrer_for_user(user['id'], ref_user['id']):
                        logger.info(f"Referral set for existing user {telegram_id} -> {referral_id}")
                        # Обновляем данные пользователя
                        user = database.get_user_by_telegram_id(telegram_id)
                else:
                    logger.warning(f"Referral rate limit exceeded for referrer {referral_id}")
        database.ensure_first_start_at(user['id'])
    
    # Проверяем статус бана
    if user.get('is_banned'):
        ban_reason = (user.get('ban_reason') or '').strip()
        if ban_reason in ('', 'Аккаунт заблокирован'):
            ban_reason = None
        await message.answer(
            notify_msgs.build_ban_message(ban_reason),
            parse_mode=ParseMode.HTML,
            reply_markup=InlineKeyboardMarkup(inline_keyboard=[[
                InlineKeyboardButton(text="Служба поддержки", url=os.getenv("SUPPORT_URL", "https://t.me/blinteambot"))
            ]])
        )
        return
    
    # Формируем сообщение (/start) с HTML и premium emoji
    text = (
        '<tg-emoji emoji-id="5456561606592866295">🔥</tg-emoji> <b>Добро пожаловать в БлинВПН!</b>\n\n'
        'Мы — безопасный VPN, который использует <b>лучшие протоколы</b> для ускорения интернета и защиты ваших данных.\n'
        '<b>Не верите?</b> Дарим 3 дня бесплатного тестирования!\n\n'
        '<b>Нажми на кнопку ниже, чтобы открыть мини-приложение</b> <tg-emoji emoji-id="5305522282695768654">👇</tg-emoji>'
    )

    # Кнопка Mini App
    keyboard = InlineKeyboardMarkup(inline_keyboard=[
        [
            InlineKeyboardButton(
                text="Открыть мини-приложение",
                icon_custom_emoji_id="6008258140108231117",
                web_app=WebAppInfo(url=WEB_APP_URL)
            )
        ],
        [
            InlineKeyboardButton(
                text="Подключить прокси",
                url="tg://proxy?server=proxy.blann.ru&port=443&secret=ee79612e7275c47de70bcd8b628abeb8",
                icon_custom_emoji_id="5875465628285931233",
                style=ButtonStyle.PRIMARY
            )
        ]
    ])

    await send_streaming_message(
        chat_id=message.chat.id,
        full_text=text,
        parse_mode=ParseMode.HTML,
        reply_markup=keyboard,
        chunk_size=15,
        delay=0.06,
    )

    if tracking_code:
        try:
            conn = database.get_db_connection()
            cursor = conn.cursor()
            cursor.execute("UPDATE tracking_links SET clicks = clicks + 1 WHERE code = ?", (tracking_code,))
            cursor.execute("SELECT promocode FROM tracking_links WHERE code = ?", (tracking_code,))
            tr = cursor.fetchone()
            conn.commit()
            conn.close()
            if tr and tr['promocode'] and not promo_code:
                promo_code = tr['promocode']
        except Exception as e:
            logger.warning(f"tracking link update failed: {e}")

    # Auto-activate promo from special start link
    if promo_code and user:
        try:
            result = core.apply_promocode(user['id'], promo_code)
            if result.get('success'):
                await message.answer(
                    notify_msgs.build_promo_activated_message(
                        promo_code, result.get('message', '')
                    ),
                    parse_mode=ParseMode.HTML,
                )
            else:
                await message.answer(
                    notify_msgs.build_promo_failed_message(
                        promo_code, result.get('error', 'не удалось применить')
                    ),
                    parse_mode=ParseMode.HTML,
                )
        except Exception as e:
            logger.warning(f"Promo auto-apply failed: {e}")


@dp.pre_checkout_query()
async def on_pre_checkout_query(pre_checkout_query: PreCheckoutQuery):
    """Telegram Stars: ответ на pre_checkout в течение 10 сек (иначе оплата зависает)."""
    try:
        if hasattr(pre_checkout_query, "model_dump"):
            pcq = pre_checkout_query.model_dump(mode="json")
        else:
            pcq = pre_checkout_query.dict()
        ok, err = telegram_stars.validate_pre_checkout(pcq)
        await pre_checkout_query.answer(ok=ok, error_message=err)
    except Exception as e:
        logger.error("pre_checkout_query handler error: %s", e)
        try:
            await pre_checkout_query.answer(ok=False, error_message="Ошибка сервера, попробуйте снова")
        except Exception:
            pass


@dp.message(F.successful_payment)
async def on_successful_payment(message: Message):
    """Telegram Stars: зачисление после успешной оплаты."""
    try:
        sp = message.successful_payment
        if not sp:
            return
        successful = sp.model_dump() if hasattr(sp, "model_dump") else sp.dict()
        telegram_stars.process_successful_payment(successful)
    except Exception as e:
        logger.error("successful_payment handler error: %s", e)


@dp.message(Command("support"))
async def cmd_support(message: types.Message):
    await message.answer(
        notify_msgs.build_support_command_message(),
        reply_markup=InlineKeyboardMarkup(inline_keyboard=[[
            InlineKeyboardButton(
                text=notify_msgs.BUTTON_SUPPORT,
                url=os.getenv("SUPPORT_URL", "https://t.me/blinteambot"),
            )
        ]])
    )


@dp.message()
async def unknown_command_handler(message: types.Message):
    """Unknown commands fallback"""
    if message.text and message.text.startswith('/'):
        await message.answer(
            notify_msgs.build_unknown_command_message(),
            reply_markup=InlineKeyboardMarkup(inline_keyboard=[[
                InlineKeyboardButton(
                    text=notify_msgs.BUTTON_SUPPORT,
                    url=os.getenv("SUPPORT_URL", "https://t.me/blinteambot"),
                )
            ]])
        )


# ========== Обработчики callback для запросов на вывод ==========

# Состояния для ожидания причины отказа
withdrawal_reject_states = {}

@dp.callback_query(F.data.startswith('withdraw_approve_'))
async def handle_withdraw_approve(callback: CallbackQuery):
    """Одобрить заявку — уведомить пользователя, показать админу кнопку «Я выполнил»."""
    try:
        transaction_id = int(callback.data.split('_')[-1])

        conn = database.get_db_connection()
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT t.*, u.telegram_id
            FROM transactions t
            JOIN users u ON t.user_id = u.id
            WHERE t.id = ?
            """,
            (transaction_id,),
        )
        transaction = cursor.fetchone()
        if not transaction:
            await callback.answer('Транзакция не найдена', show_alert=True)
            return
        if transaction['status'] != 'Pending':
            await callback.answer('Заявка уже обработана', show_alert=True)
            return

        cursor.execute(
            "UPDATE transactions SET status = 'Approved' WHERE id = ?",
            (transaction_id,),
        )
        conn.commit()
        conn.close()

        amount = abs(float(transaction['amount']))
        core.send_notification_to_user(
            transaction['telegram_id'],
            notify_msgs.build_withdrawal_approved_message(
                transaction_id, amount, transaction['payment_method'] or ''
            ),
        )

        complete_keyboard = InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(
                text='✅ Я выполнил',
                callback_data=f'withdraw_complete_{transaction_id}',
            )],
            [InlineKeyboardButton(
                text='❌ Отмена',
                callback_data=f'withdraw_cancel_{transaction_id}',
            )],
        ])
        await callback.message.edit_reply_markup(reply_markup=complete_keyboard)
        await callback.answer('Заявка одобрена. Нажмите «Я выполнил» после перевода.')
    except Exception as e:
        logger.error(f"Error handling withdraw approve: {e}")
        await callback.answer('Ошибка обработки', show_alert=True)


@dp.callback_query(F.data.startswith('withdraw_complete_'))
async def handle_withdraw_complete(callback: CallbackQuery):
    """Подтвердить выполнение перевода — финальное уведомление пользователю."""
    try:
        transaction_id = int(callback.data.split('_')[-1])

        conn = database.get_db_connection()
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT t.*, u.telegram_id
            FROM transactions t
            JOIN users u ON t.user_id = u.id
            WHERE t.id = ?
            """,
            (transaction_id,),
        )
        transaction = cursor.fetchone()
        if not transaction:
            await callback.answer('Транзакция не найдена', show_alert=True)
            return
        if transaction['status'] != 'Approved':
            await callback.answer('Сначала одобрите заявку', show_alert=True)
            return

        cursor.execute(
            "UPDATE transactions SET status = 'Success' WHERE id = ?",
            (transaction_id,),
        )
        conn.commit()
        conn.close()

        amount = abs(float(transaction['amount']))
        core.send_notification_to_user(
            transaction['telegram_id'],
            notify_msgs.build_withdrawal_completed_message(
                transaction_id, amount, transaction['payment_method'] or ''
            ),
        )

        await callback.message.delete()
        await callback.answer('Вывод отмечен как выполненный!', show_alert=True)
    except Exception as e:
        logger.error(f"Error completing withdrawal: {e}")
        await callback.answer('Ошибка обработки', show_alert=True)


@dp.callback_query(F.data.startswith('withdraw_reject_'))
async def handle_withdraw_reject(callback: CallbackQuery):
    """Обработка отказа в выводе"""
    try:
        transaction_id = int(callback.data.split('_')[-1])
        
        # Запрашиваем причину отказа
        reason_keyboard = InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(text='Без причины', callback_data=f'withdraw_reject_confirm_{transaction_id}_none')],
            [InlineKeyboardButton(text='Подозрительная активность', callback_data=f'withdraw_reject_confirm_{transaction_id}_suspicious')],
            [InlineKeyboardButton(text='Неверные реквизиты', callback_data=f'withdraw_reject_confirm_{transaction_id}_invalid')],
            [InlineKeyboardButton(text='❌ Отмена', callback_data=f'withdraw_cancel_{transaction_id}')]
        ])
        
        await callback.message.edit_reply_markup(reply_markup=reason_keyboard)
        await callback.answer('Выберите причину отказа')
    except Exception as e:
        logger.error(f"Error handling withdraw reject: {e}")
        await callback.answer('Ошибка обработки', show_alert=True)


@dp.callback_query(F.data.startswith('withdraw_reject_confirm_'))
async def handle_withdraw_reject_confirm(callback: CallbackQuery):
    """Подтверждение отказа с причиной"""
    try:
        parts = callback.data.split('_')
        transaction_id = int(parts[3])
        reason_code = parts[4] if len(parts) > 4 else 'none'
        
        reasons = {
            'none': '',
            'suspicious': 'Подозрительная активность',
            'invalid': 'Неверные реквизиты'
        }
        reason = reasons.get(reason_code, '')
        
        conn = database.get_db_connection()
        cursor = conn.cursor()
        
        # Получаем информацию о транзакции
        cursor.execute("""
            SELECT t.*, u.telegram_id, u.username
            FROM transactions t
            JOIN users u ON t.user_id = u.id
            WHERE t.id = ?
        """, (transaction_id,))
        
        transaction = cursor.fetchone()
        if not transaction:
            await callback.answer('Транзакция не найдена', show_alert=True)
            return
        if transaction['status'] not in ('Pending', 'Approved'):
            await callback.answer('Заявка уже завершена', show_alert=True)
            return
        
        amount = abs(float(transaction['amount']))
        user_id = transaction['user_id']
        
        cursor.execute("""
            UPDATE users SET partner_balance = partner_balance + ? WHERE id = ?
        """, (amount, user_id))
        
        cursor.execute("""
            UPDATE transactions SET status = 'Rejected', description = description || ' | Причина отказа: ' || ? WHERE id = ?
        """, (reason or 'Не указана', transaction_id))
        
        conn.commit()
        conn.close()
        
        core.send_notification_to_user(
            transaction['telegram_id'],
            notify_msgs.build_withdrawal_rejected_message(transaction_id, amount, reason),
        )
        
        # Удаляем сообщение с запросом
        await callback.message.delete()
        await callback.answer('Вывод отклонён, средства возвращены', show_alert=True)
        
    except Exception as e:
        logger.error(f"Error confirming rejection: {e}")
        await callback.answer('Ошибка обработки', show_alert=True)


@dp.callback_query(F.data.startswith('withdraw_cancel_'))
async def handle_withdraw_cancel(callback: CallbackQuery):
    """Отмена действия — вернуть кнопки к текущему статусу заявки."""
    try:
        transaction_id = int(callback.data.split('_')[-1])
        conn = database.get_db_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT status FROM transactions WHERE id = ?", (transaction_id,))
        row = cursor.fetchone()
        conn.close()

        status = row['status'] if row else 'Pending'
        if status == 'Approved':
            keyboard = InlineKeyboardMarkup(inline_keyboard=[
                [InlineKeyboardButton(
                    text='✅ Я выполнил',
                    callback_data=f'withdraw_complete_{transaction_id}',
                )],
                [InlineKeyboardButton(
                    text='❌ Отказать',
                    callback_data=f'withdraw_reject_{transaction_id}',
                )],
            ])
        else:
            keyboard = InlineKeyboardMarkup(inline_keyboard=[
                [
                    InlineKeyboardButton(text='✅ Одобрить', callback_data=f'withdraw_approve_{transaction_id}'),
                    InlineKeyboardButton(text='❌ Отказать', callback_data=f'withdraw_reject_{transaction_id}'),
                ],
            ])

        await callback.message.edit_reply_markup(reply_markup=keyboard)
        await callback.answer('Действие отменено')
    except Exception as e:
        logger.error(f"Error canceling: {e}")
        await callback.answer('Ошибка', show_alert=True)


async def subscription_notifications_task():
    """Уведомления по подписке: точное время до expiry, grace 7 дней, удаление."""
    while True:
        try:
            core.sync_expiry_from_remnawave()

            conn = database.get_db_connection()
            cursor = conn.cursor()

            from datetime import datetime, timedelta
            now_utc = datetime.utcnow()

            cursor.execute("""
                SELECT vk.id, vk.expiry_date, vk.devices_limit,
                       u.id as user_id, u.telegram_id, u.balance
                FROM vpn_keys vk
                JOIN users u ON vk.user_id = u.id
                WHERE vk.status = 'Active' AND vk.expiry_date IS NOT NULL
            """)
            active_keys = cursor.fetchall()

            # === 1. За 3 / 2 / 1 день и 2 часа (ровно до момента expiry, только при нехватке баланса) ===
            warning_intervals = [
                (3 * 86400, 'expiry_warn_3d', '3 дня', False),
                (2 * 86400, 'expiry_warn_2d', '2 дня', False),
                (1 * 86400, 'expiry_warn_1d', '1 день', False),
                (2 * 3600, 'expiry_warn_2h', '2 часа', True),
            ]

            for target_secs, notif_type, time_text, almost in warning_intervals:
                for row in active_keys:
                    if not _should_send_expiry_warning(row, now_utc, target_secs, notif_type, cursor):
                        continue
                    key_id = row['id']
                    renewal_price = _get_renewal_price(row['devices_limit'])
                    balance = float(row['balance'] or 0)
                    topup = max(0.0, round(renewal_price - balance, 2))
                    msg = notify_msgs.build_expiry_warning_message(
                        key_id, time_text, balance, topup, almost=almost
                    )
                    if core.send_notification_to_user(row['telegram_id'], msg):
                        _mark_expiry_notification_sent(cursor, row['user_id'], key_id, notif_type)
                        logger.info(
                            f"Sent expiry warning ({time_text}) to {row['telegram_id']} for key {key_id}"
                        )

            # === 2. Подписка истекла (в окне ±2.5 мин от expiry; догон до 2 ч при простое бота) ===
            for row in active_keys:
                secs_left = _seconds_until_expiry(row['expiry_date'], now_utc)
                key_id = row['id']

                if secs_left > _NOTIF_WINDOW_SEC:
                    continue

                renewal_price = _get_renewal_price(row['devices_limit'])
                balance = float(row['balance'] or 0)

                if balance >= renewal_price:
                    cursor.execute("UPDATE vpn_keys SET status = 'Expired' WHERE id = ?", (key_id,))
                    continue

                if not _expiry_notification_sent(cursor, key_id, 'expiry_expired'):
                    in_exact_window = secs_left >= -_NOTIF_WINDOW_SEC
                    catch_up = secs_left >= -7200
                    if in_exact_window or catch_up:
                        msg = notify_msgs.build_expiry_expired_message(key_id, _GRACE_PERIOD_DAYS)
                        if core.send_notification_to_user(row['telegram_id'], msg):
                            _mark_expiry_notification_sent(
                                cursor, row['user_id'], key_id, 'expiry_expired'
                            )
                            logger.info(
                                f"Subscription expired notice sent to {row['telegram_id']} for key {key_id}"
                            )
                cursor.execute("UPDATE vpn_keys SET status = 'Expired' WHERE id = ?", (key_id,))

            # === 3. Ежедневно в grace-период (7 дней после истечения) ===
            cursor.execute("""
                SELECT vk.id, vk.expiry_date, u.id as user_id, u.telegram_id
                FROM vpn_keys vk
                JOIN users u ON vk.user_id = u.id
                WHERE vk.status = 'Expired' AND vk.expiry_date IS NOT NULL
            """)
            for row in cursor.fetchall():
                secs_since = -_seconds_until_expiry(row['expiry_date'], now_utc)
                if secs_since <= 0:
                    continue
                key_id = row['id']
                for day in range(1, _GRACE_PERIOD_DAYS + 1):
                    if secs_since < day * 86400:
                        continue
                    notif_type = f'grace_daily_{day}'
                    if _expiry_notification_sent(cursor, key_id, notif_type):
                        continue
                    days_left = _GRACE_PERIOD_DAYS - day
                    msg = notify_msgs.build_grace_daily_message(key_id, days_left)
                    if core.send_notification_to_user(row['telegram_id'], msg):
                        _mark_expiry_notification_sent(cursor, row['user_id'], key_id, notif_type)
                        logger.info(
                            f"Grace daily ({days_left}d left) sent to {row['telegram_id']} for key {key_id}"
                        )

            # === 4. Удаление через 7 дней (Remnawave + БД + уведомление) ===
            grace_cutoff = now_utc - timedelta(days=_GRACE_PERIOD_DAYS)
            cursor.execute("""
                SELECT vk.id, vk.key_uuid, vk.user_id, vk.expiry_date, u.telegram_id
                FROM vpn_keys vk
                JOIN users u ON vk.user_id = u.id
                WHERE vk.status = 'Expired'
                  AND vk.expiry_date IS NOT NULL
                  AND datetime(vk.expiry_date) < ?
            """, (grace_cutoff.isoformat(),))

            for row in cursor.fetchall():
                _delete_subscription_fully(
                    cursor,
                    row['id'],
                    row['key_uuid'],
                    row['user_id'],
                    row['telegram_id'],
                    row['expiry_date'],
                )
                logger.info(
                    f"Auto-deleted expired key {row['id']} for user {row['user_id']} "
                    f"after {_GRACE_PERIOD_DAYS} days"
                )

            conn.commit()
            conn.close()

        except Exception as e:
            logger.error(f"Error in subscription_notifications_task: {e}", exc_info=True)
        await asyncio.sleep(_NOTIF_TICK_SEC)


async def user_engagement_notifications_task():
    """Напоминания без подписки (раз в 3 дня) и одноразовая скидка 10% на 24 часа."""
    while True:
        try:
            database.clear_expired_discount_offers()

            from datetime import datetime, timedelta
            now_utc = datetime.utcnow()

            conn = database.get_db_connection()
            cursor = conn.cursor()

            cursor.execute("""
                SELECT id, telegram_id, balance, trial_used, created_at,
                       first_start_at, discount_offer_expires_at
                FROM users
                WHERE (is_banned = 0 OR is_banned IS NULL)
            """)
            users = cursor.fetchall()

            for row in users:
                user_id = row['id']
                telegram_id = row['telegram_id']

                if database.user_has_active_subscription(user_id):
                    continue

                # --- Одноразовая скидка 10% на 24 часа (только после успешной отправки) ---
                if not _user_notification_sent(cursor, user_id, 'discount_offer_24h'):
                    if not database.user_has_paid_subscription_purchase(user_id):
                        offer_reason = None
                        first_start = _parse_dt_utc(
                            row['first_start_at'] or row['created_at']
                        )
                        trial_expiry_raw = database.get_last_trial_expiry_iso(user_id)

                        if trial_expiry_raw:
                            trial_end = _parse_dt_utc(trial_expiry_raw)
                            if trial_end and now_utc >= trial_end + timedelta(hours=24):
                                offer_reason = 'after_trial'
                        elif (
                            first_start
                            and now_utc >= first_start + timedelta(hours=24)
                            and not database.user_ever_had_subscription(user_id)
                        ):
                            offer_reason = 'no_sub_24h'

                        if offer_reason:
                            msg = notify_msgs.build_discount_offer_message()
                            if core.send_notification_to_user(telegram_id, msg):
                                database.grant_24h_discount_offer(user_id)
                                _mark_user_notification_sent(cursor, user_id, 'discount_offer_24h')
                                logger.info(
                                    f"24h discount offer ({offer_reason}) sent to {telegram_id}"
                                )

                if database.user_in_grace_period(user_id):
                    continue

                first_start = _parse_dt_utc(row['first_start_at'] or row['created_at'])
                if not first_start:
                    continue
                if now_utc < first_start + timedelta(seconds=_NO_SUB_AFTER_START_SEC):
                    continue

                had_subscription = database.user_ever_had_subscription(user_id)
                last_expiry_raw = database.get_user_last_subscription_expiry_iso(user_id)
                last_expiry = _parse_dt_utc(last_expiry_raw) if last_expiry_raw else None

                if had_subscription and last_expiry:
                    period_end = last_expiry + timedelta(days=_NO_SUB_MAX_DAYS)
                    if now_utc >= period_end:
                        last_sent = _last_user_notification_at(cursor, user_id, 'comeback_reminder')
                        if last_sent and (now_utc - last_sent).total_seconds() < _COMEBACK_INTERVAL_SEC:
                            continue
                        msg = notify_msgs.build_comeback_message()
                        if core.send_notification_to_user(telegram_id, msg):
                            _mark_user_notification_sent(cursor, user_id, 'comeback_reminder')
                            logger.info(f"Comeback reminder sent to {telegram_id}")
                        continue

                if now_utc > first_start + timedelta(days=_NO_SUB_MAX_DAYS):
                    continue
                last_sent = _last_user_notification_at(cursor, user_id, 'no_sub_reminder')
                if last_sent and (now_utc - last_sent).total_seconds() < _NO_SUB_INTERVAL_SEC:
                    continue
                msg = notify_msgs.build_no_sub_message()
                if core.send_notification_to_user(telegram_id, msg):
                    _mark_user_notification_sent(cursor, user_id, 'no_sub_reminder')
                    logger.info(f"No-sub reminder sent to {telegram_id}")

            conn.commit()
            conn.close()

        except Exception as e:
            logger.error(f"Error in user_engagement_notifications_task: {e}", exc_info=True)
        await asyncio.sleep(1800)


async def auto_renewal_task():
    """Фоновая задача для автоматического продления подписок за 60 минут до истечения. Сравнение в UTC."""
    while True:
        try:
            await asyncio.sleep(300)  # Проверка каждые 5 минут
            
            core.sync_expiry_from_remnawave()
            
            conn = database.get_db_connection()
            cursor = conn.cursor()
            
            from datetime import datetime, timedelta
            now_utc = datetime.utcnow()
            
            # Находим подписки, истекающие через 55-65 минут (окно 10 минут)
            check_window_start = now_utc + timedelta(minutes=55)
            check_window_end = now_utc + timedelta(minutes=65)
            
            cursor.execute("""
                SELECT vk.id, vk.key_uuid, vk.expiry_date, vk.plan_type, vk.traffic_limit,
                       vk.devices_limit, u.id as user_id, u.telegram_id, u.balance, u.username
                FROM vpn_keys vk
                JOIN users u ON vk.user_id = u.id
                WHERE vk.status = 'Active'
                  AND datetime(vk.expiry_date) BETWEEN ? AND ?
            """, (check_window_start.isoformat(), check_window_end.isoformat()))
            
            expiring_keys = cursor.fetchall()
            
            for row in expiring_keys:
                key_id = row['id']
                key_uuid = row['key_uuid']
                user_id = row['user_id']
                telegram_id = row['telegram_id']
                balance = float(row['balance'] or 0)
                
                renewal_price = _get_renewal_price(row['devices_limit'])
                renewal_days = _AUTO_RENEWAL_DAYS
                
                # Проверяем, достаточно ли средств на балансе
                if balance >= renewal_price:
                    try:
                        # Списываем баланс
                        cursor.execute("BEGIN IMMEDIATE")
                        cursor.execute("SELECT balance FROM users WHERE id = ?", (user_id,))
                        current_balance = float(cursor.fetchone()['balance'] or 0)
                        
                        if current_balance >= renewal_price:
                            # Списываем
                            new_balance = current_balance - renewal_price
                            cursor.execute("UPDATE users SET balance = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
                                         (new_balance, user_id))
                            
                            # Рассчитываем новую дату истечения
                            current_expiry = datetime.fromisoformat(row['expiry_date'].replace('Z', '+00:00').replace('+00:00', ''))
                            new_expiry = current_expiry + timedelta(days=renewal_days)
                            
                            # Обновляем ключ в Remnawave
                            if key_uuid:
                                try:
                                    from src.api import remnawave
                                    remnawave.remnawave_api.update_user_sync(
                                        uuid=key_uuid,
                                        expire_at=new_expiry
                                    )
                                except Exception as e:
                                    logger.error(f"Failed to update key {key_uuid} in Remnawave: {e}")
                                    cursor.execute("ROLLBACK")
                                    continue
                            
                            # Обновляем ключ в БД
                            cursor.execute("""
                                UPDATE vpn_keys SET expiry_date = ? WHERE id = ?
                            """, (new_expiry.isoformat(), key_id))
                            
                            # Создаем транзакцию
                            cursor.execute("""
                                INSERT INTO transactions (user_id, type, amount, status, description, payment_method)
                                VALUES (?, 'auto_renewal', ?, 'Success', 'Автоматическое продление подписки (30 дней)', 'Balance')
                            """, (user_id, -renewal_price))
                            
                            conn.commit()
                            
                            core.send_notification_to_user(
                                telegram_id,
                                notify_msgs.build_auto_renewal_message(key_id, new_balance),
                            )
                            
                            logger.info(f"Auto-renewed subscription for user {user_id} (key {key_id})")
                        else:
                            conn.rollback()
                            
                    except Exception as e:
                        logger.error(f"Error auto-renewing subscription for key {key_id}: {e}")
                        try:
                            conn.rollback()
                        except:
                            pass
                # Недостаточно средств — уведомления за 3/2/1 день отправляет subscription_notifications_task
            
            conn.close()
            
        except Exception as e:
            logger.error(f"Error in auto_renewal_task: {e}")
            import traceback
            traceback.print_exc()
            await asyncio.sleep(60)


async def auto_refund_expired_withdrawals():
    """Фоновая задача для автовозврата просроченных запросов на вывод (7 дней)"""
    while True:
        try:
            await asyncio.sleep(3600)  # Проверка каждый час
            
            conn = database.get_db_connection()
            cursor = conn.cursor()
            
            # Находим просроченные запросы (старше 7 дней)
            cursor.execute("""
                SELECT t.id, t.user_id, t.amount, u.telegram_id
                FROM transactions t
                JOIN users u ON t.user_id = u.id
                WHERE t.type = 'withdrawal_request' 
                  AND t.status IN ('Pending', 'Approved')
                  AND datetime(t.created_at) < datetime('now', '-7 days')
            """)
            
            expired = cursor.fetchall()
            
            for row in expired:
                trans_id = row['id']
                user_id = row['user_id']
                amount = abs(float(row['amount']))
                telegram_id = row['telegram_id']
                
                # Возвращаем деньги на реферальный баланс
                cursor.execute("""
                    UPDATE users SET partner_balance = partner_balance + ? WHERE id = ?
                """, (amount, user_id))
                
                # Обновляем статус транзакции
                cursor.execute("""
                    UPDATE transactions SET status = 'Expired', description = description || ' | Автовозврат через 7 дней'
                    WHERE id = ?
                """, (trans_id,))
                
                # Уведомляем пользователя
                core.send_notification_to_user(
                    telegram_id,
                    notify_msgs.build_withdrawal_expired_refund_message(amount),
                )
                
                logger.info(f"Auto-refunded withdrawal #{trans_id} for user {user_id}: {amount}₽")
            
            conn.commit()
            conn.close()
            
        except Exception as e:
            logger.error(f"Error in auto_refund_expired_withdrawals: {e}")
            await asyncio.sleep(60)  # При ошибке ждём минуту


async def main():
    """Запуск бота"""
    # Запускаем обновление черного списка
    start_blacklist_updater()
    
    # Запускаем фоновые задачи
    asyncio.create_task(auto_refund_expired_withdrawals())
    asyncio.create_task(subscription_notifications_task())
    asyncio.create_task(user_engagement_notifications_task())
    asyncio.create_task(auto_renewal_task())  # Автопродление за 60 минут до истечения
    
    logger.info("Бот запущен...")
    # Stars обрабатываются через polling (pre_checkout_query + successful_payment).
    # Webhook с install.sh сбрасывался при каждом рестарте бота — из-за этого оплата зависала.
    await bot.delete_webhook(drop_pending_updates=False)
    await dp.start_polling(
        bot,
        allowed_updates=["message", "callback_query", "pre_checkout_query"],
    )

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        logger.info("Бот остановлен")
