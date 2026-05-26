"""
Все тексты уведомлений и сообщений бота (кроме /start).
Формат: HTML + premium emoji (<tg-emoji emoji-id="...">).
"""

# --- Premium emoji IDs ---
_EMOJI_OK = "5206607081334906820"
_EMOJI_WARNING = "5447644880824181073"
_EMOJI_WARNING_2H = "5420323339723881652"
_EMOJI_STOP = "5260293700088511294"
_EMOJI_WITHDRAW = "5231449120635370684"
_EMOJI_APPROVE = "5397916757333654639"
_EMOJI_DEPOSIT = "5231449120635370684"
_EMOJI_ADMIN_ADD = "5416081784641168838"
_EMOJI_ADMIN_SUB = "5411225014148014586"
_EMOJI_BAN = "5260293700088511294"
_EMOJI_NO_SUB = "5341715473882955310"
_EMOJI_DISCOUNT = "5460755126761312667"
_EMOJI_GRACE = "5395695537687123235"
_EMOJI_COMEBACK = "6334751542381381803"
_EMOJI_REFERRAL = "5456561606592866295"
_EMOJI_REFERRAL_INCOME = "5231449120635370684"
_EMOJI_EXTEND = "5305522282695768654"
_EMOJI_DELETE = "5260293700088511294"
_EMOJI_UNBAN = "5206607081334906820"
_EMOJI_KEY = "5456561606592866295"
_EMOJI_REFUND = "5231449120635370684"
_EMOJI_PARTNER = "5397916757333654639"

BUTTON_OPEN_MINIAPP = "Открыть мини-приложение"
BUTTON_SUPPORT = "🆘 Поддержка"


def _fmt_amount(amount: float) -> str:
    if amount == int(amount):
        return f"{int(amount)}"
    return f"{amount:g}"


def _days_word(n: int) -> str:
    if n == 1:
        return "день"
    if 2 <= n <= 4:
        return "дня"
    return "дней"


def withdrawal_method_destination(payment_method: str) -> str:
    m = (payment_method or "").strip().lower()
    if "cryptobot" in m or "crypto bot" in m:
        return "на CryptoBot"
    if m in ("crypto", "криптовалюта", "крипто"):
        return "на криптокошелек"
    if "карт" in m or m == "card":
        return "на карту"
    return "на указанные реквизиты"


# --- Подписка / истечение ---

def build_expiry_warning_message(
    key_id: int, time_text: str, balance: float, topup: float, *, almost: bool = False
) -> str:
    balance_fmt = _fmt_amount(balance)
    topup_fmt = _fmt_amount(topup)
    if almost:
        emoji_id, title = _EMOJI_WARNING_2H, "Подписка почти закончилась!"
        action = "Для продления пополните баланс"
    else:
        emoji_id, title = _EMOJI_WARNING, "Подписка вот-вот закончится!"
        action = "Для сохранения доступа пополните баланс"
    return (
        f'<tg-emoji emoji-id="{emoji_id}">⚠️</tg-emoji> <b>{title}</b>\n\n'
        f"Через <b>{time_text}</b> подписка <b>№{key_id}</b> закончится, "
        f"а на балансе недостаточно средств для автопродления ({balance_fmt}₽). "
        f"{action} <b>на {topup_fmt}₽</b>"
    )


def build_expiry_expired_message(key_id: int, grace_days: int = 7) -> str:
    return (
        f'<tg-emoji emoji-id="{_EMOJI_STOP}">⛔️</tg-emoji> <b>Подписка №{key_id} закончилась!</b>\n\n'
        f"Мы не смогли продлить её автоматически из-за нехватки баланса. "
        f"Продлите подписку вручную в разделе «Устройства» <b>в течение {grace_days} дней</b>, "
        f"иначе она будет окончательно удалена."
    )


def build_grace_daily_message(key_id: int, days_left: int) -> str:
    if days_left <= 0:
        when = "<b>сегодня</b>"
    else:
        when = f"<b>{days_left} {_days_word(days_left)}</b>"
    return (
        f'<tg-emoji emoji-id="{_EMOJI_GRACE}">🚨</tg-emoji> <b>Подписка скоро удалится!</b>\n\n'
        f"У вас есть неоплаченная подписка <b>№{key_id}</b>. "
        f"Продлите её, либо она будет удалена автоматически через {when}."
    )


def build_subscription_deleted_message(key_id: int) -> str:
    return (
        f'<tg-emoji emoji-id="{_EMOJI_DELETE}">⛔️</tg-emoji> <b>Подписка №{key_id} удалена.</b>\n\n'
        f"Срок неоплаты истёк — доступ отключён. "
        f"Оформите новую подписку в разделе «Устройства», чтобы вернуться."
    )


def build_auto_renewal_message(key_id: int, balance_left: float) -> str:
    bal = _fmt_amount(balance_left)
    return (
        f'<tg-emoji emoji-id="{_EMOJI_OK}">✔️</tg-emoji> '
        f"<b>Подписка №{key_id} автоматически продлена.</b> "
        f"На балансе осталось: <b>{bal}₽</b>"
    )


def build_admin_subscription_extended_message(days: int) -> str:
    return (
        f'<tg-emoji emoji-id="{_EMOJI_EXTEND}">⏰</tg-emoji> '
        f"<b>Ваша подписка продлена на {days} {_days_word(days)}!</b>"
    )


def build_admin_subscription_reduced_message(days: int) -> str:
    return (
        f'<tg-emoji emoji-id="{_EMOJI_EXTEND}">⏰</tg-emoji> '
        f"<b>Срок вашей подписки уменьшен на {days} {_days_word(days)}.</b>"
    )


def build_admin_traffic_limit_message(limit_gb: int) -> str:
    return (
        f'<tg-emoji emoji-id="{_EMOJI_EXTEND}">📊</tg-emoji> '
        f"<b>Ваш лимит трафика установлен: {limit_gb} ГБ</b>"
    )


def build_admin_devices_limit_message(limit: int) -> str:
    return (
        f'<tg-emoji emoji-id="{_EMOJI_EXTEND}">📱</tg-emoji> '
        f"<b>Ваш лимит устройств: {limit}</b>"
    )


def build_admin_deleted_subscription_message() -> str:
    return (
        f'<tg-emoji emoji-id="{_EMOJI_DELETE}">🗑</tg-emoji> '
        f"<b>Ваша VPN подписка была удалена администратором.</b>"
    )


# --- Баланс / платежи ---

def build_balance_deposit_message(amount: float) -> str:
    amt = _fmt_amount(amount)
    return (
        f'<tg-emoji emoji-id="{_EMOJI_DEPOSIT}">💸</tg-emoji> '
        f"<b>Баланс был успешно пополнен на {amt}₽!</b>"
    )


def build_admin_balance_add_message(amount: float) -> str:
    amt = _fmt_amount(amount)
    return (
        f'<tg-emoji emoji-id="{_EMOJI_ADMIN_ADD}">🟢</tg-emoji> '
        f"<b>Администратор начислил {amt}₽ вам на баланс!</b>"
    )


def build_admin_balance_sub_message(amount: float) -> str:
    amt = _fmt_amount(amount)
    return (
        f'<tg-emoji emoji-id="{_EMOJI_ADMIN_SUB}">🔴</tg-emoji> '
        f"<b>Администратор списал {amt}₽ с вашего баланса.</b>"
    )


def build_refund_message(amount: float, transaction_id: int) -> str:
    amt = _fmt_amount(amount)
    return (
        f'<tg-emoji emoji-id="{_EMOJI_REFUND}">💸</tg-emoji> '
        f"<b>Возврат средств: {amt}₽</b> по транзакции №{transaction_id}"
    )


# --- Вывод средств ---

def build_withdrawal_created_message(request_no: int) -> str:
    return (
        f'<tg-emoji emoji-id="{_EMOJI_WITHDRAW}">💸</tg-emoji> '
        f"<b>Заявка на вывод №{request_no} была сформирована.</b> "
        f"Она будет одобрена или отклонена в течение 3 рабочих дней."
    )


def build_withdrawal_approved_message(
    request_no: int, amount: float, payment_method: str
) -> str:
    dest = withdrawal_method_destination(payment_method)
    amt = _fmt_amount(amount)
    return (
        f'<tg-emoji emoji-id="{_EMOJI_APPROVE}">➕</tg-emoji> '
        f"<b>Заявка на вывод №{request_no} одобрена.</b>\n\n"
        f"Недавно вы запрашивали вывод реферального баланса <b>{dest}</b> "
        f"в размере <b>{amt}₽</b>. После проверки, ваша заявка была одобрена.\n\n"
        f"В течение нескольких часов мы отправим средства на указанные реквизиты."
    )


def build_withdrawal_completed_message(
    request_no: int, amount: float, payment_method: str
) -> str:
    dest = withdrawal_method_destination(payment_method)
    amt = _fmt_amount(amount)
    return (
        f'<tg-emoji emoji-id="{_EMOJI_OK}">✔️</tg-emoji> '
        f"<b>Вывод №{request_no} был выполнен.</b> "
        f"Средства ({amt}₽) были отправлены <b>{dest}</b>"
    )


def build_withdrawal_rejected_message(
    request_no: int, amount: float, reason: str = ""
) -> str:
    amt = _fmt_amount(amount)
    text = (
        f'<tg-emoji emoji-id="{_EMOJI_BAN}">⛔️</tg-emoji> '
        f"<b>Заявка на вывод №{request_no} отклонена.</b>\n\n"
        f"Сумма: <b>{amt}₽</b> возвращена на реферальный баланс."
    )
    if reason:
        text += f"\n\nПричина: {reason}"
    return text


def build_withdrawal_expired_refund_message(amount: float) -> str:
    amt = _fmt_amount(amount)
    return (
        f'<tg-emoji emoji-id="{_EMOJI_WITHDRAW}">⏰</tg-emoji> '
        f"<b>Истёк срок обработки заявки на вывод</b>\n\n"
        f"Сумма: <b>{amt}₽</b>\n\n"
        f"Заявка не была обработана в течение 7 дней. "
        f"Средства возвращены на ваш реферальный баланс."
    )


def build_withdrawal_admin_request_message(
    request_no: int,
    username: str,
    telegram_id: int,
    amount: float,
    method: str,
    details: str,
) -> str:
    return (
        f"💸 <b>Заявка на вывод №{request_no}</b>\n\n"
        f"👤 Пользователь: @{username}\n"
        f"🔢 Telegram ID: {telegram_id}\n"
        f"💵 Сумма: {_fmt_amount(amount)}₽\n"
        f"💳 Метод: {method}\n"
        f"📝 Детали: {details}"
    )


# --- Бан / аккаунт ---

def build_ban_message(reason: str = None) -> str:
    if reason and str(reason).strip():
        return (
            f'<tg-emoji emoji-id="{_EMOJI_BAN}">⛔️</tg-emoji> '
            f"<b>Ваш аккаунт заблокирован.</b>\n"
            f"Причина: <b>«{reason.strip()}»</b>\n\n"
            f"Вы можете обжаловать блокировку в нашей поддержке."
        )
    return (
        f'<tg-emoji emoji-id="{_EMOJI_BAN}">⛔️</tg-emoji> '
        f"<b>Ваш аккаунт заблокирован.</b>\n\n"
        f"Вы можете обжаловать блокировку в нашей поддержке, но имейте ввиду, "
        f"что мы не обязаны разглашать причину блокировки."
    )


def build_unban_message() -> str:
    return (
        f'<tg-emoji emoji-id="{_EMOJI_UNBAN}">✅</tg-emoji> '
        f"<b>Ваш аккаунт разблокирован!</b> Вы снова можете пользоваться сервисом."
    )


def build_trial_reset_message() -> str:
    return (
        f'<tg-emoji emoji-id="{_EMOJI_KEY}">🎁</tg-emoji> '
        f"<b>Ваш пробный период сброшен!</b> Вы можете снова воспользоваться триалом."
    )


def build_keys_deleted_by_admin_message() -> str:
    return (
        f'<tg-emoji emoji-id="{_EMOJI_DELETE}">🔑</tg-emoji> '
        f"<b>Ваши VPN ключи были удалены.</b>"
    )


# --- Рефералы / партнёрка ---

def build_new_referral_message(referral_name: str) -> str:
    return (
        f'<tg-emoji emoji-id="{_EMOJI_REFERRAL}">🎉</tg-emoji> <b>Новый реферал!</b>\n\n'
        f"Пользователь <b>{referral_name}</b> присоединился по вашей ссылке.\n"
        f"Вы будете получать 20% с его покупок и 5% с покупок его рефералов."
    )


def build_referral_income_purchase_message(rate: float, income: float) -> str:
    return (
        f'<tg-emoji emoji-id="{_EMOJI_REFERRAL_INCOME}">💰</tg-emoji> <b>Реферальный доход!</b>\n\n'
        f"Ваш реферал совершил покупку.\n"
        f"Ваша комиссия ({rate:g}%): <b>{income:.2f}₽</b>\n\n"
        f"Доступно для вывода: проверьте в разделе «Рефералы»"
    )


def build_referral_income_extend_message(rate: float, income: float) -> str:
    return (
        f'<tg-emoji emoji-id="{_EMOJI_REFERRAL_INCOME}">💰</tg-emoji> <b>Реферальный доход!</b>\n\n'
        f"Ваш реферал продлил подписку.\n"
        f"Ваша комиссия ({rate:g}%): <b>{income:.2f}₽</b>\n\n"
        f"Доступно для вывода: проверьте в разделе «Рефералы»"
    )


def build_referral_income_second_line_message(rate: float, income: float) -> str:
    return (
        f'<tg-emoji emoji-id="{_EMOJI_REFERRAL_INCOME}">💰</tg-emoji> <b>Реферальный доход (2-я линия)!</b>\n\n'
        f"Покупку совершил реферал вашего реферала.\n"
        f"Ваша комиссия ({rate:g}%): <b>{income:.2f}₽</b>\n\n"
        f"Доступно для вывода: раздел «Рефералы»"
    )


def build_partner_enabled_message(rate: int) -> str:
    return (
        f'<tg-emoji emoji-id="{_EMOJI_PARTNER}">🤝</tg-emoji> '
        f"<b>Вы стали партнером!</b> Ваша комиссия: <b>{rate}%</b>"
    )


def build_partner_disabled_message() -> str:
    return (
        f'<tg-emoji emoji-id="{_EMOJI_PARTNER}">👤</tg-emoji> '
        f"<b>Ваш партнерский статус отменен.</b>"
    )


def build_partner_rate_message(rate: int) -> str:
    return (
        f'<tg-emoji emoji-id="{_EMOJI_PARTNER}">🤝</tg-emoji> '
        f"<b>Ваша партнёрская комиссия обновлена: {rate}%</b>"
    )


def build_second_level_rate_message(rate: int) -> str:
    return (
        f'<tg-emoji emoji-id="{_EMOJI_PARTNER}">🤝</tg-emoji> '
        f"<b>Ставка 2-й линии обновлена: {rate}%</b>"
    )


def build_third_level_rate_message(rate: int) -> str:
    return (
        f'<tg-emoji emoji-id="{_EMOJI_PARTNER}">🤝</tg-emoji> '
        f"<b>Ставка 3-й линии обновлена: {rate}%</b>"
    )


# --- Вовлечение ---

def build_no_sub_message() -> str:
    return (
        f'<tg-emoji emoji-id="{_EMOJI_NO_SUB}">⚙️</tg-emoji> '
        f"<b>Вы всё еще не оформили подписку!</b>\n\n"
        f"А ведь с BlinVPN вы бы получили доступ в свободный интернет, "
        f"безопасность и качественную поддержку."
    )


def build_discount_offer_message() -> str:
    return (
        f'<tg-emoji emoji-id="{_EMOJI_DISCOUNT}">🚩</tg-emoji> '
        f"<b>Слушай сюда, ты так и не оформил подписку...</b>\n\n"
        f"Мы дали тебе скидку <b>10%</b> на покупку, но она действует только один раз и "
        f"<b>только в течение 24 часов.</b> Если не успеешь купить подписку... потеряешь скидку"
    )


def build_comeback_message() -> str:
    return (
        f'<tg-emoji emoji-id="{_EMOJI_COMEBACK}">😵‍💫</tg-emoji> '
        f"<b>Вы давно не заглядывали!</b>\n"
        f"Расскажите, почему вы ушли от нас, а если что-то пошло не так — вернём деньги."
    )


# --- Ключ / VPN ---

def build_key_created_message(days: int, traffic_gb: int, devices: int) -> str:
    return (
        f'<tg-emoji emoji-id="{_EMOJI_KEY}">🎉</tg-emoji> <b>Ваш VPN ключ готов!</b>\n\n'
        f"📅 Срок действия: {days} {_days_word(days)}\n"
        f"📊 Лимит трафика: {traffic_gb} ГБ\n"
        f"📱 Устройства: {devices}\n\n"
        f"🔗 Нажмите, чтобы увидеть инструкцию"
    )


# --- Команды бота (не /start) ---

def build_support_command_message() -> str:
    return "Напишите в поддержку, мы поможем."


def build_unknown_command_message() -> str:
    return "Не знаю такую команду. Обратитесь в поддержку."


def build_promo_activated_message(promo_code: str, detail: str) -> str:
    return f"🎁 Промокод <b>{promo_code}</b> активирован.\n{detail}"


def build_promo_failed_message(promo_code: str, error: str) -> str:
    return f"⚠️ Промокод <b>{promo_code}</b>: {error}"


# --- Промокоды (ответ API / бот) ---

def build_promo_balance_message(amount: float) -> str:
    return f"Баланс пополнен на {_fmt_amount(amount)}₽"


def build_promo_discount_message(percent: int) -> str:
    return f"Получена скидка {percent}% на следующую покупку"


def build_promo_subscription_days_message(days: int) -> str:
    return f"Начислено {days} дней подписки. Создайте подписку и подтвердите."


def build_promo_subscription_extended_message(days: int) -> str:
    return f"Подписки продлены на {days} дней"


# --- Админ-уведомления ---

def build_admin_deposit_notification(
    amount: float, username: str, telegram_id, method: str, provider: str = ""
) -> str:
    uname = username if str(username).startswith("@") else f"@{username}"
    suffix = f" ({provider})" if provider else ""
    return (
        f"💰 Пополнение на {_fmt_amount(amount)}₽ от {uname} ({telegram_id}) "
        f"через {method}{suffix}"
    )


def build_admin_payment_received_message(
    username: str, amount: float, payment_method: str, payment_provider: str
) -> str:
    return (
        f"💳 <b>Платеж получен:</b>\n"
        f"Пользователь: @{username}\n"
        f"Сумма: {_fmt_amount(amount)}₽\n"
        f"Метод: {payment_method} ({payment_provider})"
    )


def build_panel_login_2fa_message(
    code: str, ip_address: str, admin_username: str, time_utc: str
) -> str:
    return (
        f"🔐 <b>Подтверждение входа в панель</b>\n\n"
        f"Код: <code>{code}</code>\n"
        f"IP: <code>{ip_address}</code>\n"
        f"Админ: <b>{admin_username}</b>\n"
        f"Время: {time_utc} UTC"
    )
