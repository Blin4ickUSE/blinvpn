"""
Бот службы поддержки - Telegram Business Mode
Бот подключается к бизнес-аккаунту и отвечает от его имени в личных чатах
"""
import asyncio
import logging
import os
import sys
from aiogram import Bot, Dispatcher, types, F
from aiogram.filters import CommandStart, Command
from aiogram.types import InlineKeyboardMarkup, InlineKeyboardButton

# Добавляем путь к backend
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '../../'))

from backend.database import database
from backend.core import core

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

BOT_TOKEN = os.getenv('SUPPORT_BOT_TOKEN', '')
MAIN_BOT_TOKEN = os.getenv('TELEGRAM_BOT_TOKEN', '')

# Валидация токенов
if not BOT_TOKEN:
    logger.error("❌ SUPPORT_BOT_TOKEN не указан в .env!")
    sys.exit(1)

if BOT_TOKEN == MAIN_BOT_TOKEN:
    logger.error("❌ КРИТИЧЕСКАЯ ОШИБКА: SUPPORT_BOT_TOKEN совпадает с TELEGRAM_BOT_TOKEN!")
    sys.exit(1)

bot = Bot(token=BOT_TOKEN)
dp = Dispatcher()

# Хранилище закрепленных сообщений с информацией о пользователях
# {chat_id: pinned_message_id}
pinned_info_messages = {}


def get_user_info(user_id: int) -> dict:
    """Получить информацию о пользователе"""
    user = database.get_user_by_id(user_id)
    if not user:
        return {}
    
    conn = database.get_db_connection()
    cursor = conn.cursor()
    
    cursor.execute("""
        SELECT COUNT(*) as total, 
               SUM(CASE WHEN status = 'Banned' THEN 1 ELSE 0 END) as banned
        FROM vpn_keys
        WHERE user_id = ?
    """, (user_id,))
    
    keys_stats = cursor.fetchone()
    total_keys = keys_stats[0] if keys_stats else 0
    banned_keys = keys_stats[1] if keys_stats else 0
    
    cursor.execute("SELECT COUNT(*) FROM users WHERE referred_by = ?", (user_id,))
    referrals_row = cursor.fetchone()
    referrals_count = referrals_row[0] if referrals_row else 0
    
    cursor.execute("""
        SELECT COALESCE(SUM(amount), 0) FROM transactions 
        WHERE user_id = ? AND type IN ('deposit', 'Пополнение')
    """, (user_id,))
    total_paid = cursor.fetchone()[0] or 0
    
    conn.close()
    
    return {
        'id': user['id'],
        'telegram_id': user['telegram_id'],
        'username': user.get('username', 'N/A'),
        'balance': user.get('balance', 0),
        'status': user.get('status', 'Unknown'),
        'total_keys': total_keys,
        'banned_keys': banned_keys,
        'referrals': referrals_count,
        'trial_used': user.get('trial_used', 0),
        'registration_date': user.get('registration_date', 'N/A'),
        'total_paid': total_paid,
        'referred_by': user.get('referred_by')
    }


def save_ticket_message(user_id: int, message_text: str, is_admin: bool = False):
    """Сохранить сообщение в БД"""
    conn = database.get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("SELECT id FROM tickets WHERE user_id = ?", (user_id,))
        ticket = cursor.fetchone()
        
        if not ticket:
            cursor.execute("INSERT INTO tickets (user_id, status) VALUES (?, 'Open')", (user_id,))
            ticket_id = cursor.lastrowid
        else:
            ticket_id = ticket[0]
            cursor.execute("UPDATE tickets SET status = 'Open' WHERE id = ?", (ticket_id,))
        
        cursor.execute("""
            INSERT INTO ticket_messages (ticket_id, user_id, is_admin, message_text)
            VALUES (?, ?, ?, ?)
        """, (ticket_id, user_id if not is_admin else None, 1 if is_admin else 0, message_text))
        
        cursor.execute("""
            UPDATE tickets
            SET last_message = ?, last_message_time = CURRENT_TIMESTAMP,
                unread_count = CASE WHEN ? = 0 THEN unread_count + 1 ELSE 0 END
            WHERE id = ?
        """, (message_text, 1 if is_admin else 0, ticket_id))
        
        conn.commit()
    finally:
        conn.close()


async def send_user_info_and_pin(chat_id: int, user_id: int, business_connection_id: str = None):
    """Отправить и закрепить информацию о пользователе"""
    user_info = get_user_info(user_id)
    if not user_info:
        return
    
    is_paying = user_info.get('total_paid', 0) > 0 or user_info.get('total_keys', 0) > 0
    
    info_message = (
        f"{'💎' if is_paying else '👤'} <b>{'ПЛАТНЫЙ КЛИЕНТ' if is_paying else 'Клиент'}</b>\n\n"
        f"👤 <b>Username:</b> @{user_info.get('username', 'N/A')}\n"
        f"🆔 <b>Telegram ID:</b> <code>{user_info['telegram_id']}</code>\n"
        f"💰 <b>Баланс:</b> {user_info.get('balance', 0)}₽\n"
        f"💳 <b>Всего оплачено:</b> {user_info.get('total_paid', 0)}₽\n"
        f"🔑 <b>Ключей:</b> {user_info.get('total_keys', 0)} (забанено: {user_info.get('banned_keys', 0)})\n"
        f"👥 <b>Рефералов:</b> {user_info.get('referrals', 0)}\n"
        f"🎁 <b>Триал:</b> {'Использован' if user_info.get('trial_used') else 'Не использован'}\n"
        f"📅 <b>Регистрация:</b> {user_info.get('registration_date', 'N/A')}"
    )
    
    # Кнопки быстрых действий
    keyboard = InlineKeyboardMarkup(inline_keyboard=[
        [
            InlineKeyboardButton(text="💰 +100₽", callback_data=f"add_balance:{user_info['id']}:100"),
            InlineKeyboardButton(text="💰 +500₽", callback_data=f"add_balance:{user_info['id']}:500"),
        ],
        [
            InlineKeyboardButton(text="📅 +7 дней", callback_data=f"add_days:{user_info['id']}:7"),
            InlineKeyboardButton(text="📅 +30 дней", callback_data=f"add_days:{user_info['id']}:30"),
        ],
        [
            InlineKeyboardButton(text="🚫 Забанить", callback_data=f"ban_user:{user_info['id']}"),
            InlineKeyboardButton(text="✅ Разбанить", callback_data=f"unban_user:{user_info['id']}"),
        ]
    ])
    
    try:
        # Отправляем сообщение через business connection если есть
        if business_connection_id:
            info_msg = await bot.send_message(
                chat_id=chat_id,
                text=info_message,
                parse_mode="HTML",
                reply_markup=keyboard,
                business_connection_id=business_connection_id
            )
        else:
            info_msg = await bot.send_message(
                chat_id=chat_id,
                text=info_message,
                parse_mode="HTML",
                reply_markup=keyboard
            )
        
        # Закрепляем сообщение
        try:
            if business_connection_id:
                await bot.pin_chat_message(
                    chat_id=chat_id, 
                    message_id=info_msg.message_id,
                    business_connection_id=business_connection_id,
                    disable_notification=True
                )
            else:
                await bot.pin_chat_message(
                    chat_id=chat_id, 
                    message_id=info_msg.message_id,
                    disable_notification=True
                )
            pinned_info_messages[chat_id] = info_msg.message_id
            logger.info(f"Закреплено сообщение с информацией о пользователе в чате {chat_id}")
        except Exception as e:
            logger.warning(f"Не удалось закрепить сообщение: {e}")
        
        return info_msg
    except Exception as e:
        logger.error(f"Ошибка отправки информации о пользователе: {e}")
        return None


# ========== BUSINESS MODE HANDLERS ==========

@dp.business_connection()
async def handle_business_connection(event: types.BusinessConnection):
    """Обработка подключения/отключения от бизнес-аккаунта"""
    if event.is_enabled:
        logger.info(f"✅ Бот подключен к бизнес-аккаунту пользователя {event.user.id} (@{event.user.username})")
    else:
        logger.info(f"❌ Бот отключен от бизнес-аккаунта пользователя {event.user.id}")


@dp.business_message()
async def handle_business_message(message: types.Message):
    """
    Обработка сообщений через Business Mode.
    Сообщения приходят в чат бизнес-аккаунта с клиентами.
    """
    if not message.business_connection_id:
        return
    
    # Получаем ID пользователя, который написал (клиент)
    user_telegram_id = message.from_user.id
    chat_id = message.chat.id
    
    # Проверяем, от бизнес-аккаунта ли сообщение (ответ поддержки)
    # Если from_user.id совпадает с chat.id - это ответ от бизнес-аккаунта
    is_support_reply = (message.from_user.id == message.chat.id)
    
    if is_support_reply:
        # Это ответ поддержки клиенту - просто сохраняем в БД
        user = database.get_user_by_telegram_id(chat_id)
        if user:
            save_ticket_message(user['id'], message.text or '[Медиа]', is_admin=True)
        return
    
    # Это сообщение от клиента
    user = database.get_user_by_telegram_id(user_telegram_id)
    if not user:
        user_id = database.create_user(
            user_telegram_id,
            message.from_user.username,
            message.from_user.full_name
        )
        user = database.get_user_by_id(user_id)
    else:
        user_id = user['id']
    
    # Проверяем, есть ли уже закрепленное сообщение в этом чате
    if chat_id not in pinned_info_messages:
        # Отправляем и закрепляем информацию о клиенте
        await send_user_info_and_pin(chat_id, user_id, message.business_connection_id)
    
    # Сохраняем сообщение клиента в БД
    save_ticket_message(user_id, message.text or '[Медиа]', is_admin=False)
    
    logger.info(f"Business message от {user_telegram_id} (@{message.from_user.username}): {message.text[:50] if message.text else '[медиа]'}...")


@dp.edited_business_message()
async def handle_edited_business_message(message: types.Message):
    """Обработка редактирования сообщений в business mode"""
    logger.info(f"Отредактировано business сообщение в чате {message.chat.id}")


# ========== FALLBACK: ОБЫЧНЫЙ РЕЖИМ (если Business Mode не подключен) ==========

@dp.message(CommandStart())
async def cmd_start(message: types.Message):
    """Приветствие - для случая когда пишут напрямую боту"""
    keyboard = InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="📱 Открыть приложение", url=f"https://t.me/{os.getenv('BOT_USERNAME', 'blnnnbot')}")]
    ])
    
    await message.answer(
        "👋 <b>Служба поддержки BLIN VPN</b>\n\n"
        "Этот бот работает через Telegram Business.\n"
        "Напишите нам в личные сообщения бизнес-аккаунта для получения поддержки.\n\n"
        "📱 <i>Или откройте мини-приложение:</i>",
        parse_mode="HTML",
        reply_markup=keyboard
    )


@dp.message(Command("info"))
async def cmd_info(message: types.Message):
    """Показать информацию о business connection"""
    await message.answer(
        "ℹ️ <b>Telegram Business Mode</b>\n\n"
        "Этот бот предназначен для работы через Telegram Business.\n\n"
        "<b>Как настроить:</b>\n"
        "1. Подключите Telegram Premium\n"
        "2. Откройте Настройки → Telegram Business\n"
        "3. Выберите 'Чат-боты'\n"
        "4. Добавьте этого бота\n\n"
        "После этого бот будет видеть все сообщения в ваших чатах и сможет отвечать от вашего имени.",
        parse_mode="HTML"
    )


# ========== CALLBACK HANDLERS (работают и в business mode) ==========

@dp.callback_query(F.data.startswith("add_balance:"))
async def callback_add_balance(callback: types.CallbackQuery):
    """Быстрое добавление баланса"""
    parts = callback.data.split(":")
    user_id = int(parts[1])
    amount = int(parts[2])
    
    try:
        user = database.get_user_by_id(user_id)
        if user:
            new_balance = database.update_user_balance(user_id, amount)
            database.add_transaction(user_id, 'Пополнение', amount, 'balance', 'Начислено поддержкой')
            
            # Уведомляем клиента через основного бота
            try:
                main_bot = Bot(token=MAIN_BOT_TOKEN) if MAIN_BOT_TOKEN else None
                if main_bot:
                    await main_bot.send_message(
                        chat_id=user['telegram_id'],
                        text=f"💰 <b>Вам начислено {amount}₽!</b>\n\nВаш баланс: {new_balance}₽",
                        parse_mode="HTML"
                    )
                    await main_bot.session.close()
            except Exception as e:
                logger.warning(f"Не удалось отправить уведомление через основного бота: {e}")
            
            await callback.answer(f"✅ Начислено {amount}₽, баланс: {new_balance}₽")
        else:
            await callback.answer("❌ Пользователь не найден", show_alert=True)
    except Exception as e:
        await callback.answer(f"❌ Ошибка: {e}", show_alert=True)


@dp.callback_query(F.data.startswith("add_days:"))
async def callback_add_days(callback: types.CallbackQuery):
    """Быстрое добавление дней"""
    parts = callback.data.split(":")
    user_id = int(parts[1])
    days = int(parts[2])
    
    try:
        conn = database.get_db_connection()
        cursor = conn.cursor()
        
        cursor.execute("""
            UPDATE vpn_keys
            SET expires_at = datetime(
                CASE WHEN expires_at > datetime('now') THEN expires_at ELSE datetime('now') END,
                '+' || ? || ' days'
            )
            WHERE user_id = ? AND status != 'Banned'
        """, (days, user_id))
        
        updated = cursor.rowcount
        conn.commit()
        conn.close()
        
        if updated > 0:
            user = database.get_user_by_id(user_id)
            if user:
                try:
                    main_bot = Bot(token=MAIN_BOT_TOKEN) if MAIN_BOT_TOKEN else None
                    if main_bot:
                        await main_bot.send_message(
                            chat_id=user['telegram_id'],
                            text=f"🎁 <b>Вам добавлено {days} дней подписки!</b>",
                            parse_mode="HTML"
                        )
                        await main_bot.session.close()
                except:
                    pass
            await callback.answer(f"✅ +{days} дней к {updated} ключам")
        else:
            await callback.answer("⚠️ Нет активных ключей", show_alert=True)
    except Exception as e:
        await callback.answer(f"❌ Ошибка: {e}", show_alert=True)


@dp.callback_query(F.data.startswith("ban_user:"))
async def callback_ban_user(callback: types.CallbackQuery):
    """Быстрый бан пользователя"""
    parts = callback.data.split(":")
    user_id = int(parts[1])
    
    try:
        database.update_user_status(user_id, 'Banned')
        await callback.answer("✅ Пользователь забанен")
    except Exception as e:
        await callback.answer(f"❌ Ошибка: {e}", show_alert=True)


@dp.callback_query(F.data.startswith("unban_user:"))
async def callback_unban_user(callback: types.CallbackQuery):
    """Быстрый разбан пользователя"""
    parts = callback.data.split(":")
    user_id = int(parts[1])
    
    try:
        database.update_user_status(user_id, 'Active')
        user = database.get_user_by_id(user_id)
        if user:
            try:
                main_bot = Bot(token=MAIN_BOT_TOKEN) if MAIN_BOT_TOKEN else None
                if main_bot:
                    await main_bot.send_message(
                        chat_id=user['telegram_id'],
                        text="✅ <b>Ваш аккаунт разблокирован!</b>",
                        parse_mode="HTML"
                    )
                    await main_bot.session.close()
            except:
                pass
        await callback.answer("✅ Пользователь разбанен")
    except Exception as e:
        await callback.answer(f"❌ Ошибка: {e}", show_alert=True)


async def main():
    """Запуск бота"""
    logger.info("🚀 Бот поддержки запущен (Telegram Business Mode)")
    logger.info("   Для работы подключите бота к Telegram Business аккаунту")
    await bot.delete_webhook(drop_pending_updates=True)
    await dp.start_polling(bot, allowed_updates=dp.resolve_used_update_types())


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        logger.info("Бот остановлен")
