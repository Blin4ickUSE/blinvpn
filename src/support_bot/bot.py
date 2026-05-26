"""
Бот поддержки BlinVPN
Пересылает сообщения между пользователями и операторами в группе-форуме.
"""
import asyncio
import logging
from collections import defaultdict
import os
import sys
from datetime import datetime
from typing import Optional

from aiogram import Bot, Dispatcher, types, F
from aiogram.filters import CommandStart
from aiogram.types import (
    InlineKeyboardMarkup,
    InlineKeyboardButton,
    Message,
    CallbackQuery,
    ReactionTypeEmoji,
    MessageReactionUpdated,
)
from aiogram.enums import ParseMode

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '../../'))

from src.database import database

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

SUPPORT_BOT_TOKEN = os.getenv('SUPPORT_BOT_TOKEN', '')
SUPPORT_GROUP_ID   = int(os.getenv('SUPPORT_GROUP_ID', '0'))   # ID группы-форума (отрицательное число)
ADMIN_USERNAME     = os.getenv('SUPPORT_ADMIN_USERNAME', 'blin4icks')

if not SUPPORT_BOT_TOKEN:
    logger.error("❌ SUPPORT_BOT_TOKEN не указан в .env!")
    sys.exit(1)
if not SUPPORT_GROUP_ID:
    logger.error("❌ SUPPORT_GROUP_ID не указан в .env!")
    sys.exit(1)

bot = Bot(token=SUPPORT_BOT_TOKEN)
dp  = Dispatcher()

# Один топик на пользователя: блокировка от гонки при спаме сообщений
_topic_locks: dict[int, asyncio.Lock] = defaultdict(asyncio.Lock)


def _is_dead_topic_error(err: str) -> bool:
    err = err.lower()
    return (
        "thread not found" in err
        or "topic_deleted" in err
        or "message thread not found" in err
        or "forum topic deleted" in err
    )

# ─── Эмодзи-иконки топиков ────────────────────────────────────────────────────
ICON_DEFAULT  = "💬"
ICON_IMPORTANT = "⚠️"
ICON_PARTNER  = "🤝"
ICON_BANNED   = "⛔️"

# Маппинг иконки → custom_emoji_id (стандартные эмодзи для forum_topic icon)
# Telegram принимает только определённые emoji для иконки топика
TOPIC_ICONS: dict[str, int] = {
    ICON_DEFAULT:   0,          # default (нет кастомного)
    ICON_IMPORTANT: 5447644880824181073,
    ICON_PARTNER:   5357080225463149588,
    ICON_BANNED:    5260293700088511294,
}

# ─── Вспомогательные функции БД ───────────────────────────────────────────────

def _get_support_topic(telegram_id: int) -> Optional[int]:
    """Вернуть support_topic_id пользователя или None."""
    user = database.get_user_by_telegram_id(telegram_id)
    return user.get('support_topic_id') if user else None


def _set_support_topic(telegram_id: int, topic_id: int) -> None:
    conn = database.get_db_connection()
    try:
        conn.execute(
            "UPDATE users SET support_topic_id = ? WHERE telegram_id = ?",
            (topic_id, telegram_id)
        )
        conn.commit()
    finally:
        conn.close()


def _get_user_by_topic(topic_id: int) -> Optional[dict]:
    """Найти пользователя по support_topic_id."""
    conn = database.get_db_connection()
    try:
        row = conn.execute(
            "SELECT * FROM users WHERE support_topic_id = ?", (topic_id,)
        ).fetchone()
        return dict(row) if row else None
    finally:
        conn.close()


def _is_banned_support(telegram_id: int) -> bool:
    user = database.get_user_by_telegram_id(telegram_id)
    return bool(user and user.get('support_banned'))


def _set_support_banned(telegram_id: int, banned: bool) -> None:
    conn = database.get_db_connection()
    try:
        conn.execute(
            "UPDATE users SET support_banned = ? WHERE telegram_id = ?",
            (1 if banned else 0, telegram_id)
        )
        conn.commit()
    finally:
        conn.close()


# ─── Карточка пользователя ────────────────────────────────────────────────────

def _format_bytes(b: float) -> str:
    if b is None:
        return "—"
    gb = b / 1_073_741_824
    if gb >= 1:
        return f"{gb:.2f} ГБ"
    mb = b / 1_048_576
    return f"{mb:.1f} МБ"


async def _build_user_card(user: dict) -> str:
    tg_id    = user['telegram_id']
    username = f"@{user['username']}" if user.get('username') else "—"
    uname    = user.get('full_name') or username

    # VPN ключи
    conn = database.get_db_connection()
    try:
        keys = conn.execute(
            "SELECT * FROM vpn_keys WHERE user_id = ?", (user['id'],)
        ).fetchall()
        keys = [dict(k) for k in keys]

        # Промокоды
        promos = conn.execute(
            """SELECT p.code, pu.used_at FROM promocode_uses pu
               JOIN promocodes p ON p.id = pu.promocode_id
               WHERE pu.user_id = ?""",
            (user['id'],)
        ).fetchall()
        promos = [dict(p) for p in promos]

        # Рефералы
        referrals = conn.execute(
            "SELECT COUNT(*) as cnt FROM users WHERE referred_by = ?", (user['id'],)
        ).fetchone()
        referrals_count = referrals['cnt'] if referrals else 0

        # Транзакции (последние 5)
        txs = conn.execute(
            "SELECT * FROM transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT 5",
            (user['id'],)
        ).fetchall()
        txs = [dict(t) for t in txs]
    finally:
        conn.close()

    lines = [
        f"<b>👤 Пользователь</b>: {username} (<code>{tg_id}</code>)",
        f"<b>📛 Имя</b>: {uname}",
        f"<b>📅 Регистрация</b>: {str(user.get('registration_date', '—'))[:16]}",
        f"<b>💰 Баланс</b>: {user.get('balance', 0):.2f} ₽",
        f"<b>🤝 Реф. баланс</b>: {user.get('partner_balance', 0):.2f} ₽",
        f"<b>📊 Статус</b>: {user.get('status', '—')}",
        f"<b>🚫 Забанен</b>: {'Да (' + str(user.get('ban_reason', '')) + ')' if user.get('is_banned') else 'Нет'}",
        f"<b>🤝 Партнёр</b>: {'Да (' + str(user.get('partner_rate', 0)) + '%)' if user.get('is_partner') else 'Нет'}",
        f"<b>🔑 Реферальный код</b>: <code>{user.get('referral_code', '—')}</code>",
        f"<b>👥 Приглашено рефералов</b>: {referrals_count}",
        f"<b>🎟 Активированных промокодов</b>: {len(promos)}",
    ]

    if promos:
        lines.append("<b>  └ Промокоды</b>: " + ", ".join(f"<code>{p['code']}</code>" for p in promos))

    lines.append(f"\n<b>🗂 Топик поддержки</b>: <code>{user.get('support_topic_id', '—')}</code>")

    # VPN ключи
    lines.append(f"\n<b>🔐 VPN-ключи ({len(keys)})</b>:")
    if not keys:
        lines.append("  — нет ключей")
    for k in keys:
        status  = k.get('status', '?')
        expiry  = str(k.get('expiry_date', '—'))[:16]
        devices = k.get('devices_limit', 1)
        traffic = _format_bytes(k.get('traffic_used', 0) or 0)
        limit   = _format_bytes(k.get('traffic_limit', 0) or 0) if k.get('traffic_limit') else '∞'
        loc     = k.get('server_location') or '—'
        name    = k.get('custom_name') or k.get('key_uuid', '—')[:12] + '…'
        lines.append(
            f"  • <b>{name}</b> [{status}]\n"
            f"    └ Устройства: {devices} | Трафик: {traffic}/{limit}\n"
            f"    └ Сервер: {loc} | Истекает: {expiry}"
        )

    # Последние транзакции
    lines.append(f"\n<b>💳 Последние транзакции (5)</b>:")
    if not txs:
        lines.append("  — нет транзакций")
    for t in txs:
        sign  = '+' if (t.get('amount', 0) or 0) >= 0 else ''
        lines.append(
            f"  • {str(t.get('created_at', ''))[:16]} | {t.get('type','?')} | "
            f"{sign}{t.get('amount', 0):.2f}₽ [{t.get('status','?')}]"
        )

    return "\n".join(lines)


# ─── Кнопки топика ────────────────────────────────────────────────────────────

def _topic_keyboard(telegram_id: int, is_banned: bool) -> InlineKeyboardMarkup:
    ban_btn = (
        InlineKeyboardButton(
            text="✔️ Разблокировать",
            callback_data=f"sup_unban:{telegram_id}"
        ) if is_banned else
        InlineKeyboardButton(
            text="⛔️ Заблокировать",
            callback_data=f"sup_ban:{telegram_id}"
        )
    )
    return InlineKeyboardMarkup(inline_keyboard=[
        [
            InlineKeyboardButton(text="⚠️ Важно",   callback_data=f"sup_mark:important:{telegram_id}"),
            InlineKeyboardButton(text="🤝 Партнер",  callback_data=f"sup_mark:partner:{telegram_id}"),
        ],
        [ban_btn],
    ])


# ─── Создание / получение топика ──────────────────────────────────────────────

async def _create_topic(telegram_id: int, username: str, user: dict) -> int:
    """Создать новый топик + карточку. Вернуть topic_id."""
    display = f"@{username}" if username else f"id{telegram_id}"
    topic = await bot.create_forum_topic(
        chat_id=SUPPORT_GROUP_ID,
        name=f"{display} (ID: {telegram_id})",
    )
    new_id = topic.message_thread_id
    _set_support_topic(telegram_id, new_id)
    # Сбрасываем id карточки — топик новый
    _set_card_msg_id(telegram_id, None)
    await _send_topic_card(telegram_id, username, new_id, user)
    return new_id


async def _ensure_topic(telegram_id: int, username: str, user: dict) -> int:
    """Вернуть существующий topic_id или создать новый (с блокировкой от гонки при спаме)."""
    async with _topic_locks[telegram_id]:
        topic_id = _get_support_topic(telegram_id)
        if topic_id:
            return topic_id
        return await _create_topic(telegram_id, username, user)


def _set_card_msg_id(telegram_id: int, msg_id):
    conn = database.get_db_connection()
    try:
        conn.execute(
            "UPDATE users SET support_card_msg_id = ? WHERE telegram_id = ?",
            (msg_id, telegram_id)
        )
        conn.commit()
    finally:
        conn.close()


# ─── Приветствие пользователя (/start) ───────────────────────────────────────

@dp.message(CommandStart())
async def cmd_start(message: Message):
    # Убеждаемся, что пользователь есть в БД
    tg_id    = message.from_user.id
    username = message.from_user.username
    name     = message.from_user.full_name

    if not database.get_user_by_telegram_id(tg_id):
        database.create_user(tg_id, username, name)

    await message.answer(
        '<tg-emoji emoji-id="5456561606592866295">🔥</tg-emoji> <b>Привет, это поддержка BlinVPN!</b>\n\n'
        'Мы работаем ежедневно с 9:00 до 22:00. Пожалуйста, задайте свой вопрос, '
        'а мы ответим сразу как только найдем свободного оператора.',
        parse_mode=ParseMode.HTML,
    )


# ─── Сообщения от пользователя → топик ───────────────────────────────────────

@dp.message(F.chat.type == "private")
async def user_to_topic(message: Message):
    tg_id    = message.from_user.id
    username = message.from_user.username or ""

    # Проверка бана
    if _is_banned_support(tg_id):
        await message.answer(
            '<tg-emoji emoji-id="5260293700088511294">⛔️</tg-emoji> <b>Вы заблокированы</b>.\n\n'
            f'Если вы считаете, что это ошибка, обратитесь к администратору напрямую → @{ADMIN_USERNAME}. '
            'Имейте ввиду, что администратор отвечает в свободное время, а значит спамить с вопросом почему он не отвечает - не надо.',
            parse_mode=ParseMode.HTML,
        )
        return

    # Убеждаемся, что пользователь есть в БД
    user = database.get_user_by_telegram_id(tg_id)
    if not user:
        database.create_user(tg_id, username, message.from_user.full_name)
        user = database.get_user_by_telegram_id(tg_id)

    topic_id = await _ensure_topic(tg_id, username, user)

    # Пересылаем сообщение в топик
    try:
        sent = await _forward_to_topic(message, topic_id)
    except Exception as e:
        logger.error(f"Forward failed for {tg_id} (topic {topic_id}): {e}")
        try:
            await message.delete()
        except Exception:
            pass
        return

    if sent is None:
        # Топик мёртв (оператор удалил тему) — один раз пересоздаём под блокировкой
        logger.info(f"Topic {topic_id} dead for {tg_id}, recreating")
        async with _topic_locks[tg_id]:
            topic_id = await _create_topic(tg_id, username, user)
            try:
                sent = await _forward_to_topic(message, topic_id)
            except Exception as e:
                logger.error(f"Forward after recreate failed for {tg_id}: {e}")
                try:
                    await message.delete()
                except Exception:
                    pass
                return

    # Сохраняем маппинг user_msg_id → topic_msg_id для reply/edit/delete
    if sent:
        text = message.text or message.caption or ""
        _save_msg_map(tg_id, message.message_id, sent.message_id, topic_id,
                      direction='u2t', topic_text=text)


async def _send_topic_card(tg_id: int, username: str, topic_id: int, user: dict):
    """Отправить карточку пользователя в топик и закрепить её."""
    display  = f"@{username}" if username else f"id{tg_id}"
    card_hdr = (
        f'<tg-emoji emoji-id="5447644880824181073">⚠️</tg-emoji> <b>Новое обращение!</b>\n\n'
        f'👤 <b>Пользователь</b>: {display} (<code>{tg_id}</code>)'
    )
    card_body = await _build_user_card(user)
    full_card = card_hdr + "\n\n" + card_body

    # Разбиваем если длинно
    chunks = _split_text(full_card, 4096)
    first_msg = None
    for i, chunk in enumerate(chunks):
        sent = await bot.send_message(
            chat_id=SUPPORT_GROUP_ID,
            message_thread_id=topic_id,
            text=chunk,
            parse_mode=ParseMode.HTML,
            reply_markup=_topic_keyboard(tg_id, _is_banned_support(tg_id)) if i == len(chunks) - 1 else None,
        )
        if first_msg is None:
            first_msg = sent

    if first_msg:
        try:
            await bot.pin_chat_message(SUPPORT_GROUP_ID, first_msg.message_id, disable_notification=True)
        except Exception:
            pass
        # Сохраняем ID карточки
        conn = database.get_db_connection()
        try:
            conn.execute(
                "UPDATE users SET support_card_msg_id = ? WHERE telegram_id = ?",
                (first_msg.message_id, tg_id)
            )
            conn.commit()
        finally:
            conn.close()


def _split_text(text: str, limit: int) -> list[str]:
    if len(text) <= limit:
        return [text]
    chunks = []
    while text:
        chunks.append(text[:limit])
        text = text[limit:]
    return chunks


async def _forward_to_topic(message: Message, topic_id: int) -> Optional[Message]:
    """Скопировать любое сообщение от юзера в топик.
    Вернёт sent Message, либо None если топик мёртв (его удалили)."""
    reply_to = None
    if message.reply_to_message:
        reply_to = _resolve_reply_to_topic(message.from_user.id, message.reply_to_message.message_id)

    try:
        return await message.copy_to(
            chat_id=SUPPORT_GROUP_ID,
            message_thread_id=topic_id,
            reply_to_message_id=reply_to,
        )
    except Exception as e:
        err = str(e).lower()
        # Если проблема в reply (целевое сообщение удалено) — повторяем без reply
        if reply_to and ("reply" in err or "message to be replied not found" in err):
            try:
                return await message.copy_to(
                    chat_id=SUPPORT_GROUP_ID,
                    message_thread_id=topic_id,
                )
            except Exception as e2:
                err = str(e2).lower()
        # Топик удалён / не найден → сигнал пересоздать
        if _is_dead_topic_error(err):
            return None
        logger.error(f"_forward_to_topic error: {err}")
        raise


# ─── Сообщения от оператора (в топике) → пользователь ────────────────────────

@dp.message(F.chat.id == SUPPORT_GROUP_ID, F.message_thread_id.is_not(None))
async def topic_to_user(message: Message):
    # Игнорируем сообщения от самого бота
    if message.from_user and message.from_user.is_bot:
        return

    topic_id = message.message_thread_id
    user     = _get_user_by_topic(topic_id)
    if not user:
        return

    tg_id = user['telegram_id']

    if _is_banned_support(tg_id):
        return  # не доставляем если человек забанен

    try:
        kwargs: dict = dict(chat_id=tg_id)

        if message.reply_to_message:
            # Оператор отвечает на сообщение в топике (своё или юзера).
            # Находим соответствующее сообщение в личке независимо от направления.
            mapped_id = _resolve_reply_to_user(tg_id, message.reply_to_message.message_id)
            if mapped_id:
                kwargs['reply_to_message_id'] = mapped_id

        sent = await message.copy_to(**kwargs)
        text = message.text or message.caption or ""
        _save_msg_map(tg_id, sent.message_id, message.message_id, topic_id,
                      direction='t2u', topic_text=text)
    except Exception as e:
        logger.error(f"topic_to_user error: {e}")


def _resolve_reply_to_user(tg_id: int, topic_msg_id: int) -> Optional[int]:
    """По message_id в топике (на которое ответил оператор) → message_id в личке юзера."""
    conn = database.get_db_connection()
    try:
        row = conn.execute(
            "SELECT user_msg_id FROM support_msg_map WHERE telegram_id=? AND topic_msg_id=? LIMIT 1",
            (tg_id, topic_msg_id)
        ).fetchone()
        return row['user_msg_id'] if row else None
    finally:
        conn.close()


def _resolve_reply_to_topic(tg_id: int, user_msg_id: int) -> Optional[int]:
    """По message_id в личке (на которое ответил юзер) → message_id в топике."""
    conn = database.get_db_connection()
    try:
        row = conn.execute(
            "SELECT topic_msg_id FROM support_msg_map WHERE telegram_id=? AND user_msg_id=? LIMIT 1",
            (tg_id, user_msg_id)
        ).fetchone()
        return row['topic_msg_id'] if row else None
    finally:
        conn.close()


# ─── Маппинг сообщений ────────────────────────────────────────────────────────

def _save_msg_map(tg_id: int, user_msg_id: int, topic_msg_id: int, topic_id: int,
                  direction: str, topic_text: str = None):
    conn = database.get_db_connection()
    try:
        conn.execute(
            """INSERT OR REPLACE INTO support_msg_map
               (telegram_id, user_msg_id, topic_msg_id, topic_id, direction, topic_text)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (tg_id, user_msg_id, topic_msg_id, topic_id, direction, topic_text)
        )
        conn.commit()
    finally:
        conn.close()


def _lookup_topic_msg(tg_id: int, user_msg_id: int) -> Optional[int]:
    """u2t: по user_msg_id → topic_msg_id"""
    conn = database.get_db_connection()
    try:
        row = conn.execute(
            "SELECT topic_msg_id FROM support_msg_map WHERE telegram_id=? AND user_msg_id=? AND direction='u2t'",
            (tg_id, user_msg_id)
        ).fetchone()
        return row['topic_msg_id'] if row else None
    finally:
        conn.close()


def _lookup_user_msg(tg_id: int, topic_msg_id: int) -> Optional[int]:
    """t2u: по topic_msg_id → user_msg_id"""
    conn = database.get_db_connection()
    try:
        row = conn.execute(
            "SELECT user_msg_id FROM support_msg_map WHERE telegram_id=? AND topic_msg_id=? AND direction='t2u'",
            (tg_id, topic_msg_id)
        ).fetchone()
        return row['user_msg_id'] if row else None
    finally:
        conn.close()


def _lookup_by_topic_msg(topic_msg_id: int) -> Optional[dict]:
    """Найти запись по topic_msg_id (любое направление)."""
    conn = database.get_db_connection()
    try:
        row = conn.execute(
            "SELECT * FROM support_msg_map WHERE topic_msg_id=?",
            (topic_msg_id,)
        ).fetchone()
        return dict(row) if row else None
    finally:
        conn.close()


def _lookup_by_user_msg(tg_id: int, user_msg_id: int) -> Optional[dict]:
    conn = database.get_db_connection()
    try:
        row = conn.execute(
            "SELECT * FROM support_msg_map WHERE telegram_id=? AND user_msg_id=?",
            (tg_id, user_msg_id)
        ).fetchone()
        return dict(row) if row else None
    finally:
        conn.close()


# ─── Детект редактирования ────────────────────────────────────────────────────

@dp.edited_message(F.chat.type == "private")
async def user_edited_msg(message: Message):
    """Пользователь отредактировал сообщение → в топике:
        <оригинал>
        UPD (HH:MM): <правка1>
        UPD (HH:MM): <правка2>
    """
    tg_id = message.from_user.id
    rec   = _lookup_by_user_msg(tg_id, message.message_id)
    if not rec or rec.get('direction') != 'u2t':
        return

    new_text = message.text or message.caption or ""
    ts       = datetime.now().strftime("%H:%M")

    conn = database.get_db_connection()
    try:
        row = conn.execute(
            "SELECT topic_text, upd_chain FROM support_msg_map WHERE telegram_id=? AND user_msg_id=? AND direction='u2t'",
            (tg_id, message.message_id)
        ).fetchone()
        # topic_text — оригинал (сохранён при пересылке, не меняется)
        original  = (row['topic_text'] if row and row['topic_text'] is not None else "")
        upd_chain = (row['upd_chain'] if row and row['upd_chain'] else "")

        # Дописываем новую правку в цепочку
        upd_chain = upd_chain + f"\nUPD ({ts}): {new_text}"

        conn.execute(
            "UPDATE support_msg_map SET upd_chain=? WHERE telegram_id=? AND user_msg_id=? AND direction='u2t'",
            (upd_chain, tg_id, message.message_id)
        )
        conn.commit()
    finally:
        conn.close()

    display = (original + upd_chain).strip()

    try:
        # Если оригинал был текстом — редактируем текст; если подпись к медиа — caption
        await bot.edit_message_text(
            chat_id=SUPPORT_GROUP_ID,
            message_id=rec['topic_msg_id'],
            text=display,
        )
    except Exception:
        try:
            await bot.edit_message_caption(
                chat_id=SUPPORT_GROUP_ID,
                message_id=rec['topic_msg_id'],
                caption=display,
            )
        except Exception as e:
            logger.error(f"user_edited_msg edit error: {e}")


@dp.edited_message(F.chat.id == SUPPORT_GROUP_ID)
async def operator_edited_msg(message: Message):
    """Оператор отредактировал сообщение → редактируем у пользователя."""
    rec = _lookup_by_topic_msg(message.message_id)
    if not rec or rec['direction'] != 't2u':
        return

    tg_id       = rec['telegram_id']
    user_msg_id = rec['user_msg_id']
    new_text    = message.text or message.caption or ""

    try:
        if message.text:
            await bot.edit_message_text(
                chat_id=tg_id,
                message_id=user_msg_id,
                text=new_text,
            )
        elif message.caption:
            await bot.edit_message_caption(
                chat_id=tg_id,
                message_id=user_msg_id,
                caption=new_text,
            )
    except Exception as e:
        logger.error(f"operator_edited_msg error: {e}")


# ─── Детект реакций ───────────────────────────────────────────────────────────
# В aiogram 3 реакции приходят как отдельный апдейт message_reaction.
# Регистрируем типизированный хэндлер. allowed_updates с "message_reaction"
# обязателен (задаётся в start_polling ниже), иначе Telegram их не присылает.

@dp.message_reaction()
async def on_reaction(event: MessageReactionUpdated):
    chat_id = event.chat.id
    msg_id  = event.message_id

    # Новый набор реакций (может быть пустым при снятии)
    emoji = None
    for r in (event.new_reaction or []):
        if getattr(r, 'type', None) == 'emoji' or r.__class__.__name__ == 'ReactionTypeEmoji':
            emoji = getattr(r, 'emoji', None)
            break

    reaction = [ReactionTypeEmoji(emoji=emoji)] if emoji else []

    if chat_id == SUPPORT_GROUP_ID:
        # Оператор поставил/снял реакцию на сообщение в топике → отражаем пользователю
        rec = _lookup_by_topic_msg(msg_id)
        if rec:
            try:
                await bot.set_message_reaction(
                    chat_id=rec['telegram_id'],
                    message_id=rec['user_msg_id'],
                    reaction=reaction,
                )
            except Exception as e:
                logger.error(f"reaction → user error: {e}")
    else:
        # Пользователь поставил/снял реакцию в личке → отражаем в топике
        tg_id = event.user.id if event.user else None
        if tg_id:
            rec = _lookup_by_user_msg(tg_id, msg_id)
            if rec:
                try:
                    await bot.set_message_reaction(
                        chat_id=SUPPORT_GROUP_ID,
                        message_id=rec['topic_msg_id'],
                        reaction=reaction,
                    )
                except Exception as e:
                    logger.error(f"reaction → topic error: {e}")


# ─── Callback-кнопки операторов ───────────────────────────────────────────────

@dp.callback_query(F.data.startswith("sup_mark:"))
async def cb_mark(call: CallbackQuery):
    _, mark_type, tg_id_str = call.data.split(":")
    tg_id    = int(tg_id_str)
    topic_id = _get_support_topic(tg_id)
    if not topic_id:
        await call.answer("Топик не найден", show_alert=True)
        return

    icon_map = {
        "important": ICON_IMPORTANT,
        "partner":   ICON_PARTNER,
    }
    icon = icon_map.get(mark_type, ICON_DEFAULT)
    emoji_id = TOPIC_ICONS.get(icon)

    try:
        await bot.edit_forum_topic(
            chat_id=SUPPORT_GROUP_ID,
            message_thread_id=topic_id,
            icon_custom_emoji_id=str(emoji_id) if emoji_id else None,
        )
        await call.answer(f"Тема помечена: {icon}")
    except Exception as e:
        await call.answer(f"Ошибка: {e}", show_alert=True)


@dp.callback_query(F.data.startswith("sup_ban:"))
async def cb_ban(call: CallbackQuery):
    tg_id    = int(call.data.split(":")[1])
    topic_id = _get_support_topic(tg_id)

    _set_support_banned(tg_id, True)

    # Меняем иконку топика
    if topic_id:
        try:
            await bot.edit_forum_topic(
                chat_id=SUPPORT_GROUP_ID,
                message_thread_id=topic_id,
                icon_custom_emoji_id=str(TOPIC_ICONS[ICON_BANNED]),
            )
        except Exception:
            pass

    # Уведомляем пользователя
    try:
        await bot.send_message(
            tg_id,
            f'<tg-emoji emoji-id="5260293700088511294">⛔️</tg-emoji> <b>Вы заблокированы</b>.\n\n'
            f'Если вы считаете, что это ошибка, обратитесь к администратору напрямую → @{ADMIN_USERNAME}. '
            f'Имейте ввиду, что администратор отвечает в свободное время, а значит спамить с вопросом почему он не отвечает - не надо.',
            parse_mode=ParseMode.HTML,
        )
    except Exception:
        pass

    # Обновляем кнопки в карточке
    await _refresh_card_keyboard(tg_id, call.message)
    await call.answer("Пользователь заблокирован ⛔️")


@dp.callback_query(F.data.startswith("sup_unban:"))
async def cb_unban(call: CallbackQuery):
    tg_id    = int(call.data.split(":")[1])
    topic_id = _get_support_topic(tg_id)

    _set_support_banned(tg_id, False)

    if topic_id:
        try:
            await bot.edit_forum_topic(
                chat_id=SUPPORT_GROUP_ID,
                message_thread_id=topic_id,
                icon_custom_emoji_id=None,
            )
        except Exception:
            pass

    try:
        await bot.send_message(
            tg_id,
            '<tg-emoji emoji-id="5206607081334906820">✔️</tg-emoji> <b>Вы разблокированы</b>. Приносим извинения.',
            parse_mode=ParseMode.HTML,
        )
    except Exception:
        pass

    await _refresh_card_keyboard(tg_id, call.message)
    await call.answer("Пользователь разблокирован ✔️")


async def _refresh_card_keyboard(tg_id: int, original_msg: Message):
    """Обновить кнопки в исходном сообщении."""
    try:
        await original_msg.edit_reply_markup(
            reply_markup=_topic_keyboard(tg_id, _is_banned_support(tg_id))
        )
    except Exception:
        pass


# ─── Миграция БД ──────────────────────────────────────────────────────────────

def migrate_db():
    """Добавить новые колонки и таблицы для поддержки."""
    conn = database.get_db_connection()
    try:
        # Колонки в users
        for col, definition in [
            ("support_topic_id",  "INTEGER"),
            ("support_banned",    "INTEGER DEFAULT 0"),
            ("support_card_msg_id", "INTEGER"),
        ]:
            try:
                conn.execute(f"ALTER TABLE users ADD COLUMN {col} {definition}")
                logger.info(f"Added column users.{col}")
            except Exception:
                pass  # уже есть

        # Таблица маппинга сообщений
        conn.execute("""
            CREATE TABLE IF NOT EXISTS support_msg_map (
                id           INTEGER PRIMARY KEY AUTOINCREMENT,
                telegram_id  INTEGER NOT NULL,
                user_msg_id  INTEGER NOT NULL,
                topic_msg_id INTEGER NOT NULL,
                topic_id     INTEGER NOT NULL,
                direction    TEXT NOT NULL,
                topic_text   TEXT,
                upd_chain    TEXT,
                created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(telegram_id, user_msg_id, direction)
            )
        """)
        # Миграция: upd_chain для старых таблиц
        try:
            conn.execute("ALTER TABLE support_msg_map ADD COLUMN upd_chain TEXT")
        except Exception:
            pass
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_smm_topic_msg ON support_msg_map(topic_msg_id)"
        )
        conn.commit()
        logger.info("Support DB migration done")
    finally:
        conn.close()


# ─── Запуск ───────────────────────────────────────────────────────────────────

async def main():
    migrate_db()
    logger.info("Бот поддержки запущен...")
    await bot.delete_webhook(drop_pending_updates=False)
    await dp.start_polling(
        bot,
        allowed_updates=[
            "message",
            "edited_message",
            "callback_query",
            "message_reaction",
            "message_reaction_count",
        ],
    )


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        logger.info("Бот поддержки остановлен")
