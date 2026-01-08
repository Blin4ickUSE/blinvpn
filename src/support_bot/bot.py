"""
Бот службы поддержки
Интегрирован с панелью управления
"""
import asyncio
import logging
import os
import sys
from aiogram import Bot, Dispatcher, types, F
from aiogram.filters import CommandStart
from aiogram.types import InlineKeyboardMarkup, InlineKeyboardButton

# Добавляем путь к backend
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '../../'))

from backend.database import database
from backend.core import core

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

BOT_TOKEN = os.getenv('SUPPORT_BOT_TOKEN', '')
SUPPORT_GROUP_ID = int(os.getenv('TELEGRAM_SUPPORT_GROUP_ID', '-1000000000000'))

bot = Bot(token=BOT_TOKEN)
dp = Dispatcher()

def init_db():
    """Инициализация БД для тикетов"""
    conn = database.get_db_connection()
    cursor = conn.cursor()
    # Таблицы уже созданы в database.py
    conn.close()

def get_topic_id(user_id: int) -> int:
    """Получить ID топика по ID пользователя"""
    conn = database.get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("SELECT telegram_topic_id FROM tickets WHERE user_id = ?", (user_id,))
        result = cursor.fetchone()
        return result[0] if result else None
    finally:
        conn.close()

def save_topic_id(user_id: int, topic_id: int):
    """Сохранить связь пользователя и топика"""
    conn = database.get_db_connection()
    cursor = conn.cursor()
    try:
        # Проверяем, есть ли уже тикет
        cursor.execute("SELECT id FROM tickets WHERE user_id = ?", (user_id,))
        existing = cursor.fetchone()
        
        if existing:
            cursor.execute("""
                UPDATE tickets 
                SET telegram_topic_id = ?, status = 'Open'
                WHERE user_id = ?
            """, (topic_id, user_id))
        else:
            cursor.execute("""
                INSERT INTO tickets (user_id, telegram_topic_id, status)
                VALUES (?, ?, 'Open')
            """, (user_id, topic_id))
        
        conn.commit()
    finally:
        conn.close()

def get_user_id_by_topic(topic_id: int) -> int:
    """Получить ID пользователя по ID топика"""
    conn = database.get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("SELECT user_id FROM tickets WHERE telegram_topic_id = ?", (topic_id,))
        result = cursor.fetchone()
        return result[0] if result else None
    finally:
        conn.close()

def get_user_info(user_id: int) -> dict:
    """Получить информацию о пользователе для тикета"""
    user = database.get_user_by_id(user_id)
    if not user:
        return {}
    
    # Получаем статистику ключей
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
    
    # Получаем рефералов
    cursor.execute("SELECT COUNT(*) FROM users WHERE referred_by = ?", (user_id,))
    referrals_count = cursor.fetchone()[0] if cursor.fetchone() else 0
    
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
        'registration_date': user.get('registration_date', 'N/A')
    }

@dp.message(CommandStart())
async def cmd_start(message: types.Message):
    """Приветствие пользователя"""
    await message.answer(
        "Здравствуйте! Напишите ваш вопрос, и мы создадим обращение в службу поддержки."
    )

@dp.message(F.chat.type == 'private')
async def handle_user_message(message: types.Message):
    """Обработка сообщений от пользователя"""
    user_id_telegram = message.from_user.id
    
    # Получаем или создаем пользователя в БД
    user = database.get_user_by_telegram_id(user_id_telegram)
    if not user:
        user_id = database.create_user(
            user_id_telegram,
            message.from_user.username,
            message.from_user.full_name
        )
        user = database.get_user_by_id(user_id)
    else:
        user_id = user['id']
    
    topic_id = get_topic_id(user_id)
    
    # Если топик есть, пересылаем сообщение
    if topic_id:
        try:
            await message.forward(chat_id=SUPPORT_GROUP_ID, message_thread_id=topic_id)
            return
        except Exception as e:
            logger.warning(f"Не удалось отправить в топик {topic_id}: {e}")
            topic_id = None
    
    # Создаем новый топик
    if not topic_id:
        try:
            topic_name = f"{message.from_user.full_name} ({user_id_telegram})"
            topic = await bot.create_forum_topic(chat_id=SUPPORT_GROUP_ID, name=topic_name)
            topic_id = topic.message_thread_id
            save_topic_id(user_id, topic_id)
            
            # Отправляем информацию о пользователе
            user_info = get_user_info(user_id)
            info_message = (
                f"👥 <b>Новое обращение!</b>\n\n"
                f"💸 <b>ПЛАТНЫЙ КЛИЕНТ?</b> {'Да' if user_info.get('balance', 0) > 0 or user_info.get('total_keys', 0) > 0 else 'Нет'}\n\n"
                f"👤 <b>ID:</b> {user_info['telegram_id']}\n"
                f"💰 <b>Баланс:</b> {user_info.get('balance', 0)}₽\n"
                f"🔑 <b>Всего ключей:</b> {user_info.get('total_keys', 0)}\n"
                f"🚫 <b>Забаненных ключей:</b> {user_info.get('banned_keys', 0)}/{user_info.get('total_keys', 0)}\n"
                f"👆 <b>Чей реферал:</b> {'Есть' if user.get('referred_by') else 'Ничей'}\n"
                f"👇 <b>Рефералов:</b> {user_info.get('referrals', 0)}\n"
                f"♾️ <b>Брал пробный период?</b> {'Да' if user_info.get('trial_used') else 'Нет'}\n"
                f"⌛️ <b>Дата регистрации:</b> {user_info.get('registration_date', 'N/A')}"
            )
            
            await bot.send_message(
                chat_id=SUPPORT_GROUP_ID,
                message_thread_id=topic_id,
                text=info_message,
                parse_mode="HTML"
            )
            
            # Пересылаем сообщение пользователя
            await message.forward(chat_id=SUPPORT_GROUP_ID, message_thread_id=topic_id)
            
            # Сохраняем сообщение в БД
            conn = database.get_db_connection()
            cursor = conn.cursor()
            cursor.execute("""
                INSERT INTO ticket_messages (ticket_id, user_id, is_admin, message_text)
                VALUES ((SELECT id FROM tickets WHERE user_id = ?), ?, 0, ?)
            """, (user_id, user_id, message.text or ''))
            conn.commit()
            conn.close()
            
        except Exception as e:
            logger.error(f"Ошибка при создании топика: {e}")
            await message.answer("Произошла ошибка при создании обращения. Пожалуйста, попробуйте позже.")

@dp.message(F.chat.id == SUPPORT_GROUP_ID, F.message_thread_id)
async def handle_admin_reply(message: types.Message):
    """Обработка ответов админов в группе"""
    topic_id = message.message_thread_id
    
    # Игнорируем служебные сообщения
    if message.forum_topic_created:
        return
    
    user_id = get_user_id_by_topic(topic_id)
    
    if user_id:
        try:
            # Отправляем копию сообщения пользователю
            await message.copy_to(chat_id=user_id)
            
            # Сохраняем сообщение в БД
            conn = database.get_db_connection()
            cursor = conn.cursor()
            cursor.execute("""
                INSERT INTO ticket_messages (ticket_id, is_admin, message_text)
                VALUES ((SELECT id FROM tickets WHERE telegram_topic_id = ?), 1, ?)
            """, (topic_id, message.text or ''))
            
            # Обновляем тикет
            cursor.execute("""
                UPDATE tickets
                SET last_message = ?, last_message_time = CURRENT_TIMESTAMP
                WHERE telegram_topic_id = ?
            """, (message.text or '', topic_id))
            
            conn.commit()
            conn.close()
        except Exception as e:
            logger.error(f"Не удалось отправить ответ пользователю {user_id}: {e}")
            await message.reply("❌ Не удалось доставить ответ пользователю (возможно, он заблокировал бота).")

async def main():
    """Запуск бота"""
    init_db()
    logger.info("Бот поддержки запущен...")
    await bot.delete_webhook(drop_pending_updates=True)
    await dp.start_polling(bot)

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        logger.info("Бот остановлен")

