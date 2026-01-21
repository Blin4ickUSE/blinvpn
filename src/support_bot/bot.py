"""
Бот службы поддержки - Business Mode
Работает напрямую с админом через личные сообщения
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
ADMIN_CHAT_ID = int(os.getenv('SUPPORT_ADMIN_CHAT_ID', '0'))  # ID админа для получения сообщений

# Валидация токенов
if not BOT_TOKEN:
    logger.error("❌ SUPPORT_BOT_TOKEN не указан в .env!")
    sys.exit(1)

if BOT_TOKEN == MAIN_BOT_TOKEN:
    logger.error("❌ КРИТИЧЕСКАЯ ОШИБКА: SUPPORT_BOT_TOKEN совпадает с TELEGRAM_BOT_TOKEN!")
    sys.exit(1)

if ADMIN_CHAT_ID == 0:
    logger.warning("⚠️ SUPPORT_ADMIN_CHAT_ID не настроен!")

bot = Bot(token=BOT_TOKEN)
dp = Dispatcher()

# Кэш для связи message_id -> user_id (для ответов)
message_user_map = {}
# Кэш для отправленных info-сообщений (чтобы не дублировать)
user_info_sent = set()

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
    
    # Общая сумма пополнений
    cursor.execute("""
        SELECT COALESCE(SUM(amount), 0) FROM transactions 
        WHERE user_id = ? AND type = 'Пополнение'
    """, (user_id,))
    total_paid = cursor.fetchone()[0] or 0
    
    conn.close()
    
    return {
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
        # Проверяем/создаём тикет
        cursor.execute("SELECT id FROM tickets WHERE user_id = ?", (user_id,))
        ticket = cursor.fetchone()
        
        if not ticket:
            cursor.execute("""
                INSERT INTO tickets (user_id, status)
                VALUES (?, 'Open')
            """, (user_id,))
            ticket_id = cursor.lastrowid
        else:
            ticket_id = ticket[0]
            cursor.execute("UPDATE tickets SET status = 'Open' WHERE id = ?", (ticket_id,))
        
        # Сохраняем сообщение
        cursor.execute("""
            INSERT INTO ticket_messages (ticket_id, user_id, is_admin, message_text)
            VALUES (?, ?, ?, ?)
        """, (ticket_id, user_id if not is_admin else None, 1 if is_admin else 0, message_text))
        
        # Обновляем тикет
        cursor.execute("""
            UPDATE tickets
            SET last_message = ?, last_message_time = CURRENT_TIMESTAMP,
                unread_count = CASE WHEN ? = 0 THEN unread_count + 1 ELSE 0 END
            WHERE id = ?
        """, (message_text, 1 if is_admin else 0, ticket_id))
        
        conn.commit()
    finally:
        conn.close()

@dp.message(CommandStart())
async def cmd_start(message: types.Message):
    """Приветствие пользователя"""
    keyboard = InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="📱 Открыть приложение", url=f"https://t.me/{os.getenv('BOT_USERNAME', 'blnnnbot')}")]
    ])
    
    await message.answer(
        "👋 <b>Добро пожаловать в службу поддержки!</b>\n\n"
        "Напишите ваш вопрос, и мы ответим в ближайшее время.\n\n"
        "💡 <i>Пожалуйста, опишите проблему как можно подробнее.</i>",
        parse_mode="HTML",
        reply_markup=keyboard
    )

@dp.message(Command("admin"))
async def cmd_admin(message: types.Message):
    """Команда для админа - показать ID чата"""
    if message.chat.type == 'private':
        await message.answer(
            f"🔧 <b>Настройка бота поддержки</b>\n\n"
            f"Ваш Chat ID: <code>{message.chat.id}</code>\n\n"
            f"Добавьте в .env:\n"
            f"<code>SUPPORT_ADMIN_CHAT_ID={message.chat.id}</code>",
            parse_mode="HTML"
        )

@dp.message(F.chat.type == 'private', F.reply_to_message)
async def handle_admin_reply(message: types.Message):
    """Обработка ответов админа на сообщения пользователей"""
    if message.chat.id != ADMIN_CHAT_ID:
        return
    
    # Ищем user_id по ID сообщения, на которое отвечают
    reply_msg_id = message.reply_to_message.message_id
    user_id = message_user_map.get(reply_msg_id)
    
    if not user_id:
        # Пробуем найти в forwarded_from
        if message.reply_to_message.forward_from:
            telegram_id = message.reply_to_message.forward_from.id
            user = database.get_user_by_telegram_id(telegram_id)
            if user:
                user_id = user['id']
    
    if not user_id:
        await message.reply("❌ Не удалось определить получателя. Ответьте на пересланное сообщение пользователя.")
        return
    
    try:
        user = database.get_user_by_id(user_id)
        if not user:
            await message.reply("❌ Пользователь не найден в БД")
            return
        
        telegram_id = user['telegram_id']
        
        # Отправляем ответ пользователю
        if message.photo:
            await bot.send_photo(
                chat_id=telegram_id,
                photo=message.photo[-1].file_id,
                caption=message.caption or '',
                parse_mode='HTML'
            )
        elif message.document:
            await bot.send_document(
                chat_id=telegram_id,
                document=message.document.file_id,
                caption=message.caption or '',
                parse_mode='HTML'
            )
        elif message.video:
            await bot.send_video(
                chat_id=telegram_id,
                video=message.video.file_id,
                caption=message.caption or '',
                parse_mode='HTML'
            )
        elif message.voice:
            await bot.send_voice(chat_id=telegram_id, voice=message.voice.file_id)
        elif message.sticker:
            await bot.send_sticker(chat_id=telegram_id, sticker=message.sticker.file_id)
        else:
            text = message.html_text if message.html_text else message.text
            await bot.send_message(
                chat_id=telegram_id,
                text=text,
                parse_mode='HTML' if message.html_text else None
            )
        
        # Сохраняем в БД
        save_ticket_message(user_id, message.text or '[Медиа]', is_admin=True)
        
        # Подтверждение админу
        await message.reply("✅ Ответ отправлен")
        
    except Exception as e:
        logger.error(f"Ошибка отправки ответа: {e}")
        await message.reply(f"❌ Ошибка: {e}")

@dp.message(F.chat.type == 'private')
async def handle_user_message(message: types.Message):
    """Обработка сообщений от пользователей"""
    # Если это админ и не reply - игнорируем
    if message.chat.id == ADMIN_CHAT_ID and not message.reply_to_message:
        return
    
    user_telegram_id = message.from_user.id
    
    # Получаем или создаем пользователя
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
    
    # Проверяем, отправляли ли уже инфо об этом пользователе
    should_send_info = user_id not in user_info_sent
    
    try:
        # Сначала отправляем информацию о пользователе (один раз) и закрепляем
        if should_send_info:
            user_info = get_user_info(user_id)
            is_paying = user_info.get('total_paid', 0) > 0 or user_info.get('total_keys', 0) > 0
            
            info_message = (
                f"{'💎' if is_paying else '👤'} <b>{'ПЛАТНЫЙ КЛИЕНТ' if is_paying else 'Новое обращение'}</b>\n\n"
                f"👤 <b>Пользователь:</b> @{user_info.get('username', 'N/A')}\n"
                f"🆔 <b>Telegram ID:</b> <code>{user_info['telegram_id']}</code>\n"
                f"💰 <b>Баланс:</b> {user_info.get('balance', 0)}₽\n"
                f"💳 <b>Всего оплачено:</b> {user_info.get('total_paid', 0)}₽\n"
                f"🔑 <b>Ключей:</b> {user_info.get('total_keys', 0)} (забанено: {user_info.get('banned_keys', 0)})\n"
                f"👥 <b>Рефералов:</b> {user_info.get('referrals', 0)}\n"
                f"🎁 <b>Пробный период:</b> {'Использован' if user_info.get('trial_used') else 'Не использован'}\n"
                f"📅 <b>Регистрация:</b> {user_info.get('registration_date', 'N/A')}\n"
            )
            
            # Кнопки быстрых действий
            keyboard = InlineKeyboardMarkup(inline_keyboard=[
                [
                    InlineKeyboardButton(text="💰 +100₽", callback_data=f"add_balance:{user_id}:100"),
                    InlineKeyboardButton(text="💰 +500₽", callback_data=f"add_balance:{user_id}:500"),
                ],
                [
                    InlineKeyboardButton(text="📅 +7 дней", callback_data=f"add_days:{user_id}:7"),
                    InlineKeyboardButton(text="📅 +30 дней", callback_data=f"add_days:{user_id}:30"),
                ],
                [
                    InlineKeyboardButton(text="🚫 Забанить", callback_data=f"ban_user:{user_id}"),
                    InlineKeyboardButton(text="✅ Разбанить", callback_data=f"unban_user:{user_id}"),
                ]
            ])
            
            info_msg = await bot.send_message(
                chat_id=ADMIN_CHAT_ID,
                text=info_message,
                parse_mode="HTML",
                reply_markup=keyboard
            )
            
            # Закрепляем сообщение
            try:
                await bot.pin_chat_message(chat_id=ADMIN_CHAT_ID, message_id=info_msg.message_id, disable_notification=True)
            except:
                pass  # Может не быть прав на закрепление
            
            user_info_sent.add(user_id)
        
        # Пересылаем сообщение пользователя
        forwarded = await message.forward(chat_id=ADMIN_CHAT_ID)
        
        # Сохраняем связь message_id -> user_id
        message_user_map[forwarded.message_id] = user_id
        
        # Сохраняем в БД
        save_ticket_message(user_id, message.text or '[Медиа]', is_admin=False)
        
        # Если первое сообщение - уведомляем пользователя
        if should_send_info:
            await message.answer(
                "✅ <b>Ваше сообщение получено!</b>\n\n"
                "Мы ответим вам в ближайшее время. Пожалуйста, ожидайте.",
                parse_mode="HTML"
            )
        
    except Exception as e:
        logger.error(f"Ошибка обработки сообщения: {e}")
        await message.answer("❌ Произошла ошибка. Попробуйте позже.")

@dp.callback_query(F.data.startswith("add_balance:"))
async def callback_add_balance(callback: types.CallbackQuery):
    """Быстрое добавление баланса"""
    if callback.message.chat.id != ADMIN_CHAT_ID:
        return
    
    parts = callback.data.split(":")
    user_id = int(parts[1])
    amount = int(parts[2])
    
    try:
        user = database.get_user_by_id(user_id)
        if user:
            new_balance = database.update_user_balance(user_id, amount)
            database.add_transaction(user_id, 'Пополнение', amount, 'balance', f'Начислено поддержкой')
            
            # Уведомляем пользователя
            await bot.send_message(
                chat_id=user['telegram_id'],
                text=f"💰 <b>Вам начислено {amount}₽!</b>\n\nВаш баланс: {new_balance}₽",
                parse_mode="HTML"
            )
            
            await callback.answer(f"✅ Начислено {amount}₽")
        else:
            await callback.answer("❌ Пользователь не найден", show_alert=True)
    except Exception as e:
        await callback.answer(f"❌ Ошибка: {e}", show_alert=True)

@dp.callback_query(F.data.startswith("add_days:"))
async def callback_add_days(callback: types.CallbackQuery):
    """Быстрое добавление дней"""
    if callback.message.chat.id != ADMIN_CHAT_ID:
        return
    
    parts = callback.data.split(":")
    user_id = int(parts[1])
    days = int(parts[2])
    
    try:
        conn = database.get_db_connection()
        cursor = conn.cursor()
        
        # Продлеваем все активные ключи пользователя
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
                await bot.send_message(
                    chat_id=user['telegram_id'],
                    text=f"🎁 <b>Вам добавлено {days} дней подписки!</b>",
                    parse_mode="HTML"
                )
            await callback.answer(f"✅ Добавлено {days} дней к {updated} ключам")
        else:
            await callback.answer("⚠️ У пользователя нет активных ключей", show_alert=True)
    except Exception as e:
        await callback.answer(f"❌ Ошибка: {e}", show_alert=True)

@dp.callback_query(F.data.startswith("ban_user:"))
async def callback_ban_user(callback: types.CallbackQuery):
    """Быстрый бан пользователя"""
    if callback.message.chat.id != ADMIN_CHAT_ID:
        return
    
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
    if callback.message.chat.id != ADMIN_CHAT_ID:
        return
    
    parts = callback.data.split(":")
    user_id = int(parts[1])
    
    try:
        database.update_user_status(user_id, 'Active')
        user = database.get_user_by_id(user_id)
        if user:
            await bot.send_message(
                chat_id=user['telegram_id'],
                text="✅ <b>Ваш аккаунт разблокирован!</b>\n\nВы снова можете пользоваться сервисом.",
                parse_mode="HTML"
            )
        await callback.answer("✅ Пользователь разбанен")
    except Exception as e:
        await callback.answer(f"❌ Ошибка: {e}", show_alert=True)

async def main():
    """Запуск бота"""
    logger.info("🚀 Бот поддержки запущен (Business Mode)...")
    logger.info(f"   Admin Chat ID: {ADMIN_CHAT_ID}")
    await bot.delete_webhook(drop_pending_updates=True)
    await dp.start_polling(bot)

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        logger.info("Бот остановлен")
