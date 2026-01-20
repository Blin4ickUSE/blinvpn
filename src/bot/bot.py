"""
Основной бот Telegram
"""
import asyncio
import logging
import os
import sys
from aiogram import Bot, Dispatcher, types, F
from aiogram.filters import CommandStart
from aiogram.types import InlineKeyboardMarkup, InlineKeyboardButton, WebAppInfo
from aiogram.enums import ParseMode

# Добавляем путь к backend
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '../../'))

from backend.database import database
from backend.core import core, abuse_detected
from backend.core.blacklist_updater import start_blacklist_updater
import re

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

@dp.message(CommandStart())
async def cmd_start(message: types.Message):
    """Обработчик команды /start"""
    telegram_id = message.from_user.id
    
    # Проверка черного списка
    if core.check_blacklist(telegram_id):
        await message.answer("❌ Ваш аккаунт заблокирован.")
        return
    
    # Извлекаем referral ID
    referral_id = None
    if message.text and 'ref' in message.text:
        referral_id = extract_referral_id(message.text)
    
    # Нельзя быть своим собственным рефералом
    if referral_id == telegram_id:
        referral_id = None
    
    # Получаем или создаем пользователя
    user = database.get_user_by_telegram_id(telegram_id)
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
    
    # Проверяем статус бана
    ban_status = abuse_detected.check_user_ban_status(user['id'])
    if ban_status.get('banned'):
        await message.answer(
            "❌ Ваш аккаунт заблокирован.\n\n"
            "Если вы считаете, что это ошибка, свяжитесь со службой поддержки.",
            reply_markup=InlineKeyboardMarkup(inline_keyboard=[[
                InlineKeyboardButton(text="Служба поддержки", url="https://t.me/your_support_bot")
            ]])
        )
        return
    
    # Формируем сообщение
    text = (
        "*👋 Добро пожаловать!*\n\n"
        "Это *BlinVPN* — лучший сервис для защиты данных. "
        "Просто запусти мини-приложение кнопкой ниже!\n\n"
        "*🎁 Дарим 24 часа бесплатно!*\n"
        "*🇷🇺 Оплата по СБП и Криптовалюте.*\n"
        "*⚡️ Высокая скорость и стабильная работа*\n"
        "*🤝 Служба поддержки поможет с любым вопросом или решит проблему.*"
    )
    
    # Кнопка Mini App
    keyboard = InlineKeyboardMarkup(inline_keyboard=[[
        InlineKeyboardButton(
            text="📱 Открыть приложение",
            web_app=WebAppInfo(url=WEB_APP_URL)
        )
    ]])
    
    await message.answer(text, parse_mode=ParseMode.MARKDOWN, reply_markup=keyboard)

async def main():
    """Запуск бота"""
    # Запускаем обновление черного списка
    start_blacklist_updater()
    
    logger.info("Бот запущен...")
    await bot.delete_webhook(drop_pending_updates=True)
    await dp.start_polling(bot)

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        logger.info("Бот остановлен")


