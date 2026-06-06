"""
REST API сервер для мини-приложения и панели
"""
import os
import logging
import hmac
import hashlib
import json
import secrets
import random
import requests
import re
from datetime import datetime, timedelta, timezone
from urllib.parse import parse_qs, unquote
from flask import Flask, request, jsonify, Response
from flask_cors import CORS
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '../../'))

from src.database import database
from src.core import core
from src.core import messages as notify_msgs
from src.core.blacklist import start_blacklist_updater, update_blacklist
from src.api import remnawave, heleket, platega, rollypay, cryptopay
from src.api.payment_poller import start_payment_poller
from src.core import payment_wait

app = Flask(__name__)

# CORS для miniapp и панели
CORS(
    app,
    resources={r"/api/*": {"origins": "*"}},
)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


# МСК = UTC+3 (единый источник для отображения времени окончания)
MSK_UTC_OFFSET_HOURS = 3


def _utc_to_msk(dt: datetime) -> datetime:
    """Преобразовать datetime (UTC или naive как UTC) в наивное МСК время для отображения."""
    if dt.tzinfo:
        dt = dt.replace(tzinfo=None) - timedelta(seconds=dt.utcoffset().total_seconds() if dt.utcoffset() else 0)
    return dt + timedelta(hours=MSK_UTC_OFFSET_HOURS)


def format_datetime_msk(dt: datetime = None) -> str:
    """Форматировать datetime в ISO формат для отображения в МСК (храним в UTC, показываем МСК)."""
    if dt is None:
        dt = datetime.now(timezone.utc).replace(tzinfo=None)
    dt_msk = _utc_to_msk(dt)
    return dt_msk.strftime('%Y-%m-%dT%H:%M:%S')


def format_expiry_for_notification(expiry_date_str: str) -> str:
    """Форматировать дату истечения для уведомлений в читаемом формате МСК (источник истины — UTC в БД)."""
    try:
        if isinstance(expiry_date_str, str):
            dt = datetime.fromisoformat(expiry_date_str.replace('Z', '+00:00').replace('+00:00', ''))
        else:
            dt = expiry_date_str
        if hasattr(dt, 'tzinfo') and dt.tzinfo:
            dt = dt.replace(tzinfo=None) - timedelta(seconds=dt.utcoffset().total_seconds() if dt.utcoffset() else 0)
        dt_msk = _utc_to_msk(dt)
        months = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
                  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря']
        return f"{dt_msk.day} {months[dt_msk.month-1]} {dt_msk.year} в {dt_msk.strftime('%H:%M')}"
    except Exception:
        return str(expiry_date_str) if expiry_date_str else ''

BOT_TOKEN = os.getenv('TELEGRAM_BOT_TOKEN') or os.getenv('BOT_TOKEN', '')
REQUIRED_CHANNEL_ID = int(os.getenv('REQUIRED_CHANNEL_ID', '-1003036752851'))
REQUIRED_CHANNEL_LINK = os.getenv('REQUIRED_CHANNEL_LINK', 'https://t.me/blinvpn')


def check_required_channel_subscription(telegram_id: int) -> bool:
    token = os.getenv('TELEGRAM_BOT_TOKEN') or BOT_TOKEN
    if not token:
        return True
    try:
        resp = requests.get(
            f"https://api.telegram.org/bot{token}/getChatMember",
            params={"chat_id": REQUIRED_CHANNEL_ID, "user_id": telegram_id},
            timeout=5,
        )
        data = resp.json() if resp.ok else {}
        status = ((data.get("result") or {}).get("status") or "").lower()
        return status in {"member", "administrator", "creator"}
    except Exception as e:
        logger.warning(f"Failed to check channel subscription for {telegram_id}: {e}")
        return False


def get_admin_ids() -> list[int]:
    ids: list[int] = []
    raw_admin_ids = os.getenv('TELEGRAM_ADMIN_IDS', '')
    raw_admin_id = os.getenv('TELEGRAM_ADMIN_ID', '')
    values = []
    if raw_admin_ids:
        values.extend([v.strip() for v in raw_admin_ids.split(',') if v.strip()])
    if raw_admin_id:
        values.append(raw_admin_id.strip())
    for value in values:
        try:
            ids.append(int(value))
        except Exception:
            continue
    unique: list[int] = []
    for admin_id in ids:
        if admin_id not in unique:
            unique.append(admin_id)
    return unique


def get_client_ip() -> str:
    forwarded = request.headers.get('X-Forwarded-For', '')
    if forwarded:
        return forwarded.split(',')[0].strip()
    real_ip = request.headers.get('X-Real-IP')
    if real_ip:
        return real_ip.strip()
    return request.remote_addr or 'unknown'


def get_user_ban_status(user: dict, telegram_id: int | None = None) -> dict:
    """Проверка блокировки пользователя без legacy-модуля abuse."""
    actual_telegram_id = telegram_id if telegram_id is not None else user.get('telegram_id')
    if actual_telegram_id and core.check_blacklist(int(actual_telegram_id)):
        return {'banned': True, 'reason': 'Ваш аккаунт находится в черном списке', 'blacklisted': True}
    if user.get('is_banned'):
        return {'banned': True, 'reason': user.get('ban_reason') or 'Аккаунт заблокирован'}
    return {'banned': False}


def notify_referral_income_credited(referral_result: dict | None, *, extended: bool = False) -> None:
    """Уведомления рефереру 1-й и 2-й линии после начисления."""
    if not referral_result:
        return
    try:
        tg_l1 = referral_result.get('referrer_telegram_id')
        if tg_l1:
            income = float(referral_result.get('income') or 0)
            rate = float(referral_result.get('rate') or 20)
            msg = (
                notify_msgs.build_referral_income_extend_message(rate, income)
                if extended
                else notify_msgs.build_referral_income_purchase_message(rate, income)
            )
            core.send_notification_to_user(int(tg_l1), msg)
        second = referral_result.get('second_line')
        if second and second.get('referrer_telegram_id'):
            core.send_notification_to_user(
                int(second['referrer_telegram_id']),
                notify_msgs.build_referral_income_second_line_message(
                    float(second.get('rate') or 5),
                    float(second.get('income') or 0),
                ),
            )
    except Exception as e:
        logger.error("Failed to notify referrers: %s", e)


def reconcile_pending_cryptopay_for_user(user_id: int) -> None:
    """
    Fallback reconciliation for CryptoPay invoices in case webhook is delayed/lost.
    Checks user's recent pending invoices and credits paid ones exactly once.
    """
    if not cryptopay.cryptopay_api.is_configured:
        return
    conn = None
    try:
        conn = database.get_db_connection()
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT id, payment_id
            FROM transactions
            WHERE user_id = ?
              AND payment_provider = 'CryptoPay'
              AND status = 'Pending'
            ORDER BY id DESC
            LIMIT 5
            """,
            (int(user_id),),
        )
        pending_rows = cursor.fetchall() or []
        conn.close()
        conn = None
        for row in pending_rows:
            payment_id = str(row["payment_id"] or "")
            if not payment_id.startswith("cryptopay:"):
                continue
            raw_invoice_id = payment_id.split(":", 1)[1]
            if not raw_invoice_id.isdigit():
                continue
            invoice = cryptopay.cryptopay_api.get_invoice(int(raw_invoice_id))
            if not isinstance(invoice, dict):
                continue
            status = str(invoice.get("status") or "").strip().lower()
            if status != "paid":
                continue
            amount_raw = (
                invoice.get("paid_fiat_amount")
                or invoice.get("fiat_amount")
                or invoice.get("amount")
                or 0
            )
            try:
                amount = float(str(amount_raw).replace(",", "."))
            except Exception:
                amount = 0.0
            from src.core.webhook import credit_deposit_from_payment

            credited = credit_deposit_from_payment(
                user_id=int(user_id),
                amount=amount,
                payment_id=payment_id,
                provider="CryptoPay",
                method_name="CryptoPay",
            )
            if credited:
                logger.info(
                    "CryptoPay reconciled pending payment %s for user_id=%s",
                    payment_id,
                    user_id,
                )
    except Exception as e:
        logger.warning("CryptoPay reconcile failed for user_id=%s: %s", user_id, e)
        try:
            if conn:
                conn.close()
        except Exception:
            pass


@app.route('/api/telegram/webhook', methods=['POST'])
def telegram_webhook():
    """
    Резервный webhook для Telegram Stars (если TELEGRAM_STARS_DELIVERY=webhook).
    В Docker по умолчанию Stars обрабатывает бот через polling (см. bot.py).
    """
    from src.api import telegram_stars as stars

    secret_expected = os.getenv("TELEGRAM_WEBHOOK_SECRET", "")
    if secret_expected:
        got = request.headers.get("X-Telegram-Bot-Api-Secret-Token", "")
        if not hmac.compare_digest(str(got), str(secret_expected)):
            return jsonify({"ok": True}), 200

    update = request.json if request.is_json else {}
    if not isinstance(update, dict):
        return jsonify({"ok": True}), 200

    if update.get("pre_checkout_query"):
        stars.process_pre_checkout_query(update.get("pre_checkout_query") or {})
        return jsonify({"ok": True}), 200

    msg = update.get("message") or {}
    successful = msg.get("successful_payment") or {}
    if successful:
        try:
            stars.process_successful_payment(successful)
        except Exception as e:
            logger.error("Telegram webhook successful_payment handler error: %s", e)
        return jsonify({"ok": True}), 200

    return jsonify({"ok": True}), 200


@app.route('/cryptopay', methods=['POST'])
@app.route('/api/cryptopay', methods=['POST'])
def cryptopay_webhook_proxy():
    """
    Fallback CryptoPay webhook endpoint inside API service.
    Uses the same processing logic as dedicated webhook service to avoid
    payment loss when reverse-proxy/webhook target points to API container.
    """
    from src.core.webhook import handle_cryptopay_webhook
    return handle_cryptopay_webhook()


def parse_env_file() -> dict[str, str]:
    env_path = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), '.env')
    result: dict[str, str] = {}
    if not os.path.exists(env_path):
        return result
    with open(env_path, 'r', encoding='utf-8') as f:
        for line in f:
            raw = line.strip()
            if not raw or raw.startswith('#') or '=' not in raw:
                continue
            key, value = raw.split('=', 1)
            key = key.strip()
            value = value.strip()
            if (value.startswith('"') and value.endswith('"')) or (value.startswith("'") and value.endswith("'")):
                value = value[1:-1]
            result[key] = value
    return result


def update_env_values(updates: dict[str, str]) -> None:
    env_path = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), '.env')
    lines: list[str] = []
    if os.path.exists(env_path):
        with open(env_path, 'r', encoding='utf-8') as f:
            lines = f.readlines()
    existing_keys = set()
    output: list[str] = []
    for line in lines:
        stripped = line.strip()
        if '=' in stripped and not stripped.startswith('#'):
            key = stripped.split('=', 1)[0].strip()
            if key in updates:
                output.append(f"{key}={updates[key]}\n")
                existing_keys.add(key)
                continue
        output.append(line)
    for key, value in updates.items():
        if key not in existing_keys:
            output.append(f"{key}={value}\n")
    with open(env_path, 'w', encoding='utf-8') as f:
        f.writelines(output)
    for key, value in updates.items():
        os.environ[key] = value


ENV_SETTINGS_KEYS = {
    'TELEGRAM_BOT_TOKEN',
    'TELEGRAM_ADMIN_IDS',
    'REMWAVE_PANEL_URL',
    'REMWAVE_API_KEY',
    'PLATEGA_MERCHANT_ID',
    'PLATEGA_SECRET_KEY',
    'ROLLYPAY_API_KEY',
    'ROLLYPAY_SIGNING_SECRET',
    'HELEKET_MERCHANT',
    'HELEKET_API_KEY',
    'CRYPTOPAY_API_TOKEN',
    'CRYPTOBOT_API_TOKEN',
    'TELEGRAM_WEBHOOK_SECRET',
    'BOT_USERNAME',
}


def telegram_send_message(chat_id: int, text: str, parse_mode: str = 'HTML', reply_markup: dict | None = None) -> dict | None:
    token = os.getenv('TELEGRAM_BOT_TOKEN', '')
    if not token:
        return None
    import requests
    payload = {'chat_id': chat_id, 'text': text, 'parse_mode': parse_mode}
    if reply_markup:
        payload['reply_markup'] = reply_markup
    res = requests.post(f"https://api.telegram.org/bot{token}/sendMessage", json=payload, timeout=20)
    data = res.json() if res.content else {}
    if res.status_code == 200 and data.get('ok'):
        return data.get('result')
    return None


def telegram_send_photo(chat_id: int, photo: str, caption: str = '', parse_mode: str = 'HTML', reply_markup: dict | None = None) -> dict | None:
    token = os.getenv('TELEGRAM_BOT_TOKEN', '')
    if not token:
        return None
    import requests
    payload = {'chat_id': chat_id, 'photo': photo}
    if caption:
        payload['caption'] = caption
        payload['parse_mode'] = parse_mode
    if reply_markup:
        payload['reply_markup'] = reply_markup
    res = requests.post(f"https://api.telegram.org/bot{token}/sendPhoto", json=payload, timeout=25)
    data = res.json() if res.content else {}
    if res.status_code == 200 and data.get('ok'):
        return data.get('result')
    return None


def _normalize_mailing_markup(message: str, parse_mode: str = 'HTML') -> tuple[str, str]:
    """
    Supports:
    - HTML tags (<b>, <i>, <code>)
    - markdown-like **bold**, *italic*, `mono`
    - premium emoji syntax ![1234567890] -> <tg-emoji emoji-id="..."></tg-emoji>
    """
    text = str(message or '')
    # premium emoji: ![123] or ![123_emoji]
    text = re.sub(r'!\[(\d+)(?:[_-][^\]]+)?\]', r'<tg-emoji emoji-id="\1">✨</tg-emoji>', text)
    # lightweight markdown to html
    text = re.sub(r'\*\*(.+?)\*\*', r'<b>\1</b>', text, flags=re.S)
    text = re.sub(r'(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)', r'<i>\1</i>', text, flags=re.S)
    text = re.sub(r'`(.+?)`', r'<code>\1</code>', text, flags=re.S)
    return text, 'HTML'


def fetch_telegram_user_avatar(telegram_id: int) -> tuple[bytes, str] | None:
    """
    Скачивает аватар пользователя через Bot API (сервер → Telegram).
    Клиенту отдаём байты с нашего домена — CDN Telegram в РФ недоступен.
    """
    token = os.getenv('TELEGRAM_BOT_TOKEN') or BOT_TOKEN
    if not token or not telegram_id:
        return None
    api_base = f"https://api.telegram.org/bot{token}"
    try:
        photos_resp = requests.get(
            f"{api_base}/getUserProfilePhotos",
            params={"user_id": int(telegram_id), "limit": 1},
            timeout=10,
        )
        photos_data = photos_resp.json() if photos_resp.ok else {}
        if not photos_data.get("ok"):
            return None
        batches = (photos_data.get("result") or {}).get("photos") or []
        if not batches:
            return None
        sizes = batches[0]
        if not sizes:
            return None
        file_id = sizes[-1].get("file_id")
        if not file_id:
            return None

        file_resp = requests.get(
            f"{api_base}/getFile",
            params={"file_id": file_id},
            timeout=10,
        )
        file_data = file_resp.json() if file_resp.ok else {}
        if not file_data.get("ok"):
            return None
        file_path = (file_data.get("result") or {}).get("file_path")
        if not file_path:
            return None

        download_resp = requests.get(
            f"https://api.telegram.org/file/bot{token}/{file_path}",
            timeout=15,
        )
        if not download_resp.ok or not download_resp.content:
            return None
        content_type = download_resp.headers.get("Content-Type") or "image/jpeg"
        if "image" not in content_type.lower():
            content_type = "image/jpeg"
        return download_resp.content, content_type
    except Exception as e:
        logger.warning("fetch_telegram_user_avatar failed for %s: %s", telegram_id, e)
        return None


def telegram_delete_message(chat_id: int, message_id: int) -> bool:
    token = os.getenv('TELEGRAM_BOT_TOKEN', '')
    if not token:
        return False
    import requests
    res = requests.post(
        f"https://api.telegram.org/bot{token}/deleteMessage",
        json={'chat_id': chat_id, 'message_id': message_id},
        timeout=15,
    )
    try:
        data = res.json()
    except Exception:
        return False
    return bool(res.status_code == 200 and data.get('ok'))

def verify_telegram_webapp_data(init_data: str) -> dict | None:
    """
    Проверяет подлинность данных Telegram WebApp.
    Возвращает данные пользователя если валидно, иначе None.
    """
    if not init_data:
        return None
    if not BOT_TOKEN:
        logger.error('Telegram WebApp verify: TELEGRAM_BOT_TOKEN / BOT_TOKEN не задан')
        return None
    
    try:
        parsed = parse_qs(init_data)
        
        # Получаем hash из данных
        received_hash = parsed.get('hash', [''])[0]
        if not received_hash:
            return None
        
        # Создаём строку для проверки (все параметры кроме hash, отсортированные)
        data_check_arr = []
        for key, value in parsed.items():
            if key != 'hash':
                data_check_arr.append(f"{key}={value[0]}")
        data_check_arr.sort()
        data_check_string = '\n'.join(data_check_arr)
        
        # Создаём секретный ключ из токена бота
        secret_key = hmac.new(
            b'WebAppData',
            BOT_TOKEN.encode(),
            hashlib.sha256
        ).digest()
        
        # Вычисляем hash
        calculated_hash = hmac.new(
            secret_key,
            data_check_string.encode(),
            hashlib.sha256
        ).hexdigest()
        
        # Проверяем hash
        if not hmac.compare_digest(calculated_hash, received_hash):
            return None
        
        # Парсим данные пользователя
        import json
        user_data_str = parsed.get('user', [''])[0]
        if user_data_str:
            user_data = json.loads(unquote(user_data_str))
            return user_data
        
        return None
    except Exception as e:
        logger.error(f"Error verifying Telegram WebApp data: {e}")
        return None

def get_telegram_init_data_from_request() -> str:
    """initData из X-Telegram-Init-Data или Authorization: tma <initData>."""
    init_data = (request.headers.get('X-Telegram-Init-Data') or '').strip()
    if init_data:
        return init_data
    auth = (request.headers.get('Authorization') or '').strip()
    if auth.lower().startswith('tma '):
        return auth[4:].strip()
    return ''


def get_telegram_user_from_request() -> dict | None:
    """
    Получает и проверяет Telegram пользователя из запроса.
    Проверяет X-Telegram-Init-Data / Authorization: tma.
    """
    init_data = get_telegram_init_data_from_request()
    if init_data:
        return verify_telegram_webapp_data(init_data)
    return None


def miniapp_auth_relaxed() -> bool:
    """Разрешить miniapp без initData (только dev: MINIAPP_ALLOW_UNAUTH=1)."""
    return os.getenv('MINIAPP_ALLOW_UNAUTH', '').lower() in ('1', 'true', 'yes')


def enforce_telegram_id_auth(telegram_id: int | None):
    """
    Проверяет, что telegram_id совпадает с пользователем из подписанного initData.
    Returns None если OK, иначе (response, status_code).
    """
    if not telegram_id:
        return jsonify({'error': 'telegram_id required'}), 400

    tg_user = get_telegram_user_from_request()
    if tg_user:
        verified_id = int(tg_user.get('id') or 0)
        if verified_id != int(telegram_id):
            logger.warning(
                'telegram_id spoof attempt: claimed=%s verified=%s ip=%s',
                telegram_id,
                verified_id,
                request.remote_addr,
            )
            return jsonify({'error': 'Forbidden'}), 403
        return None

    if miniapp_auth_relaxed():
        return None

    return jsonify({
        'error': 'Unauthorized',
        'message': 'Valid X-Telegram-Init-Data header required',
    }), 401


def enforce_user_id_auth(user_id: int | None, user: dict | None = None):
    """
    Проверяет, что user_id принадлежит пользователю из initData.
    Returns None если OK, иначе (response, status_code).
    """
    if not user_id:
        return jsonify({'error': 'user_id required'}), 400

    if user is None:
        user = database.get_user_by_id(int(user_id))
    if not user:
        return jsonify({'error': 'User not found'}), 404

    tg_user = get_telegram_user_from_request()
    if tg_user:
        verified_id = int(tg_user.get('id') or 0)
        owner_id = int(user.get('telegram_id') or 0)
        if verified_id != owner_id:
            logger.warning(
                'user_id spoof attempt: user_id=%s owner_tg=%s verified_tg=%s ip=%s',
                user_id,
                owner_id,
                verified_id,
                request.remote_addr,
            )
            return jsonify({'error': 'Forbidden'}), 403
        return None

    if miniapp_auth_relaxed():
        return None

    return jsonify({
        'error': 'Unauthorized',
        'message': 'Valid X-Telegram-Init-Data header required',
    }), 401

def require_auth(f):
    """Декоратор для проверки аутентификации по session token."""
    def wrapper(*args, **kwargs):
        auth_header = request.headers.get('Authorization')
        if not auth_header:
            return jsonify({'error': 'Unauthorized'}), 401
        
        # Извлекаем токен
        if not auth_header.startswith('Bearer '):
            return jsonify({'error': 'Invalid authorization format'}), 401
        
        token = auth_header[7:]  # Убираем "Bearer "
        
        # Проверяем сессию
        session = database.verify_panel_session(token)
        if session:
            return f(*args, **kwargs)
        
        return jsonify({'error': 'Unauthorized'}), 401
    wrapper.__name__ = f.__name__
    return wrapper

# ========== Шифрование ссылки для Happ ==========

@app.route('/api/encrypt-link', methods=['POST'])
def encrypt_link_for_happ():
    """Проксирует запрос на шифрование ссылки через crypto.happ.su"""
    import requests as req
    
    data = request.get_json()
    url = data.get('url') if data else None
    
    if not url:
        return jsonify({'error': 'URL is required'}), 400
    
    try:
        response = req.post(
            'https://crypto.happ.su/api.php',
            json={'url': url},
            headers={'Content-Type': 'application/json'},
            timeout=10
        )
        
        if response.ok:
            result = response.json()
            if result and result.get('encrypted_link'):
                return jsonify({'encrypted_link': result['encrypted_link']})
        
        logger.error(f"Happ encryption API failed: {response.status_code} - {response.text}")
        return jsonify({'error': 'Encryption failed'}), 500
    except Exception as e:
        logger.error(f"Happ encryption API error: {e}")
        return jsonify({'error': str(e)}), 500

# ========== Редирект для открытия Happ ==========

@app.route('/api/redirect')
def redirect_to_happ():
    """Страница редиректа для открытия приложения Happ"""
    from flask import Response
    
    url = request.args.get('url', '')
    
    html = f'''<!DOCTYPE html>
<html lang="ru">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Открываем Happ...</title>
    <style>
        * {{ margin: 0; padding: 0; box-sizing: border-box; }}
        body {{
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            color: #fff;
        }}
        @media (prefers-color-scheme: light) {{
            body {{
                background: linear-gradient(135deg, #f5f5f7 0%, #e5e7eb 100%);
                color: #1d1d1f;
            }}
            .spinner {{
                border-color: rgba(0,0,0,0.1);
                border-top-color: #3b82f6;
            }}
            .error {{
                background: rgba(0,0,0,0.05);
            }}
            .btn {{
                background: #3b82f6;
                color: #fff;
            }}
        }}
        .container {{ text-align: center; padding: 2rem; }}
        .spinner {{
            width: 48px;
            height: 48px;
            border: 4px solid rgba(255,255,255,0.2);
            border-top-color: #fff;
            border-radius: 50%;
            animation: spin 1s linear infinite;
            margin: 0 auto 1.5rem;
        }}
        @keyframes spin {{ to {{ transform: rotate(360deg); }} }}
        h1 {{ font-size: 1.25rem; font-weight: 500; margin-bottom: 0.5rem; }}
        p {{ font-size: 0.875rem; opacity: 0.7; }}
        .error {{
            display: none;
            margin-top: 1.5rem;
            padding: 1rem;
            background: rgba(255,255,255,0.1);
            border-radius: 8px;
        }}
        .error.show {{ display: block; }}
        .btn {{
            display: inline-block;
            margin-top: 1rem;
            padding: 0.75rem 1.5rem;
            background: #fff;
            color: #1a1a2e;
            text-decoration: none;
            border-radius: 8px;
            font-weight: 500;
        }}
    </style>
</head>
<body>
    <div class="container">
        <div class="spinner" id="spinner"></div>
        <h1 id="title">Открываем приложение...</h1>
        <p id="subtitle">Пожалуйста, подождите</p>
        <div class="error" id="errorBlock">
            <p>Если приложение не открылось, нажмите кнопку:</p>
            <a class="btn" id="manualBtn" href="#">Открыть приложение</a>
        </div>
    </div>

    <script>
        (function() {{
            var url = "{url}";
            
            if (!url) {{
                document.getElementById('title').textContent = 'URL не указан';
                document.getElementById('subtitle').textContent = '';
                document.getElementById('spinner').style.display = 'none';
                return;
            }}
            
            var manualBtn = document.getElementById('manualBtn');
            manualBtn.href = url;
            
            // Открываем URL напрямую
            window.location.href = url;
            
            // Показываем кнопку через 2 секунды если редирект не сработал
            setTimeout(function() {{
                document.getElementById('errorBlock').classList.add('show');
            }}, 2000);
        }})();
    </script>
</body>
</html>'''
    
    return Response(html, mimetype='text/html')

# ========== API для мини-приложения ==========

@app.route('/api/user/info', methods=['GET'])
def get_user_info():
    """Получить информацию о пользователе"""
    telegram_id = request.args.get('telegram_id', type=int)
    username = request.args.get('username', '')
    first_name = request.args.get('first_name', '')  # Имя пользователя из Telegram
    ref = request.args.get('ref', type=int)  # Telegram ID реферера

    auth_err = enforce_telegram_id_auth(telegram_id)
    if auth_err:
        return auth_err
    
    # Нельзя быть своим собственным рефералом
    if ref == telegram_id:
        ref = None
    
    user = database.get_user_by_telegram_id(telegram_id)
    is_new_user = False
    
    # Автоматически создаем пользователя если его нет
    if not user:
        is_new_user = True
        
        # Обрабатываем реферала
        referred_by = None
        referrer = None
        if ref:
            # Проверяем, существует ли реферер
            referrer = database.get_user_by_telegram_id(ref)
            if referrer:
                # Проверяем рейт-лимит (25 рефералов в минуту)
                if database.check_referral_rate_limit(ref, limit=25, window_seconds=60):
                    referred_by = referrer['id']
                    logger.info(f"Referral accepted: user {telegram_id} referred by {ref}")
                else:
                    logger.warning(f"Referral rate limit exceeded for referrer {ref}")
        
        # Создаем пользователя с full_name = first_name
        user_id = database.create_user(
            telegram_id, 
            username or f'user_{telegram_id}',
            full_name=first_name or None,
            referred_by=referred_by
        )
        user = database.get_user_by_id(user_id)
        if not user:
            return jsonify({'error': 'Failed to create user'}), 500
        
        # Уведомляем реферера о новом реферале
        if referred_by and referrer:
            try:
                new_user_name = first_name or username or f"user_{telegram_id}"
                core.send_notification_to_user(
                    referrer['telegram_id'],
                    notify_msgs.build_new_referral_message(new_user_name),
                )
                logger.info(f"Notified referrer {ref} about new referral {telegram_id}")
            except Exception as e:
                logger.error(f"Failed to notify referrer about new referral: {e}")
    else:
        # Пользователь уже существует - попробуем установить реферера, если его нет
        if ref and user.get('referred_by') is None:
            referrer = database.get_user_by_telegram_id(ref)
            if referrer:
                # Проверяем рейт-лимит
                if database.check_referral_rate_limit(ref, limit=25, window_seconds=60):
                    if database.set_referrer_for_user(user['id'], referrer['id']):
                        logger.info(f"Referral set for existing user {telegram_id} -> {ref}")
                        # Обновляем user для получения актуальных данных
                        user = database.get_user_by_telegram_id(telegram_id)
                else:
                    logger.warning(f"Referral rate limit exceeded for referrer {ref}")
        
        # Обновляем first_name если он изменился (всегда актуальное имя из Telegram)
        if first_name and first_name != user.get('full_name'):
            database.update_user_full_name(telegram_id, first_name)
            user = database.get_user_by_telegram_id(telegram_id)

    # Fallback auto-reconcile for CryptoPay before returning live balance.
    reconcile_pending_cryptopay_for_user(int(user['id']))
    user = database.get_user_by_telegram_id(telegram_id)
    
    # Проверка бана (включая черный список)
    ban_status = get_user_ban_status(user, telegram_id)
    if ban_status.get('banned'):
        return jsonify({
            'banned': True,
            'reason': ban_status.get('reason', 'Аккаунт заблокирован'),
            'blacklisted': ban_status.get('blacklisted', False)
        }), 403

    if not check_required_channel_subscription(telegram_id):
        return jsonify({
            'required_subscription': True,
            'channel_id': REQUIRED_CHANNEL_ID,
            'channel_link': REQUIRED_CHANNEL_LINK
        }), 403
    
    stats = core.get_referral_stats(user['id'])
    
    # Получаем дату последнего вывода на карту
    last_card_withdrawal = None
    try:
        conn = database.get_db_connection()
        cursor = conn.cursor()
        cursor.execute("""
            SELECT created_at FROM transactions 
            WHERE user_id = ? AND type = 'withdrawal_request' AND payment_method = 'Карта'
            ORDER BY created_at DESC LIMIT 1
        """, (user['id'],))
        last_row = cursor.fetchone()
        if last_row:
            last_card_withdrawal = last_row['created_at']
        conn.close()
    except Exception as e:
        logger.error(f"Error getting last card withdrawal: {e}")

    invite_discount = bool(user.get('referred_by')) and not database.user_has_paid_subscription_purchase(int(user['id']))

    return jsonify({
        'id': user['id'],
        'telegram_id': user['telegram_id'],
        'username': user.get('username'),
        'full_name': user.get('full_name'),  # First name из Telegram
        'balance': user.get('balance', 0),
        'status': user.get('status', 'Trial'),
        'referral_code': user.get('referral_code'),
        'partner_balance': stats.get('partner_balance', 0),  # Доступно для вывода
        'referrals_count': stats.get('referrals_count', 0),
        'referral_earned': stats.get('total_earned', 0),  # Всего заработано
        'referral_rate': stats.get('rate', 20),
        'is_new_user': is_new_user,
        'trial_used': user.get('trial_used', 0),  # Был ли использован пробный период
        'last_card_withdrawal': last_card_withdrawal,  # Дата последнего вывода на карту
        'next_discount_percent': database.get_effective_discount_percent(user),
        'discount_offer_expires_at': user.get('discount_offer_expires_at'),
        'referral_invite_discount_active': invite_discount,
    })


@app.route('/api/user/avatar', methods=['GET'])
def get_user_avatar():
    """Прокси аватара: Telegram CDN → наш API → miniapp (для РФ и др.)."""
    telegram_id = request.args.get('telegram_id', type=int)
    auth_err = enforce_telegram_id_auth(telegram_id)
    if auth_err:
        return auth_err

    avatar = fetch_telegram_user_avatar(telegram_id)
    if not avatar:
        return '', 404

    content, content_type = avatar
    return Response(
        content,
        mimetype=content_type,
        headers={'Cache-Control': 'private, max-age=3600'},
    )


@app.route('/api/payment/create', methods=['POST'])
def create_payment():
    """Создать платеж"""
    data = request.json
    user_id = data.get('user_id')
    amount = data.get('amount')
    method = data.get('method')  # 'heleket', 'platega_sbp', 'platega_card_*', 'cryptopay', 'tg_stars'
    
    if not user_id or not amount or not method:
        return jsonify({'error': 'Missing required fields'}), 400

    # amount — сумма зачисления на баланс и сумма инвойса у провайдера (комиссию накладывает платёжка)
    net_amount = round(float(amount), 2)
    if net_amount <= 0:
        return jsonify({'error': 'Invalid amount'}), 400
    
    user = database.get_user_by_id(user_id)
    if not user:
        return jsonify({'error': 'User not found'}), 404

    auth_err = enforce_user_id_auth(user_id, user)
    if auth_err:
        return auth_err
    
    # Проверка на бан и blacklist
    ban_status = get_user_ban_status(user)
    if ban_status.get('banned'):
        return jsonify({
            'error': ban_status.get('reason', 'Ваш аккаунт заблокирован'),
            'banned': True
        }), 403
    
    return_url = f"{os.getenv('MINIAPP_URL', '')}/success"
    failed_url = f"{os.getenv('MINIAPP_URL', '')}/failed"
    if not failed_url.strip('/'):
        failed_url = return_url  # fallback
    
    try:
        if method == 'heleket':
            # Криптовалюта через Heleket
            payment = heleket.heleket_api.create_payment(net_amount, user_id)
            if payment:
                payment_id = payment.get('uuid') or payment.get('order_id')
                try:
                    conn = database.get_db_connection()
                    cursor = conn.cursor()
                    cursor.execute(
                        """
                        INSERT INTO transactions (user_id, type, amount, status, payment_method, payment_provider, payment_id, description)
                        VALUES (?, 'deposit', ?, 'Pending', 'Crypto', 'Heleket', ?, ?)
                        """,
                        (int(user_id), net_amount, payment_id, "Ожидание оплаты Heleket"),
                    )
                    conn.commit()
                    conn.close()
                except Exception as _e:
                    logger.warning("Heleket: не удалось создать Pending-транзакцию: %s", _e)
                    try: conn.close()
                    except Exception: pass
                return jsonify({
                    'payment_id': payment_id,
                    'payment_url': payment.get('payment_url'),
                    'status': payment.get('status', 'pending'),
                    'payer_amount': payment.get('payer_amount'),
                    'payer_currency': payment.get('payer_currency')
                })
        
        elif method == 'platega_card':
            # Банковская карта через Platega (return_url/failed_url обязательны для редиректа после оплаты)
            payment = platega.platega_api.create_card_payment(
                net_amount, user_id, return_url=return_url, failed_url=failed_url
            )
            if payment:
                try:
                    conn = database.get_db_connection()
                    cursor = conn.cursor()
                    cursor.execute(
                        """
                        INSERT INTO transactions (user_id, type, amount, status, payment_method, payment_provider, payment_id, description)
                        VALUES (?, 'deposit', ?, 'Pending', 'Карта', 'Platega', ?, ?)
                        """,
                        (int(user_id), net_amount, payment.get('id'), "Ожидание оплаты Platega"),
                    )
                    conn.commit()
                    conn.close()
                except Exception as _e:
                    logger.warning("Platega: не удалось создать Pending-транзакцию: %s", _e)
                    try: conn.close()
                    except Exception: pass
                return jsonify({
                    'payment_id': payment.get('id'),
                    'payment_url': payment.get('redirect_url'),
                    'status': payment.get('status', 'pending')
                })

        elif method in ('platega_card_ru', 'platega_ru'):
            # Российские карты: Platega method 11 (карточный эквайринг)
            payment = platega.platega_api.create_payment(
                net_amount,
                int(user_id),
                description="Пополнение баланса (карта РФ)",
                payment_method=platega.PLATEGA_METHOD_CARD_RUB,
                return_url=return_url,
                failed_url=failed_url,
            )
            if payment:
                try:
                    conn = database.get_db_connection()
                    cursor = conn.cursor()
                    cursor.execute(
                        """
                        INSERT INTO transactions (user_id, type, amount, status, payment_method, payment_provider, payment_id, description)
                        VALUES (?, 'deposit', ?, 'Pending', 'Карта', 'Platega', ?, ?)
                        """,
                        (int(user_id), net_amount, payment.get('id'), "Ожидание оплаты Platega (карта РФ)"),
                    )
                    conn.commit()
                    conn.close()
                except Exception as _e:
                    logger.warning("Platega: не удалось создать Pending-транзакцию: %s", _e)
                    try: conn.close()
                    except Exception: pass
                return jsonify({
                    'payment_id': payment.get('id'),
                    'payment_url': payment.get('redirect_url'),
                    'status': payment.get('status', 'pending')
                })

        elif method in ('platega_card_intl', 'platega_intl'):
            # Иностранные карты: Platega method 12 (международный эквайринг)
            payment = platega.platega_api.create_payment(
                net_amount,
                int(user_id),
                description="Пополнение баланса (иностр. карта)",
                payment_method=platega.PLATEGA_METHOD_INTL,
                return_url=return_url,
                failed_url=failed_url,
            )
            if payment:
                try:
                    conn = database.get_db_connection()
                    cursor = conn.cursor()
                    cursor.execute(
                        """
                        INSERT INTO transactions (user_id, type, amount, status, payment_method, payment_provider, payment_id, description)
                        VALUES (?, 'deposit', ?, 'Pending', 'Карта', 'Platega', ?, ?)
                        """,
                        (int(user_id), net_amount, payment.get('id'), "Ожидание оплаты Platega (иностр. карта)"),
                    )
                    conn.commit()
                    conn.close()
                except Exception as _e:
                    logger.warning("Platega: не удалось создать Pending-транзакцию: %s", _e)
                    try: conn.close()
                    except Exception: pass
                return jsonify({
                    'payment_id': payment.get('id'),
                    'payment_url': payment.get('redirect_url'),
                    'status': payment.get('status', 'pending')
                })
        
        elif method in ('platega_sbp', 'rollypay_sbp'):
            # СБП через Platega (rollypay_sbp — legacy id из старых клиентов)
            payment = platega.platega_api.create_sbp_payment(
                net_amount,
                int(user_id),
                description="Пополнение баланса (СБП)",
                return_url=return_url,
                failed_url=failed_url,
            )
            if payment:
                try:
                    conn = database.get_db_connection()
                    cursor = conn.cursor()
                    cursor.execute(
                        """
                        INSERT INTO transactions (user_id, type, amount, status, payment_method, payment_provider, payment_id, description)
                        VALUES (?, 'deposit', ?, 'Pending', 'СБП', 'Platega', ?, ?)
                        """,
                        (int(user_id), net_amount, payment.get('id'), "Ожидание оплаты Platega СБП"),
                    )
                    conn.commit()
                    conn.close()
                except Exception as _e:
                    logger.warning("Platega СБП: не удалось создать Pending-транзакцию: %s", _e)
                    try: conn.close()
                    except Exception: pass
                return jsonify({
                    'payment_id': payment.get('id'),
                    'payment_url': payment.get('redirect_url'),
                    'status': payment.get('status', 'pending'),
                })

        elif method == 'cryptopay' or method == 'cryptobot':
            # CryptoPay (CryptoBot): invoice link
            inv = cryptopay.cryptopay_api.create_invoice(
                user_id=int(user_id),
                amount_rub=net_amount,
                description="Пополнение баланса (криптовалюта)",
            )
            if inv:
                # Create pending tx for webhook/reconcile idempotency.
                try:
                    conn = database.get_db_connection()
                    cursor = conn.cursor()
                    cursor.execute(
                        """
                        INSERT INTO transactions (user_id, type, amount, status, payment_method, payment_provider, payment_id, description)
                        VALUES (?, 'deposit', ?, 'Pending', 'CryptoPay', 'CryptoPay', ?, ?)
                        """,
                        (
                            int(user_id),
                            net_amount,
                            f"cryptopay:{inv.invoice_id}",
                            "Ожидание оплаты CryptoPay",
                        ),
                    )
                    conn.commit()
                    conn.close()
                except Exception:
                    try:
                        conn.close()
                    except Exception:
                        pass
                return jsonify({
                    'payment_id': f"cryptopay:{inv.invoice_id}",
                    'payment_url': inv.pay_url,
                    'status': inv.status,
                    'payload': inv.payload,
                })

        elif method == 'tg_stars' or method == 'telegram_stars':
            # Telegram Stars: create invoice link via Bot API
            bot_token = os.getenv('TELEGRAM_BOT_TOKEN', '')
            if not bot_token:
                return jsonify({'error': 'Telegram bot token is not configured'}), 500
            # 1 ⭐ = 1 ₽ на баланс, в инвойсе — XTR (Telegram Stars)
            stars = int(round(net_amount))
            if stars <= 0:
                return jsonify({'error': 'Invalid amount'}), 400
            import requests
            import time
            import secrets
            payload = f"stars_{user_id}_{int(time.time())}_{secrets.token_hex(3)}"
            invoice = {
                "title": "Пополнение баланса",
                "description": f"Пополнение на {stars} ⭐",
                "payload": payload,
                "provider_token": "",
                "currency": "XTR",
                "prices": [{"label": f"{stars} ⭐", "amount": stars}],
            }
            url = f"https://api.telegram.org/bot{bot_token}/createInvoiceLink"
            r = requests.post(url, json=invoice, timeout=20)
            data = r.json() if r.content else {}
            if not r.ok or not isinstance(data, dict) or not data.get("ok"):
                logger.error("Telegram createInvoiceLink failed: %s", str(data)[:500])
                return jsonify({'error': 'Failed to create invoice'}), 500
            pay_url = data.get("result")
            # create pending transaction for idempotency
            try:
                conn = database.get_db_connection()
                cursor = conn.cursor()
                cursor.execute(
                    """
                    INSERT INTO transactions (user_id, type, amount, status, payment_method, payment_provider, payment_id, description)
                    VALUES (?, 'deposit', ?, 'Pending', 'Telegram Stars', 'Telegram', ?, ?)
                    """,
                    (int(user_id), float(stars), payload, "Ожидание оплаты Telegram Stars"),
                )
                conn.commit()
                conn.close()
            except Exception:
                # If duplicate payload (shouldn't happen), it's fine
                try:
                    conn.close()
                except Exception:
                    pass
            return jsonify({
                'payment_id': payload,
                'payment_url': pay_url,
                'status': 'pending',
                'payload': payload,
            })
        
        else:
            return jsonify({'error': f'Unknown payment method: {method}'}), 400
        
    except Exception as e:
        logger.error(f"Payment creation error for method {method}: {e}")
    
    return jsonify({'error': 'Payment creation failed'}), 500


def _payment_status_response(user_id: int, payment_id: str | None, baseline_balance: float):
    completed = payment_wait.is_payment_completed(
        user_id, payment_id or None, baseline_balance
    )
    user = database.get_user_by_id(int(user_id))
    balance = float(user.get('balance') or 0) if user else 0.0
    return {
        'completed': completed,
        'balance': balance,
    }


@app.route('/api/payment/status', methods=['GET'])
def payment_status():
    """Проверить, зачислен ли платёж (после webhook или reconcile)."""
    user_id = request.args.get('user_id', type=int)
    payment_id = (request.args.get('payment_id') or '').strip() or None
    baseline_balance = request.args.get('baseline_balance', type=float, default=0.0)

    if not user_id:
        return jsonify({'error': 'user_id required'}), 400

    user = database.get_user_by_id(user_id)
    auth_err = enforce_user_id_auth(user_id, user)
    if auth_err:
        return auth_err

    return jsonify(_payment_status_response(user_id, payment_id, baseline_balance))


@app.route('/api/payment/wait', methods=['GET'])
def payment_wait_long_poll():
    """
    Long-poll: ждёт webhook-уведомление или проверяет БД до timeout секунд.
    Miniapp вызывает в цикле для мгновенного UX после оплаты.
    """
    user_id = request.args.get('user_id', type=int)
    payment_id = (request.args.get('payment_id') or '').strip() or None
    baseline_balance = request.args.get('baseline_balance', type=float, default=0.0)
    timeout = request.args.get('timeout', type=int, default=55)
    timeout = max(1, min(int(timeout or 55), 90))

    if not user_id:
        return jsonify({'error': 'user_id required'}), 400

    user = database.get_user_by_id(user_id)
    auth_err = enforce_user_id_auth(user_id, user)
    if auth_err:
        return auth_err

    def _check() -> bool:
        return payment_wait.is_payment_completed(
            user_id, payment_id, baseline_balance
        )

    if not _check():
        payment_wait.wait_for_user_payment(user_id, float(timeout), _check)

    return jsonify(_payment_status_response(user_id, payment_id, baseline_balance))


@app.route('/api/internal/payment-completed', methods=['POST'])
def internal_payment_completed():
    """Вызов из webhook-контейнера после зачисления (INTERNAL_API_SECRET)."""
    secret = (os.getenv('INTERNAL_API_SECRET') or '').strip()
    if not secret:
        return jsonify({'error': 'Not configured'}), 404
    got = (request.headers.get('X-Internal-Secret') or '').strip()
    if not got or not hmac.compare_digest(got, secret):
        return jsonify({'error': 'Forbidden'}), 403
    data = request.json if request.is_json else {}
    user_id = data.get('user_id')
    if not user_id:
        return jsonify({'error': 'user_id required'}), 400
    payment_wait.wake_payment_waiters(int(user_id))
    return jsonify({'ok': True})


@app.route('/api/promocode/apply', methods=['POST'])
def apply_promocode():
    """Применить промокод"""
    data = request.json
    user_id = data.get('user_id')
    code = data.get('code')
    
    if not user_id or not code:
        return jsonify({'error': 'Missing required fields'}), 400

    auth_err = enforce_user_id_auth(user_id)
    if auth_err:
        return auth_err
    
    result = core.apply_promocode(user_id, code)
    return jsonify(result)

@app.route('/api/user/devices', methods=['GET'])
def get_user_devices():
    """Получить список устройств пользователя"""
    telegram_id = request.args.get('telegram_id', type=int)
    auth_err = enforce_telegram_id_auth(telegram_id)
    if auth_err:
        return auth_err
    
    user = database.get_user_by_telegram_id(telegram_id)
    if not user:
        return jsonify({'error': 'User not found'}), 404
    
    # Синхронизируем traffic_used и expiry_date из Remnawave (источник истины для даты окончания)
    remnawave_expiry = {}  # key_uuid -> expire_at (datetime)
    try:
        rw_users = remnawave.remnawave_api.get_user_by_telegram_id(telegram_id)
        if rw_users:
            conn_sync = database.get_db_connection()
            cursor_sync = conn_sync.cursor()
            for rw_user in rw_users:
                rw_uuid = rw_user.uuid if hasattr(rw_user, 'uuid') else rw_user.get('uuid')
                # Трафик
                traffic_used = 0
                if hasattr(rw_user, 'user_traffic') and rw_user.user_traffic:
                    traffic_used = rw_user.user_traffic.used_traffic_bytes
                elif hasattr(rw_user, 'used_traffic_bytes'):
                    traffic_used = rw_user.used_traffic_bytes
                if rw_uuid and traffic_used > 0:
                    cursor_sync.execute("""
                        UPDATE vpn_keys SET traffic_used = ? WHERE key_uuid = ?
                    """, (traffic_used, rw_uuid))
                # Дата окончания из Remnawave — главный источник
                expire_at = getattr(rw_user, 'expire_at', None) or (rw_user.get('expireAt') if isinstance(rw_user, dict) else None)
                if rw_uuid and expire_at:
                    if isinstance(expire_at, str):
                        from datetime import datetime
                        expire_at = datetime.fromisoformat(expire_at.replace('Z', '+00:00').replace('+00:00', ''))
                    remnawave_expiry[rw_uuid] = expire_at
                    cursor_sync.execute("""
                        UPDATE vpn_keys SET expiry_date = ? WHERE key_uuid = ?
                    """, (expire_at.isoformat() if hasattr(expire_at, 'isoformat') else expire_at, rw_uuid))
            conn_sync.commit()
            conn_sync.close()
    except Exception as e:
        logger.warning(f"Failed to sync traffic/expiry from Remnawave: {e}")
    
    conn = database.get_db_connection()
    cursor = conn.cursor()
    
    try:
        cursor.execute("""
            SELECT id, key_config, key_uuid, status as key_status, expiry_date,
                   traffic_used, traffic_limit, plan_type, created_at, custom_name
            FROM vpn_keys
            WHERE user_id = ? AND key_uuid IS NOT NULL AND status != 'Deleted'
            ORDER BY created_at DESC
        """, (user['id'],))
        
        rows = cursor.fetchall()
        devices = []
        for row in rows:
            from datetime import datetime
            created_at = row['created_at']
            if created_at:
                try:
                    if isinstance(created_at, str):
                        dt = datetime.fromisoformat(created_at.replace('Z', '+00:00'))
                    else:
                        dt = created_at
                    added_formatted = dt.strftime('%d.%m.%Y')
                except:
                    added_formatted = str(created_at)[:10]
            else:
                added_formatted = datetime.now().strftime('%d.%m.%Y')
            
            # Дата окончания: приоритет у Remnawave (источник истины), иначе из БД
            expiry_dt_src = remnawave_expiry.get(row['key_uuid']) if row['key_uuid'] else None
            if expiry_dt_src is None and row['expiry_date']:
                try:
                    if isinstance(row['expiry_date'], str):
                        expiry_dt_src = datetime.fromisoformat(row['expiry_date'].replace('Z', '+00:00'))
                    else:
                        expiry_dt_src = row['expiry_date']
                except Exception:
                    expiry_dt_src = None
            if isinstance(expiry_dt_src, str):
                try:
                    expiry_dt_src = datetime.fromisoformat(expiry_dt_src.replace('Z', '+00:00'))
                except Exception:
                    expiry_dt_src = None

            days_left = None
            hours_left = None
            is_expired = False
            expiry_date_str = None
            if expiry_dt_src:
                try:
                    expiry_dt = expiry_dt_src
                    if hasattr(expiry_dt, 'tzinfo') and expiry_dt.tzinfo:
                        expiry_dt = expiry_dt.replace(tzinfo=None) - timedelta(seconds=expiry_dt.utcoffset().total_seconds() if expiry_dt.utcoffset() else 0)
                    # Сравнение в UTC (expiry в БД/Remnawave хранится как UTC)
                    now_utc = datetime.utcnow()
                    diff = expiry_dt - now_utc
                    total_seconds = diff.total_seconds()
                    
                    if total_seconds <= 0:
                        is_expired = True
                        days_left = 0
                        hours_left = 0
                    else:
                        # Округляем вверх - если осталось хотя бы 1 секунда, это ещё не истекло
                        import math
                        total_hours = total_seconds / 3600
                        days_left = int(total_hours / 24)
                        hours_left = int(math.ceil(total_hours % 24))
                        # Если меньше 1 дня, но есть часы - показываем 0 дней
                        if days_left == 0 and hours_left > 0:
                            days_left = 0  # Покажем часы
                    
                    expiry_date_str = format_datetime_msk(expiry_dt)
                except Exception as e:
                    logger.error(f"Error parsing expiry_date: {e}")
            
            # Короткий UUID для отображения (первые 8 символов)
            short_uuid = row['key_uuid'][:8] if row['key_uuid'] else None
            
            # Определяем тип устройства по plan_type
            plan_type = row['plan_type'] or 'vpn'
            default_name = 'Подписка'
            
            # Используем custom_name если есть, иначе default
            custom_name = row['custom_name'] if 'custom_name' in row.keys() else None
            device_name = custom_name if custom_name else default_name
            
            devices.append({
                'id': row['id'],
                'name': device_name,
                'type': 'universal',
                'added': added_formatted,
                'key_config': row['key_config'],
                'key_uuid': row['key_uuid'],
                'short_uuid': short_uuid,
                'key_status': row['key_status'],
                'days_left': days_left,
                'hours_left': hours_left,
                'is_expired': is_expired,
                'expiry_date': expiry_date_str,
                'traffic_used': row['traffic_used'],
                'traffic_limit': row['traffic_limit'],
                'plan_type': plan_type
            })
        
        return jsonify(devices)
    finally:
        conn.close()

@app.route('/api/user/history', methods=['GET'])
def get_user_history():
    """Получить историю транзакций пользователя"""
    telegram_id = request.args.get('telegram_id', type=int)
    auth_err = enforce_telegram_id_auth(telegram_id)
    if auth_err:
        return auth_err
    
    user = database.get_user_by_telegram_id(telegram_id)
    if not user:
        return jsonify({'error': 'User not found'}), 404
    
    conn = database.get_db_connection()
    cursor = conn.cursor()
    
    try:
        cursor.execute("""
            SELECT id, type, amount, description, created_at, status, payment_method
            FROM transactions
            WHERE user_id = ?
              AND type IN (
                  'deposit', 'withdrawal', 'withdrawal_request',
                  'subscription', 'subscription_extend', 'device_purchase'
              )
            ORDER BY created_at DESC
            LIMIT 100
        """, (user['id'],))
        
        rows = cursor.fetchall()
        history = []
        for row in rows:
            raw_type = row['type']
            type_map = {
                'deposit': 'deposit',
                'withdrawal': 'withdrawal',
                'withdrawal_request': 'withdrawal',
                'subscription': 'sub_off',
                'subscription_extend': 'sub_off',
                'device_purchase': 'buy_dev',
            }
            title_map = {
                'deposit': f'Пополнение баланса ({row["payment_method"] or "баланс"})'.strip(),
                'withdrawal': 'Вывод средств',
                'withdrawal_request': 'Вывод средств',
                'subscription': 'Списание за подписку',
                'subscription_extend': 'Продление подписки',
                'device_purchase': 'Покупка устройства',
            }
            trans_type = type_map.get(raw_type, raw_type)
            title = title_map.get(raw_type) or row['description'] or raw_type
            
            # Форматирование даты
            from datetime import datetime
            date_str = row['created_at']
            if date_str:
                try:
                    if isinstance(date_str, str):
                        dt = datetime.fromisoformat(date_str.replace('Z', '+00:00'))
                    else:
                        dt = date_str
                    # Месяцы на русском
                    months = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек']
                    month_idx = dt.month - 1
                    date_formatted = f"{dt.day} {months[month_idx]} {dt.year}"
                except:
                    date_formatted = str(date_str)[:10]
            else:
                date_formatted = datetime.now().strftime('%d %b %Y')
            
            history.append({
                'id': row['id'],
                'type': trans_type,
                'title': title,
                'amount': float(row['amount']),
                'date': date_formatted
            })
        
        return jsonify(history)
    finally:
        conn.close()

@app.route('/api/user/payment-methods', methods=['GET'])
def get_user_payment_methods():
    """Получить сохраненные способы оплаты пользователя"""
    telegram_id = request.args.get('telegram_id', type=int)
    auth_err = enforce_telegram_id_auth(telegram_id)
    if auth_err:
        return auth_err
    
    user = database.get_user_by_telegram_id(telegram_id)
    if not user:
        return jsonify({'error': 'User not found'}), 404
    
    conn = database.get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("""
            SELECT id, payment_provider, payment_method_id, payment_method_type, 
                   card_last4, card_brand, created_at
            FROM saved_payment_methods
            WHERE user_id = ? AND is_active = 1
            ORDER BY created_at DESC
        """, (user['id'],))
        rows = cursor.fetchall()
        methods = []
        for row in rows:
            methods.append({
                'id': row['id'],
                'provider': row['payment_provider'],
                'payment_method_id': row['payment_method_id'],
                'type': row['payment_method_type'],
                'card_last4': row['card_last4'],
                'card_brand': row['card_brand'],
                'created_at': row['created_at']
            })
        return jsonify(methods)
    finally:
        conn.close()

@app.route('/api/user/payment-methods/<int:method_id>', methods=['DELETE'])
def delete_payment_method(method_id: int):
    """Удалить сохраненный способ оплаты"""
    telegram_id = request.args.get('telegram_id', type=int)
    auth_err = enforce_telegram_id_auth(telegram_id)
    if auth_err:
        return auth_err
    
    user = database.get_user_by_telegram_id(telegram_id)
    if not user:
        return jsonify({'error': 'User not found'}), 404
    
    conn = database.get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("""
            UPDATE saved_payment_methods
            SET is_active = 0
            WHERE id = ? AND user_id = ?
        """, (method_id, user['id']))
        conn.commit()
        return jsonify({'success': True})
    finally:
        conn.close()

@app.route('/api/user/devices/<int:device_id>', methods=['DELETE'])
def delete_user_device(device_id: int):
    """Удалить устройство пользователя и ключ из Remnawave"""
    telegram_id = request.args.get('telegram_id', type=int)
    auth_err = enforce_telegram_id_auth(telegram_id)
    if auth_err:
        return auth_err
    
    user = database.get_user_by_telegram_id(telegram_id)
    if not user:
        return jsonify({'error': 'User not found'}), 404
    
    conn = database.get_db_connection()
    cursor = conn.cursor()
    try:
        # Проверяем, что устройство принадлежит пользователю
        cursor.execute("""
            SELECT id, key_uuid FROM vpn_keys
            WHERE id = ? AND user_id = ?
        """, (device_id, user['id']))
        device = cursor.fetchone()
        
        if not device:
            return jsonify({'error': 'Device not found'}), 404
        
        key_uuid = device['key_uuid']
        
        # Удаляем из Remnawave если есть UUID
        if key_uuid:
            try:
                remnawave.remnawave_api.delete_user_sync(key_uuid)
                logger.info(f"Deleted key {key_uuid} from Remnawave")
            except Exception as e:
                logger.error(f"Failed to delete key {key_uuid} from Remnawave: {e}")
        
        # Удаляем устройство/ключ (теперь это одна запись)
        cursor.execute("DELETE FROM vpn_keys WHERE id = ?", (device_id,))
        
        conn.commit()
        logger.info(f"Device {device_id} deleted for user {telegram_id}")
        return jsonify({'success': True})
    except Exception as e:
        conn.rollback()
        logger.error(f"Error deleting device {device_id}: {e}")
        return jsonify({'error': str(e)}), 500
    finally:
        conn.close()


@app.route('/api/user/devices/<int:device_id>/hwid', methods=['GET'])
def get_device_hwid_devices(device_id: int):
    """Получить HWID-устройства для подписки через Remnawave"""
    telegram_id = request.args.get('telegram_id', type=int)
    auth_err = enforce_telegram_id_auth(telegram_id)
    if auth_err:
        return auth_err

    user = database.get_user_by_telegram_id(telegram_id)
    if not user:
        return jsonify({'error': 'User not found'}), 404

    conn = database.get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("""
            SELECT id, key_uuid FROM vpn_keys
            WHERE id = ? AND user_id = ?
        """, (device_id, user['id']))
        device = cursor.fetchone()
        if not device:
            return jsonify({'error': 'Device not found'}), 404

        key_uuid = device['key_uuid']
        if not key_uuid:
            return jsonify({'hwid_devices': []})

        hwid_devices = remnawave.remnawave_api.get_hwid_devices_sync(key_uuid)
        return jsonify({'hwid_devices': hwid_devices or []})
    except Exception as e:
        logger.error(f"Error fetching HWID devices for device {device_id}: {e}")
        return jsonify({'error': str(e)}), 500
    finally:
        conn.close()


@app.route('/api/user/devices/<int:device_id>/hwid/<hwid_id>', methods=['DELETE'])
def delete_device_hwid(device_id: int, hwid_id: str):
    """Удалить конкретное HWID-устройство"""
    telegram_id = request.args.get('telegram_id', type=int)
    auth_err = enforce_telegram_id_auth(telegram_id)
    if auth_err:
        return auth_err

    user = database.get_user_by_telegram_id(telegram_id)
    if not user:
        return jsonify({'error': 'User not found'}), 404

    conn = database.get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("""
            SELECT id, key_uuid FROM vpn_keys
            WHERE id = ? AND user_id = ?
        """, (device_id, user['id']))
        device = cursor.fetchone()
        if not device:
            return jsonify({'error': 'Device not found'}), 404

        key_uuid = device['key_uuid']
        if not key_uuid:
            return jsonify({'error': 'No key UUID for this device'}), 400

        async def _delete_hwid():
            api = remnawave.get_remnawave_api()
            async with api as rw:
                return await rw.delete_hwid_devices([hwid_id])

        import asyncio
        result = asyncio.run(_delete_hwid())
        return jsonify({'success': bool(result)})
    except Exception as e:
        logger.error(f"Error deleting HWID device {hwid_id}: {e}")
        return jsonify({'error': str(e)}), 500
    finally:
        conn.close()


@app.route('/api/user/devices/<int:device_id>/reset-key', methods=['POST'])
def reset_device_key(device_id: int):
    """Сбросить ключ подписки (revoke subscription URL) через Remnawave"""
    telegram_id = request.args.get('telegram_id', type=int)
    auth_err = enforce_telegram_id_auth(telegram_id)
    if auth_err:
        return auth_err

    user = database.get_user_by_telegram_id(telegram_id)
    if not user:
        return jsonify({'error': 'User not found'}), 404

    conn = database.get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("""
            SELECT id, key_uuid, key_config FROM vpn_keys
            WHERE id = ? AND user_id = ?
        """, (device_id, user['id']))
        device = cursor.fetchone()
        if not device:
            return jsonify({'error': 'Device not found'}), 404

        key_uuid = device['key_uuid']
        if not key_uuid:
            return jsonify({'error': 'No key UUID for this device'}), 400

        # Revoke subscription URL через Remnawave API
        async def _revoke():
            api = remnawave.get_remnawave_api()
            async with api as rw:
                return await rw._make_request('POST', f'/api/users/{key_uuid}/revoke-subscription')

        import asyncio
        revoke_result = asyncio.run(_revoke())

        # Получаем обновлённые данные пользователя из Remnawave
        async def _get_user():
            api = remnawave.get_remnawave_api()
            async with api as rw:
                resp = await rw._make_request('GET', f'/api/users/{key_uuid}')
                return resp.get('response') if isinstance(resp, dict) else None

        rw_user = asyncio.run(_get_user())

        new_subscription_url = ''
        if rw_user:
            new_subscription_url = (
                rw_user.get('subscriptionUrl', '') or rw_user.get('subscription_url', '')
            )

        # Обновляем ключ в базе данных
        if new_subscription_url:
            cursor.execute(
                "UPDATE vpn_keys SET key_config = ? WHERE id = ?",
                (new_subscription_url, device_id)
            )
            conn.commit()

        logger.info(f"Reset key for device {device_id}, new url: {new_subscription_url[:40] if new_subscription_url else 'N/A'}")
        return jsonify({
            'success': True,
            'subscription_url': new_subscription_url,
            'key_config': new_subscription_url
        })
    except Exception as e:
        conn.rollback()
        logger.error(f"Error resetting key for device {device_id}: {e}")
        return jsonify({'error': str(e)}), 500
    finally:
        conn.close()


@app.route('/api/user/devices/<int:device_id>/name', methods=['PUT', 'POST'])
def update_device_name(device_id: int):
    """Обновить имя устройства/ключа"""
    telegram_id = request.args.get('telegram_id', type=int)
    auth_err = enforce_telegram_id_auth(telegram_id)
    if auth_err:
        return auth_err
    
    data = request.json or {}
    new_name = data.get('name', '').strip()
    
    if not new_name:
        return jsonify({'error': 'Name is required'}), 400
    
    # Ограничиваем длину имени
    if len(new_name) > 50:
        new_name = new_name[:50]
    
    user = database.get_user_by_telegram_id(telegram_id)
    if not user:
        return jsonify({'error': 'User not found'}), 404
    
    conn = database.get_db_connection()
    cursor = conn.cursor()
    try:
        # Проверяем, что устройство принадлежит пользователю
        cursor.execute("""
            SELECT id FROM vpn_keys
            WHERE id = ? AND user_id = ?
        """, (device_id, user['id']))
        device = cursor.fetchone()
        
        if not device:
            return jsonify({'error': 'Device not found'}), 404
        
        # Обновляем имя
        cursor.execute("UPDATE vpn_keys SET custom_name = ? WHERE id = ?", (new_name, device_id))
        conn.commit()
        
        logger.info(f"Device {device_id} renamed to '{new_name}' for user {telegram_id}")
        return jsonify({'success': True, 'name': new_name})
    except Exception as e:
        conn.rollback()
        logger.error(f"Error renaming device {device_id}: {e}")
        return jsonify({'error': str(e)}), 500
    finally:
        conn.close()


@app.route('/api/subscription/extend', methods=['POST'])
def extend_subscription():
    """Продлить существующую подписку (не создавать новый ключ)"""
    data = request.json
    user_id = data.get('user_id')
    key_id = data.get('key_id')  # ID существующего ключа для продления
    days = data.get('days')
    
    if not user_id or not key_id or not days:
        return jsonify({'error': 'Missing required fields'}), 400
    
    user = database.get_user_by_id(user_id)
    if not user:
        return jsonify({'error': 'User not found'}), 404

    auth_err = enforce_user_id_auth(user_id, user)
    if auth_err:
        return auth_err
    
    # Проверка на бан и blacklist
    ban_status = get_user_ban_status(user)
    if ban_status.get('banned'):
        return jsonify({
            'error': ban_status.get('reason', 'Ваш аккаунт заблокирован'),
            'banned': True
        }), 403
    
    # Получаем существующий ключ
    conn = database.get_db_connection()
    cursor = conn.cursor()
    
    try:
        cursor.execute("""
            SELECT id, key_uuid, expiry_date, plan_type, traffic_limit, traffic_used, status, devices_limit
            FROM vpn_keys WHERE id = ? AND user_id = ?
        """, (key_id, user_id))
        key_row = cursor.fetchone()
        
        if not key_row:
            return jsonify({'error': 'Key not found'}), 404
        
        key_uuid = key_row['key_uuid']
        current_expiry = key_row['expiry_date']
        plan_type = key_row['plan_type'] or 'vpn'
        current_traffic_limit = float(key_row['traffic_limit'] or 0)
        current_traffic_used = float(key_row['traffic_used'] or 0)
        cur_dev = int(key_row['devices_limit'] or 1)

        devices_in = data.get('devices')
        if devices_in is not None:
            try:
                req = int(devices_in)
            except (TypeError, ValueError):
                return jsonify({'error': 'Некорректное число устройств'}), 400
            req = max(2, min(20, req))
            if req < cur_dev:
                return jsonify({'error': 'Нельзя уменьшить количество устройств при продлении'}), 400
            new_dev = req
        else:
            new_dev = cur_dev
        
        # Apply one-time discount from promocode
        discount = database.get_effective_discount_percent(user)

        server_price = database.compute_vpn_subscription_price(int(days), int(new_dev))
        if server_price is None:
            return jsonify({'error': 'Некорректный срок подписки'}), 400
        price = float(server_price)

        if user.get('referred_by') and not database.user_has_paid_subscription_purchase(int(user_id)):
            price = round(price * 0.9, 2)

        if discount > 0 and price and float(price) > 0:
            try:
                price = round(float(price) * (100 - discount) / 100, 2)
            except Exception:
                pass

        # Списываем баланс
        if price > 0:
            deducted = database.update_user_balance(user_id, -price, ensure_non_negative=True)
            if not deducted:
                return jsonify({'error': 'Insufficient balance'}), 400
            # Discount consumed on purchase
            if discount > 0:
                try:
                    conn_d = database.get_db_connection()
                    cur_d = conn_d.cursor()
                    cur_d.execute("UPDATE users SET next_discount_percent = 0 WHERE id = ?", (user_id,))
                    conn_d.commit()
                    conn_d.close()
                except Exception:
                    try:
                        conn_d.close()
                    except Exception:
                        pass
        
        # Рассчитываем новую дату истечения
        from datetime import datetime, timedelta
        
        # Если ключ истёк, продлеваем от текущей даты
        # Если активен - добавляем к существующей дате
        if current_expiry:
            try:
                expiry_dt = datetime.fromisoformat(current_expiry.replace('Z', '+00:00').replace('+00:00', ''))
            except:
                expiry_dt = datetime.now()
            
            if expiry_dt < datetime.now():
                # Ключ истёк - продлеваем от сейчас
                new_expiry = datetime.now() + timedelta(days=days)
            else:
                # Ключ ещё активен - добавляем дни
                new_expiry = expiry_dt + timedelta(days=days)
        else:
            new_expiry = datetime.now() + timedelta(days=days)
        
        new_expiry_str = new_expiry.isoformat()
        
        # Если продлеваем после триала/лимитной подписки — снимаем лимит и сбрасываем локальный учёт
        needs_unlimit = (plan_type == 'trial') or (current_traffic_limit > 0 and current_traffic_limit <= int(15 * (1024 ** 3)))

        new_traffic_limit = float(current_traffic_limit)
        new_traffic_used = float(current_traffic_used)
        if needs_unlimit:
            new_traffic_limit = 0.0
            new_traffic_used = 0.0
        elif new_dev > cur_dev:
            base_tb = int(1024 ** 4)
            extra = max(0, new_dev - 1) * int(200 * (1024 ** 3))
            new_traffic_limit = float(base_tb + extra)

        # Обновляем ключ в Remnawave
        if key_uuid:
            try:
                update_kwargs = {
                    "uuid": key_uuid,
                    "expire_at": new_expiry,
                    "status": remnawave.UserStatus.ACTIVE,
                    "hwid_device_limit": int(new_dev),
                }
                if needs_unlimit:
                    update_kwargs["traffic_limit_bytes"] = 0
                    update_kwargs["traffic_limit_strategy"] = remnawave.TrafficLimitStrategy.NO_RESET
                elif new_dev > cur_dev:
                    update_kwargs["traffic_limit_bytes"] = int(new_traffic_limit)
                remnawave.remnawave_api.update_user_sync(**update_kwargs)
            except Exception as e:
                logger.error(f"Failed to update key in Remnawave: {e}")
                # Возвращаем баланс если не удалось обновить
                if price > 0:
                    database.update_user_balance(user_id, price)
                return jsonify({'error': 'Failed to extend subscription in VPN system'}), 500
        
        # Обновляем ключ в БД
        new_plan_type = 'vpn' if needs_unlimit else plan_type
        cursor.execute("""
            UPDATE vpn_keys SET 
                status = 'Active',
                expiry_date = ?,
                plan_type = ?,
                traffic_limit = ?,
                traffic_used = ?,
                devices_limit = ?
            WHERE id = ?
        """, (new_expiry_str, new_plan_type, new_traffic_limit, new_traffic_used, int(new_dev), key_id))
        conn.commit()
        
        # Создаем транзакцию
        description = f"Продление подписки ({days} дней)"
        cursor.execute("""
            INSERT INTO transactions (user_id, type, amount, status, description, payment_method)
            VALUES (?, 'subscription_extend', ?, 'Success', ?, 'Balance')
        """, (user_id, -price, description))
        conn.commit()
        
        # Начисляем доход рефереру
        if price > 0:
            referral_result = database.credit_referral_income(
                user_id, price, f"Продление подписки ({description})"
            )
            if referral_result:
                logger.info(
                    "Referral credited for extension: L1=%s₽ L2=%s",
                    referral_result.get('income'),
                    (referral_result.get('second_line') or {}).get('income'),
                )
                notify_referral_income_credited(referral_result, extended=True)
        
        return jsonify({
            'success': True,
            'key_id': key_id,
            'new_expiry': new_expiry_str,
            'devices_limit': int(new_dev),
        })
        
    except Exception as e:
        logger.error(f"Error extending subscription: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500
    finally:
        conn.close()


@app.route('/api/subscription/create', methods=['POST'])
def create_subscription():
    """Создать единую подписку (VPN + обход блокировок)"""
    data = request.json
    user_id = data.get('user_id')
    days = data.get('days')
    is_trial = data.get('is_trial', False)  # Пробный период
    requested_devices = int(data.get('devices', 2) or 2)
    
    if not user_id or not days:
        return jsonify({'error': 'Missing required fields'}), 400
    
    user = database.get_user_by_id(user_id)
    if not user:
        return jsonify({'error': 'User not found'}), 404

    auth_err = enforce_user_id_auth(user_id, user)
    if auth_err:
        return auth_err
    
    # Проверка на бан и blacklist
    ban_status = get_user_ban_status(user)
    if ban_status.get('banned'):
        return jsonify({
            'error': ban_status.get('reason', 'Ваш аккаунт заблокирован'),
            'banned': True
        }), 403
    
    # Проверка пробного периода
    if is_trial:
        if user.get('trial_used', 0) == 1:
            return jsonify({'error': 'Пробный период уже использован'}), 400
        days = 3
        price = 0
        requested_devices = 2
    else:
        requested_devices = max(2, min(20, requested_devices))
        # Apply one-time discount from promocode
        discount = database.get_effective_discount_percent(user)

        server_price = database.compute_vpn_subscription_price(int(days), requested_devices)
        if server_price is None:
            return jsonify({'error': 'Некорректный срок подписки'}), 400
        price = float(server_price)

        if user.get('referred_by') and not database.user_has_paid_subscription_purchase(int(user_id)):
            price = round(price * 0.9, 2)

        if discount > 0:
            try:
                price = round(float(price) * (100 - discount) / 100, 2)
            except Exception:
                pass
    
    # Для пробного периода не списываем баланс
    if not is_trial:
        deducted = database.update_user_balance(user_id, -price, ensure_non_negative=True)
        if not deducted:
            return jsonify({'error': 'Insufficient balance'}), 400
        # Discount consumed on purchase
        try:
            conn_d = database.get_db_connection()
            cur_d = conn_d.cursor()
            cur_d.execute("UPDATE users SET next_discount_percent = 0 WHERE id = ?", (user_id,))
            conn_d.commit()
            conn_d.close()
        except Exception:
            try:
                conn_d.close()
            except Exception:
                pass
    
    # Создаем подписку (единая - безлимитный трафик)
    if is_trial:
        # Пробный период - 10 ГБ трафика
        traffic_limit_bytes = int(10 * (1024 ** 3))
        plan_type = 'trial'
    else:
        # Единая подписка: 1 ТБ + 200 ГБ за каждое доп. устройство
        base = int(1024 ** 4)  # 1 TB
        extra = max(0, int(requested_devices) - 1) * int(200 * (1024 ** 3))
        traffic_limit_bytes = base + extra
        plan_type = 'vpn'
    
    result = core.create_user_and_subscription(
        user['telegram_id'], user.get('username', ''), days,
        traffic_limit=traffic_limit_bytes,
        plan_type=plan_type,
        devices_limit=requested_devices
    )
    
    if result:
        conn = database.get_db_connection()
        cursor = conn.cursor()
        
        if is_trial:
            # Помечаем пробный период как использованный
            cursor.execute("UPDATE users SET trial_used = 1 WHERE id = ?", (user_id,))
            description = "Активация пробного периода (3 дня)"
            trans_type = 'trial'
        else:
            description = f"Подписка ({days} дней)"
            trans_type = 'subscription'
        
        # Создаем транзакцию
        cursor.execute("""
            INSERT INTO transactions (user_id, type, amount, status, description, payment_method)
            VALUES (?, ?, ?, 'Success', ?, 'Balance')
        """, (user_id, trans_type, -price, description))
        conn.commit()
        conn.close()
        
        # Начисляем доход рефереру (если есть) - только для платных подписок
        if not is_trial and price > 0:
            referral_result = database.credit_referral_income(
                user_id, price, f"Покупка подписки ({description})"
            )
            if referral_result:
                logger.info(
                    "Referral credited for purchase: L1=%s₽ L2=%s tg=%s",
                    referral_result.get('income'),
                    (referral_result.get('second_line') or {}).get('income'),
                    referral_result.get('referrer_telegram_id'),
                )
                notify_referral_income_credited(referral_result, extended=False)
        
        return jsonify({'success': True, 'subscription': result})
    
    # Откат баланса, если создание не удалось (только для не-триала)
    if not is_trial:
        database.update_user_balance(user_id, price)
    return jsonify({'error': 'Failed to create subscription'}), 500

# ========== API для панели ==========

@app.route('/api/panel/users', methods=['GET'])
@require_auth
def get_users():
    """Получить список пользователей с информацией о черном списке"""
    limit = request.args.get('limit', 100, type=int)
    offset = request.args.get('offset', 0, type=int)
    search = (request.args.get('search') or request.args.get('q') or '').strip() or None
    status = request.args.get('status')
    if status in ('', 'all'):
        status = None

    total = database.count_panel_users(search, status)
    raw_users = database.list_panel_users(search, status, limit, offset)

    # Получаем telegram_id всех пользователей из черного списка
    conn = database.get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT telegram_id FROM blacklist")
    blacklisted_ids = set(row['telegram_id'] for row in cursor.fetchall())
    conn.close()

    # Добавляем статус черного списка к каждому пользователю
    for user in raw_users:
        user['in_blacklist'] = user.get('telegram_id') in blacklisted_ids

    return jsonify({'items': raw_users, 'total': total})


@app.route('/api/panel/users/<int:user_id>', methods=['GET'])
@require_auth
def get_user_by_id_panel(user_id: int):
    """Получить пользователя по ID для панели"""
    user = database.get_user_by_id(user_id)
    if not user:
        return jsonify({'error': 'User not found'}), 404
    conn = database.get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("SELECT 1 FROM blacklist WHERE telegram_id = ?", (user.get('telegram_id'),))
        user['in_blacklist'] = cursor.fetchone() is not None
    finally:
        conn.close()
    return jsonify(user)

@app.route('/api/panel/promocodes', methods=['GET'])
@require_auth
def get_promocodes():
    """Получить список промокодов"""
    conn = database.get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM promocodes ORDER BY id DESC")
    promos = [dict(row) for row in cursor.fetchall()]
    conn.close()
    return jsonify(promos)

@app.route('/api/panel/promocodes', methods=['POST'])
@require_auth
def create_promocode():
    """Создать промокод"""
    data = request.json
    conn = database.get_db_connection()
    cursor = conn.cursor()

    cursor.execute(
        """
        INSERT INTO promocodes (code, type, value, uses_limit, expires_at, is_active, target_type)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        """,
        (
            data.get('code', '').upper(),
            data.get('type'),
            str(data.get('value')),
            data.get('uses_limit'),
            data.get('expires_at'),
            1 if data.get('is_active', 1) else 0,
            data.get('target_type', 'all'),  # all, vpn, whitelist
        ),
    )

    conn.commit()
    promo_id = cursor.lastrowid

    cursor.execute("SELECT * FROM promocodes WHERE id = ?", (promo_id,))
    promo = dict(cursor.fetchone())

    conn.close()

    return jsonify({'id': promo_id, 'success': True, 'promocode': promo})


@app.route('/api/panel/promocodes/<int:promo_id>', methods=['PUT'])
@require_auth
def update_promocode(promo_id: int):
    """Обновить промокод"""
    data = request.json or {}
    conn = database.get_db_connection()
    cursor = conn.cursor()

    # Собираем поля для обновления динамически
    fields = []
    values = []

    mapping = {
        'code': 'code',
        'type': 'type',
        'value': 'value',
        'uses_limit': 'uses_limit',
        'expires_at': 'expires_at',
        'is_active': 'is_active',
        'target_type': 'target_type',  # all, vpn, whitelist
    }

    for key, column in mapping.items():
        if key in data:
            val = data[key]
            if key == 'code' and isinstance(val, str):
                val = val.upper()
            if key == 'is_active':
                val = 1 if val else 0
            fields.append(f"{column} = ?")
            values.append(val)

    if not fields:
        conn.close()
        return jsonify({'success': False, 'error': 'Nothing to update'}), 400

    values.append(promo_id)

    cursor.execute(
        f"UPDATE promocodes SET {', '.join(fields)} WHERE id = ?",
        tuple(values),
    )
    conn.commit()

    cursor.execute("SELECT * FROM promocodes WHERE id = ?", (promo_id,))
    row = cursor.fetchone()
    conn.close()

    if not row:
        return jsonify({'success': False, 'error': 'Promocode not found'}), 404

    return jsonify({'success': True, 'promocode': dict(row)})


@app.route('/api/panel/promocodes/<int:promo_id>', methods=['DELETE'])
@require_auth
def delete_promocode(promo_id: int):
    """Удалить промокод"""
    conn = database.get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("DELETE FROM promocodes WHERE id = ?", (promo_id,))
        conn.commit()
        if cursor.rowcount <= 0:
            return jsonify({'success': False, 'error': 'Promocode not found'}), 404
        return jsonify({'success': True})
    finally:
        conn.close()


@app.route('/api/panel/tracking-links', methods=['GET'])
@require_auth
def panel_list_tracking_links():
    rows = database.get_tracking_links_with_stats()
    bot_username = os.getenv('BOT_USERNAME') or os.getenv('BOT_USERNAME_MINI') or 'blinvpn_bot'
    for r in rows:
        r['url'] = f"https://t.me/{bot_username}?start=trk_{r['code']}"
        r['is_active'] = bool(r.get('is_active', 1))
    return jsonify(rows)


@app.route('/api/panel/tracking-links/stats', methods=['GET'])
@require_auth
def panel_tracking_links_stats():
    return jsonify(database.get_tracking_links_aggregate_stats())


@app.route('/api/panel/tracking-links/<int:link_id>', methods=['GET'])
@require_auth
def panel_get_tracking_link(link_id):
    link = database.get_tracking_link_detail(link_id)
    if not link:
        return jsonify({'success': False, 'error': 'Link not found'}), 404
    bot_username = os.getenv('BOT_USERNAME') or os.getenv('BOT_USERNAME_MINI') or 'blinvpn_bot'
    link['url'] = f"https://t.me/{bot_username}?start=trk_{link['code']}"
    link['is_active'] = bool(link.get('is_active', 1))
    return jsonify(link)


@app.route('/api/panel/tracking-links', methods=['POST'])
@require_auth
def panel_create_tracking_link():
    data = request.json or {}
    code = str(data.get('code') or secrets.token_hex(4)).strip()
    name = str(data.get('name') or '').strip()
    promocode = str(data.get('promocode') or '').strip().upper() or None
    try:
        result = database.create_tracking_link(code, name, promocode)
        bot_username = os.getenv('BOT_USERNAME') or os.getenv('BOT_USERNAME_MINI') or 'blinvpn_bot'
        return jsonify({
            'success': True,
            'id': result['id'],
            'code': result['code'],
            'url': f"https://t.me/{bot_username}?start=trk_{result['code']}",
        })
    except ValueError as e:
        return jsonify({'success': False, 'error': str(e)}), 400
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 400


@app.route('/api/panel/tracking-links/<int:link_id>', methods=['PUT'])
@require_auth
def panel_update_tracking_link(link_id):
    data = request.json or {}
    try:
        if not database.update_tracking_link(link_id, data):
            return jsonify({'success': False, 'error': 'Link not found'}), 404
        return jsonify({'success': True})
    except ValueError as e:
        return jsonify({'success': False, 'error': str(e)}), 400
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 400


@app.route('/api/panel/tracking-links/<int:link_id>', methods=['DELETE'])
@require_auth
def panel_delete_tracking_link(link_id):
    if not database.delete_tracking_link(link_id):
        return jsonify({'success': False, 'error': 'Link not found'}), 404
    return jsonify({'success': True})

@app.route('/api/panel/mailing', methods=['POST'])
@require_auth
def send_mailing():
    """Отправить рассылку с поддержкой HTML/Markdown форматирования"""
    data = request.json
    message = data.get('message')
    target_users = data.get('target_users', 'all')  # 'all' or list/int user_ids
    button_type = data.get('button_type')
    button_value = data.get('button_value')
    image_url = data.get('image_url')
    parse_mode = data.get('parse_mode', 'HTML')  # normalized to HTML

    if not message:
        return jsonify({'success': False, 'error': 'Message is required'}), 400
    message, parse_mode = _normalize_mailing_markup(message, parse_mode)

    conn = database.get_db_connection()
    cursor = conn.cursor()

    try:
        # Определяем список получателей
        user_rows = []
        if target_users == 'all':
            cursor.execute("SELECT id, telegram_id FROM users WHERE is_banned = 0 OR is_banned IS NULL")
            user_rows = cursor.fetchall()
        elif target_users == 'active':
            # Пользователи с активными подписками
            cursor.execute("""
                SELECT DISTINCT u.id, u.telegram_id FROM users u
                JOIN vpn_keys vk ON u.id = vk.user_id
                WHERE (u.is_banned = 0 OR u.is_banned IS NULL)
                  AND vk.status = 'Active' AND vk.expiry_date > datetime('now')
            """)
            user_rows = cursor.fetchall()
        elif target_users == 'expired':
            # Пользователи с истёкшими подписками
            cursor.execute("""
                SELECT DISTINCT u.id, u.telegram_id FROM users u
                JOIN vpn_keys vk ON u.id = vk.user_id
                WHERE (u.is_banned = 0 OR u.is_banned IS NULL)
                  AND (vk.status = 'Expired' OR vk.expiry_date < datetime('now'))
            """)
            user_rows = cursor.fetchall()
        elif target_users == 'no_subscription':
            # Пользователи без подписок
            cursor.execute("""
                SELECT u.id, u.telegram_id FROM users u
                WHERE (u.is_banned = 0 OR u.is_banned IS NULL)
                  AND u.id NOT IN (SELECT DISTINCT user_id FROM vpn_keys)
            """)
            user_rows = cursor.fetchall()
        elif isinstance(target_users, list):
            placeholders = ",".join("?" for _ in target_users)
            cursor.execute(
                f"SELECT id, telegram_id FROM users WHERE id IN ({placeholders}) AND (is_banned = 0 OR is_banned IS NULL)",
                tuple(target_users),
            )
            user_rows = cursor.fetchall()

        # Формируем кнопки если есть
        reply_markup = None
        miniapp_url = os.getenv('MINIAPP_URL', 'https://your-domain.com/miniapp')
        
        if button_type and button_value:
            if button_type == 'external_link' or button_type == 'url':
                # Внешняя ссылка: значение может быть "Текст|URL" или просто URL
                if '|' in button_value:
                    btn_text, btn_url = button_value.split('|', 1)
                    btn_text = (btn_text or '').strip() or 'Перейти'
                    btn_url = (btn_url or '').strip()
                else:
                    btn_text = 'Перейти'
                    btn_url = button_value.strip()
                reply_markup = {
                    'inline_keyboard': [[{'text': btn_text, 'url': btn_url}]]
                }
            elif button_type == 'open_miniapp' or button_type == 'webapp':
                # Мини-приложение: значение «Текст|URL» или только URL
                if '|' in button_value:
                    btn_text, btn_url = button_value.split('|', 1)
                    btn_text = btn_text.strip() or 'Открыть приложение'
                    btn_url = btn_url.strip() or miniapp_url
                else:
                    btn_text = 'Открыть приложение'
                    btn_url = button_value.strip() or miniapp_url
                reply_markup = {
                    'inline_keyboard': [[{'text': btn_text, 'web_app': {'url': btn_url}}]]
                }
            elif button_type == 'activate_promo':
                # Кнопка с промокодом - добавляет промокод в deep link
                bot_username = os.getenv('BOT_USERNAME') or os.getenv('BOT_USERNAME_MINI') or 'blinvpn_bot'
                promo_url = f"https://t.me/{bot_username}?start=promo_{button_value}"
                reply_markup = {
                    'inline_keyboard': [[{'text': f'🎁 Активировать промокод {button_value}', 'url': promo_url}]]
                }
            elif button_type == 'add_balance':
                # Кнопка пополнения баланса - открывает мини-приложение на странице пополнения
                balance_url = f"{miniapp_url}?view=topup&amount={button_value}"
                reply_markup = {
                    'inline_keyboard': [[{'text': f'💰 Пополнить на {button_value}₽', 'web_app': {'url': balance_url}}]]
                }

        sent = 0
        errors = 0
        total_targeted = len(user_rows)

        cursor.execute(
            """
            INSERT INTO mailings (title, message_text, target_users, sent_count, status, sent_at, button_type, button_value, image_url)
            VALUES (?, ?, ?, ?, 'Completed', CURRENT_TIMESTAMP, ?, ?, ?)
            """,
            (data.get('title', ''), message, str(target_users), total_targeted, button_type, button_value, image_url),
        )
        mailing_id = cursor.lastrowid

        for row in user_rows:
            telegram_id = row['telegram_id']
            try:
                message_result = None
                if image_url:
                    message_result = telegram_send_photo(telegram_id, image_url, message, parse_mode, reply_markup)
                else:
                    message_result = telegram_send_message(telegram_id, message, parse_mode, reply_markup)

                if message_result:
                    sent += 1
                    cursor.execute(
                        """
                        INSERT INTO mailing_messages (mailing_id, telegram_id, telegram_message_id)
                        VALUES (?, ?, ?)
                        """,
                        (mailing_id, int(telegram_id), int(message_result.get('message_id'))),
                    )
                else:
                    errors += 1
            except Exception as e:
                logger.error(f"Error sending mailing to {telegram_id}: {e}")
                errors += 1

        conn.commit()
    finally:
        conn.close()

    return jsonify({'success': True, 'sent': sent, 'errors': errors, 'total': total_targeted})

@app.route('/api/panel/mailing/stats', methods=['GET'])
@require_auth
def get_mailing_stats():
    """Получить статистику рассылок"""
    conn = database.get_db_connection()
    cursor = conn.cursor()
    
    try:
        # Общее количество отправленных сообщений
        cursor.execute("SELECT COALESCE(SUM(sent_count), 0) AS total FROM mailings WHERE status = 'Completed'")
        total_sent = cursor.fetchone()['total'] or 0
        
        return jsonify({
            'totalSent': total_sent
        })
    finally:
        conn.close()

@app.route('/api/panel/mailing/history', methods=['GET'])
@require_auth
def get_mailing_history():
    """Получить историю рассылок"""
    conn = database.get_db_connection()
    cursor = conn.cursor()
    
    try:
        cursor.execute("""
            SELECT id, title, message_text, sent_count, status, sent_at, created_at
            FROM mailings
            ORDER BY created_at DESC
            LIMIT 50
        """)
        rows = cursor.fetchall()
        history = []
        for row in rows:
            from datetime import datetime
            date_str = row['sent_at'] or row['created_at']
            if date_str:
                try:
                    if isinstance(date_str, str):
                        dt = datetime.fromisoformat(date_str.replace('Z', '+00:00'))
                    else:
                        dt = date_str
                    date_formatted = dt.strftime('%d.%m.%y')
                except:
                    date_formatted = str(date_str)[:10]
            else:
                date_formatted = ''
            
            history.append({
                'id': row['id'],
                'title': row['title'] or row['message_text'][:50] if row['message_text'] else 'Без названия',
                'message_text': row['message_text'] or '',
                'sent_count': row['sent_count'] or 0,
                'status': row['status'],
                'date': date_formatted
            })
        
        return jsonify(history)
    finally:
        conn.close()


@app.route('/api/panel/mailing/<int:mailing_id>', methods=['DELETE'])
@require_auth
def delete_mailing(mailing_id: int):
    """Удалить рассылку и попытаться удалить ранее отправленные сообщения у пользователей"""
    conn = database.get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("SELECT id FROM mailings WHERE id = ?", (mailing_id,))
        row = cursor.fetchone()
        if not row:
            return jsonify({'error': 'Mailing not found'}), 404

        cursor.execute(
            "SELECT telegram_id, telegram_message_id FROM mailing_messages WHERE mailing_id = ?",
            (mailing_id,),
        )
        records = cursor.fetchall()
        deleted_count = 0
        failed_count = 0
        for rec in records:
            if telegram_delete_message(int(rec['telegram_id']), int(rec['telegram_message_id'])):
                deleted_count += 1
            else:
                failed_count += 1

        cursor.execute("DELETE FROM mailing_messages WHERE mailing_id = ?", (mailing_id,))
        cursor.execute("DELETE FROM mailings WHERE id = ?", (mailing_id,))
        conn.commit()
        return jsonify({'success': True, 'deleted_messages': deleted_count, 'failed_messages': failed_count})
    finally:
        conn.close()


@app.route('/api/panel/transactions', methods=['GET'])
@require_auth
def get_transactions():
    """Получить список транзакций - только успешные пополнения и выводы, без действий администратора"""
    limit = request.args.get('limit', 100, type=int)
    offset = request.args.get('offset', 0, type=int)
    
    conn = database.get_db_connection()
    cursor = conn.cursor()
    
    try:
        # Показываем только успешные пополнения (deposit) и выводы (withdrawal_request)
        # Исключаем действия администратора (admin_deposit, admin_withdraw) и другие типы
        cursor.execute("""
            SELECT 
                t.id,
                t.user_id,
                u.username,
                t.type,
                t.amount,
                t.status,
                t.payment_method,
                t.payment_provider,
                t.payment_id,
                t.hash,
                t.created_at
            FROM transactions t
            LEFT JOIN users u ON t.user_id = u.id
            WHERE t.type IN ('deposit', 'withdrawal_request')
              AND t.status = 'Success'
              AND t.payment_method != 'Admin'
              AND (t.description IS NULL OR LOWER(t.description) NOT LIKE '%администрац%')
            ORDER BY t.created_at DESC
            LIMIT ? OFFSET ?
        """, (limit, offset))
        
        rows = cursor.fetchall()
        transactions = []
        for row in rows:
            username = row['username'] or f"user_{row['user_id']}"
            transactions.append({
                'id': row['id'],
                'user_id': row['user_id'],
                'user': f"@{username}" if username and not username.startswith('@') else username,
                'amount': float(row['amount']),
                'type': row['type'],
                'status': row['status'] or 'Pending',
                'payment_method': row['payment_method'] or 'Unknown',
                'payment_provider': row['payment_provider'] or '',
                'payment_id': row['payment_id'] or '',
                'hash': row['hash'] or row['payment_id'] or '',
                'created_at': row['created_at']
            })
        
        return jsonify(transactions)
    finally:
        conn.close()

@app.route('/api/panel/transactions/<int:transaction_id>/refund', methods=['POST'])
@require_auth
def refund_transaction(transaction_id: int):
    """Сделать возврат по транзакции"""
    conn = database.get_db_connection()
    cursor = conn.cursor()
    
    try:
        # Получаем транзакцию
        cursor.execute("""
            SELECT t.*, u.telegram_id, u.username
            FROM transactions t
            LEFT JOIN users u ON t.user_id = u.id
            WHERE t.id = ?
        """, (transaction_id,))
        
        transaction = cursor.fetchone()
        if not transaction:
            return jsonify({'success': False, 'error': 'Транзакция не найдена'}), 404
        
        if transaction['type'] != 'deposit':
            return jsonify({'success': False, 'error': 'Возврат возможен только для пополнений'}), 400
        
        if transaction['status'] == 'Refunded':
            return jsonify({'success': False, 'error': 'Транзакция уже была возвращена'}), 400
        
        amount = float(transaction['amount'])
        user_id = transaction['user_id']
        payment_id = transaction['payment_id']
        payment_provider = transaction['payment_provider']
        
        # Списываем сумму с баланса пользователя
        user = database.get_user_by_id(user_id)
        if user:
            current_balance = user.get('balance', 0)
            new_balance = max(0, current_balance - amount)  # Не уходим в минус
            
            cursor.execute("""
                UPDATE users SET balance = ? WHERE id = ?
            """, (new_balance, user_id))
        
        # Помечаем транзакцию как возвращенную
        cursor.execute("""
            UPDATE transactions 
            SET status = 'Refunded', refunded_at = CURRENT_TIMESTAMP
            WHERE id = ?
        """, (transaction_id,))
        
        # Создаем транзакцию возврата
        cursor.execute("""
            INSERT INTO transactions (user_id, type, amount, status, payment_method, payment_provider, description)
            VALUES (?, 'refund', ?, 'Success', ?, ?, ?)
        """, (user_id, -amount, transaction['payment_method'], payment_provider, f'Возврат по транзакции #{transaction_id}'))
        
        conn.commit()
        
        # Уведомляем пользователя
        if transaction['telegram_id']:
            core.send_notification_to_user(
                transaction['telegram_id'],
                notify_msgs.build_refund_message(float(amount), transaction_id),
            )
        
        logger.info(f"Возврат по транзакции #{transaction_id}: {amount}₽ для user {user_id}")
        
        return jsonify({
            'success': True, 
            'message': f'Возврат {amount}₽ выполнен успешно',
            'refund_id': refund_result.get('id') if refund_result else None
        })
        
    except Exception as e:
        logger.error(f"Error refunding transaction {transaction_id}: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500
    finally:
        conn.close()

@app.route('/api/panel/users/<int:user_id>/subscriptions', methods=['GET'])
@require_auth
def get_user_subscriptions(user_id: int):
    """Получить все подписки (ключи) пользователя с синхронизацией трафика из Remnawave"""
    conn = database.get_db_connection()
    cursor = conn.cursor()
    
    try:
        # Получаем telegram_id пользователя для запроса к Remnawave
        cursor.execute("SELECT telegram_id FROM users WHERE id = ?", (user_id,))
        user_row = cursor.fetchone()
        telegram_id = user_row['telegram_id'] if user_row else None
        
        cursor.execute("""
            SELECT vk.id, vk.key_uuid, vk.status, vk.expiry_date, 
                   vk.traffic_used, vk.traffic_limit, vk.created_at,
                   CASE WHEN vk.traffic_limit > 0 AND vk.traffic_limit < 100000000000 THEN 'whitelist' ELSE 'vpn' END as type
            FROM vpn_keys vk
            WHERE vk.user_id = ?
            ORDER BY vk.created_at DESC
        """, (user_id,))
        
        rows = cursor.fetchall()
        
        # Трафик и дата окончания из Remnawave (единый источник истины)
        remnawave_traffic = {}
        remnawave_expiry = {}
        if telegram_id:
            try:
                rw_users = remnawave.remnawave_api.get_user_by_telegram_id(telegram_id)
                for rw_user in rw_users or []:
                    rw_uuid = rw_user.uuid if hasattr(rw_user, 'uuid') else rw_user.get('uuid')
                    if not rw_uuid:
                        continue
                    traffic_used = 0
                    if hasattr(rw_user, 'user_traffic') and rw_user.user_traffic:
                        traffic_used = rw_user.user_traffic.used_traffic_bytes
                    elif hasattr(rw_user, 'used_traffic_bytes'):
                        traffic_used = rw_user.used_traffic_bytes
                    remnawave_traffic[rw_uuid] = traffic_used
                    expire_at = getattr(rw_user, 'expire_at', None) or (rw_user.get('expireAt') if isinstance(rw_user, dict) else None)
                    if expire_at:
                        if isinstance(expire_at, str):
                            expire_at = datetime.fromisoformat(expire_at.replace('Z', '+00:00').replace('+00:00', ''))
                        if getattr(expire_at, 'tzinfo', None):
                            expire_at = expire_at.replace(tzinfo=None) - timedelta(seconds=expire_at.utcoffset().total_seconds() if expire_at.utcoffset() else 0)
                        remnawave_expiry[rw_uuid] = expire_at
                        cursor.execute("UPDATE vpn_keys SET expiry_date = ? WHERE key_uuid = ?", (expire_at.isoformat(), rw_uuid))
                conn.commit()
            except Exception as e:
                logger.warning(f"Failed to sync traffic/expiry from Remnawave: {e}")
        
        subscriptions = []
        
        for row in rows:
            days_left = 0
            hours_left = 0
            is_expired = False
            expiry_date_value = row['expiry_date']
            expiry_dt_src = remnawave_expiry.get(row['key_uuid']) if row['key_uuid'] else None
            if expiry_dt_src is None and row['expiry_date']:
                try:
                    if isinstance(row['expiry_date'], str):
                        expiry_dt_src = datetime.fromisoformat(row['expiry_date'].replace('Z', '+00:00'))
                    else:
                        expiry_dt_src = row['expiry_date']
                except Exception:
                    expiry_dt_src = None
            if expiry_dt_src:
                try:
                    if getattr(expiry_dt_src, 'tzinfo', None):
                        expiry_dt_src = expiry_dt_src.replace(tzinfo=None) - timedelta(seconds=expiry_dt_src.utcoffset().total_seconds() if expiry_dt_src.utcoffset() else 0)
                    diff = expiry_dt_src - datetime.utcnow().replace(tzinfo=None)
                    total_seconds = diff.total_seconds()
                    expiry_date_value = expiry_dt_src.isoformat()
                    if total_seconds <= 0:
                        is_expired = True
                        days_left = 0
                        hours_left = 0
                    else:
                        import math
                        total_hours = total_seconds / 3600
                        days_left = int(total_hours / 24)
                        hours_left = int(math.ceil(total_hours % 24))
                except Exception:
                    is_expired = True
            
            # Получаем актуальный трафик из Remnawave
            traffic_used = float(row['traffic_used'] or 0)
            key_uuid = row['key_uuid']
            if key_uuid and key_uuid in remnawave_traffic:
                traffic_used = float(remnawave_traffic[key_uuid])
                try:
                    cursor.execute("UPDATE vpn_keys SET traffic_used = ? WHERE key_uuid = ?", 
                                 (traffic_used, key_uuid))
                except Exception:
                    pass
            
            subscriptions.append({
                'id': row['id'],
                'key_uuid': row['key_uuid'],
                'short_uuid': row['key_uuid'][:8] if row['key_uuid'] else None,
                'status': row['status'],
                'expiry_date': expiry_date_value,
                'days_left': days_left if days_left is not None else 0,
                'traffic_used': traffic_used,
                'traffic_limit': float(row['traffic_limit'] or 0),
                'type': row['type']
            })
        
        # Commit обновлений трафика
        try:
            conn.commit()
        except:
            pass
        
        return jsonify(subscriptions)
    finally:
        conn.close()


@app.route('/api/panel/users/<int:user_id>/referrals', methods=['GET'])
@require_auth
def panel_user_referrals(user_id: int):
    """Список рефералов пользователя для панели"""
    conn = database.get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("""
            SELECT id, telegram_id, username, full_name, referred_by, is_partner, partner_rate
            FROM users
            WHERE referred_by = ?
            ORDER BY id DESC
        """, (user_id,))
        return jsonify([dict(r) for r in cursor.fetchall()])
    finally:
        conn.close()


@app.route('/api/panel/users/<int:user_id>/referrals/<int:referral_user_id>/unlink', methods=['POST'])
@require_auth
def panel_unlink_referral(user_id: int, referral_user_id: int):
    """Отвязать реферала от пользователя"""
    conn = database.get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("SELECT referred_by FROM users WHERE id = ?", (referral_user_id,))
        row = cursor.fetchone()
        if not row:
            return jsonify({'success': False, 'error': 'Referral user not found'}), 404
        if row['referred_by'] != user_id:
            return jsonify({'success': False, 'error': 'Referral is not linked to this user'}), 400
        cursor.execute("UPDATE users SET referred_by = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?", (referral_user_id,))
        conn.commit()
        return jsonify({'success': True})
    finally:
        conn.close()


@app.route('/api/panel/users/<int:user_id>/unban', methods=['POST'])
@require_auth
def unban_user(user_id: int):
    """Разбанить пользователя (снять is_banned и удалить из черного списка)"""
    conn = database.get_db_connection()
    cursor = conn.cursor()
    
    try:
        # Проверяем существование пользователя
        cursor.execute("SELECT id, telegram_id, username, is_banned FROM users WHERE id = ?", (user_id,))
        user = cursor.fetchone()
        
        if not user:
            return jsonify({'success': False, 'error': 'Пользователь не найден'}), 404
        
        telegram_id = user['telegram_id']
        
        # Проверяем, в черном списке ли пользователь
        cursor.execute("SELECT 1 FROM blacklist WHERE telegram_id = ?", (telegram_id,))
        in_blacklist = cursor.fetchone() is not None
        
        # Если не забанен И не в черном списке - ошибка
        if not user['is_banned'] and not in_blacklist:
            return jsonify({'success': False, 'error': 'Пользователь не заблокирован'}), 400
        
        # Разбаниваем пользователя (снимаем is_banned)
        cursor.execute("UPDATE users SET is_banned = 0, ban_reason = NULL WHERE id = ?", (user_id,))
        
        # Удаляем из черного списка
        if in_blacklist:
            cursor.execute("DELETE FROM blacklist WHERE telegram_id = ?", (telegram_id,))
            logger.info(f"User {user_id} (telegram_id={telegram_id}) removed from blacklist")
        
        conn.commit()
        
        # Уведомляем пользователя
        if telegram_id:
            core.send_notification_to_user(telegram_id, notify_msgs.build_unban_message())
        
        logger.info(f"User {user_id} unbanned successfully")
        
        return jsonify({
            'success': True,
            'message': f'Пользователь @{user["username"] or user_id} разблокирован',
            'was_blacklisted': in_blacklist
        })
        
    except Exception as e:
        logger.error(f"Error unbanning user {user_id}: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500
    finally:
        conn.close()

@app.route('/api/panel/keys', methods=['GET'])
@require_auth
def get_keys():
    """Получить список ключей VPN с синхронизацией трафика и даты окончания из Remnawave"""
    limit = request.args.get('limit', 100, type=int)
    offset = request.args.get('offset', 0, type=int)
    search = (request.args.get('search') or request.args.get('q') or '').strip() or None
    status = request.args.get('status')
    if status in ('', 'all'):
        status = None

    total = database.count_panel_keys(search, status)
    rows = database.list_panel_keys(search, status, limit, offset)

    conn = database.get_db_connection()
    cursor = conn.cursor()

    try:
        keys = []
        
        # Собираем все telegram_id для batch запроса к Remnawave
        telegram_ids = set()
        for row in rows:
            if row.get('telegram_id'):
                telegram_ids.add(row['telegram_id'])
        
        # Трафик и дата окончания из Remnawave (единый источник истины)
        remnawave_traffic = {}
        remnawave_expiry = {}
        try:
            for telegram_id in telegram_ids:
                rw_users = remnawave.remnawave_api.get_user_by_telegram_id(telegram_id)
                for rw_user in rw_users or []:
                    rw_uuid = rw_user.uuid if hasattr(rw_user, 'uuid') else rw_user.get('uuid')
                    if not rw_uuid:
                        continue
                    traffic_used = 0
                    if hasattr(rw_user, 'user_traffic') and rw_user.user_traffic:
                        traffic_used = rw_user.user_traffic.used_traffic_bytes
                    elif hasattr(rw_user, 'used_traffic_bytes'):
                        traffic_used = rw_user.used_traffic_bytes
                    remnawave_traffic[rw_uuid] = traffic_used
                    expire_at = getattr(rw_user, 'expire_at', None) or (rw_user.get('expireAt') if isinstance(rw_user, dict) else None)
                    if expire_at:
                        if isinstance(expire_at, str):
                            expire_at = datetime.fromisoformat(expire_at.replace('Z', '+00:00').replace('+00:00', ''))
                        if getattr(expire_at, 'tzinfo', None):
                            expire_at = expire_at.replace(tzinfo=None) - timedelta(seconds=expire_at.utcoffset().total_seconds() if expire_at.utcoffset() else 0)
                        remnawave_expiry[rw_uuid] = expire_at
                        cursor.execute("UPDATE vpn_keys SET expiry_date = ? WHERE key_uuid = ?", (expire_at.isoformat(), rw_uuid))
        except Exception as e:
            logger.warning(f"Failed to sync traffic/expiry from Remnawave for panel keys: {e}")
        
        try:
            conn.commit()
        except Exception:
            pass
        
        for row in rows:
            username = row.get('username') or f"user_{row['user_id']}"
            key_display = row.get('key_config') or row.get('key_uuid') or f"key_{row['id']}"
            if len(key_display) > 50:
                key_display = key_display[:47] + '...'
            
            # Дата окончания: приоритет у Remnawave (как в miniapp)
            key_uuid = row.get('key_uuid')
            expiry_dt_src = remnawave_expiry.get(key_uuid) if key_uuid else None
            if expiry_dt_src is None and row.get('expiry_date'):
                try:
                    if isinstance(row['expiry_date'], str):
                        expiry_dt_src = datetime.fromisoformat(row['expiry_date'].replace('Z', '+00:00'))
                    else:
                        expiry_dt_src = row['expiry_date']
                except Exception:
                    expiry_dt_src = None
            expiry_days = 0
            expiry_date_value = row.get('expiry_date')
            if expiry_dt_src:
                try:
                    if getattr(expiry_dt_src, 'tzinfo', None):
                        expiry_dt_src = expiry_dt_src.replace(tzinfo=None) - timedelta(seconds=expiry_dt_src.utcoffset().total_seconds() if expiry_dt_src.utcoffset() else 0)
                    now_utc = datetime.utcnow()
                    diff = expiry_dt_src - now_utc
                    expiry_days = max(0, int(diff.total_seconds() / 86400))
                    expiry_date_value = expiry_dt_src.isoformat()
                except Exception:
                    pass
            
            # Получаем актуальный трафик из Remnawave если доступен
            traffic_used = float(row.get('traffic_used') or 0)
            if key_uuid and key_uuid in remnawave_traffic:
                traffic_used = float(remnawave_traffic[key_uuid])
                # Обновляем в БД для консистентности
                try:
                    cursor.execute("UPDATE vpn_keys SET traffic_used = ? WHERE key_uuid = ?", 
                                 (traffic_used, key_uuid))
                except:
                    pass
            
            raw_status = row.get('status') or 'Active'
            panel_status = raw_status
            if str(raw_status).lower() in ('blocked', 'banned'):
                panel_status = 'Banned'

            keys.append({
                'id': row['id'],
                'key_config': row.get('key_config'),
                'key_uuid': key_uuid,
                'key': key_display,
                'user_id': row['user_id'],
                'username': f"@{username}" if username and not username.startswith('@') else username,
                'status': panel_status,
                'expiry_date': expiry_date_value,
                'expiry': expiry_days,
                'traffic_used': traffic_used,
                'traffic_limit': float(row.get('traffic_limit') or 0),
                'devices_used': 0,  # TODO: подсчитать из devices
                'devices_limit': row.get('devices_limit') or 1,
                'server_location': row.get('server_location') or 'Unknown'
            })
        
        # Commit любых обновлений трафика
        try:
            conn.commit()
        except:
            pass
        
        return jsonify({'items': keys, 'total': total})
    finally:
        conn.close()


@app.route('/api/panel/keys', methods=['POST'])
@require_auth
def create_key():
    """Создать ключ VPN для пользователя через Remnawave"""
    data = request.json
    
    user_id = data.get('user_id')
    days = data.get('days', 30)
    traffic_gb = data.get('traffic', 100)  # В ГБ
    devices = data.get('devices', 5)
    is_trial = data.get('is_trial', False)
    plan_type = data.get('plan_type', 'vpn')
    # Если сквады не указаны явно, используем балансировщик для выбора оптимального сквада
    squad_uuids = data.get('squads')
    if squad_uuids is None or len(squad_uuids) == 0:
        # Сначала пробуем балансировщик - выбираем сквад с наименьшей нагрузкой
        best_squad = database.get_best_squad_for_subscription(plan_type)
        if best_squad:
            squad_uuids = [best_squad['squad_uuid']]
            logger.info(f"Balancer selected squad {best_squad['squad_name']} for {plan_type} (users: {best_squad['current_users']})")
        else:
            # Fallback на сквады из настроек
            squad_uuids = database.get_default_squads(plan_type)
            logger.info(f"Using default squads for {plan_type}: {squad_uuids}")
    
    if not user_id:
        return jsonify({'error': 'user_id обязателен'}), 400
    
    # Получаем пользователя
    user = database.get_user_by_id(user_id)
    if not user:
        return jsonify({'error': 'Пользователь не найден'}), 404
    
    telegram_id = user.get('telegram_id')
    raw_username = user.get('username') or f"user_{telegram_id}"
    
    # Санитизация username для Remnawave (только буквы, цифры, _ и -)
    import re
    username = re.sub(r'[^a-zA-Z0-9_-]', '', raw_username)
    if not username:
        username = f"user_{telegram_id}"
    if username[0] in '_-':
        username = f"u{username}"
    
    # Триальные настройки
    if is_trial:
        days = 1
        traffic_gb = 5
        devices = 2
    
    traffic_bytes = int(traffic_gb * (1024 ** 3))  # Конвертация в байты
    
    try:
        from src.api import remnawave
        
        # Создаем или получаем пользователя в Remnawave
        remnawave_user = None
        existing_users = remnawave.remnawave_api.get_user_by_telegram_id(telegram_id)
        
        if existing_users and len(existing_users) > 0:
            # Пользователь уже существует - обновляем подписку
            remnawave_user = existing_users[0]
            expire_at = datetime.now() + timedelta(days=days)
            
            # Обновляем пользователя
            logger.info(f"Updating Remnawave user {remnawave_user.uuid} with squads: {squad_uuids}")
            updated_user = remnawave.remnawave_api.update_user_sync(
                uuid=remnawave_user.uuid,
                expire_at=expire_at,
                traffic_limit_bytes=traffic_bytes,
                hwid_device_limit=devices,
                active_internal_squads=squad_uuids if squad_uuids else None
            )
            remnawave_user = updated_user
        else:
            # Создаём нового пользователя в Remnawave с санитизированным username
            logger.info(f"Creating Remnawave user {username} with squads: {squad_uuids}")
            try:
                remnawave_user = remnawave.remnawave_api.create_user_with_params(
                    telegram_id=telegram_id,
                    username=username,
                    days=days,
                    traffic_limit_bytes=traffic_bytes,
                    hwid_device_limit=devices,
                    active_internal_squads=squad_uuids if squad_uuids else None
                )
            except Exception as create_error:
                error_msg = str(create_error).lower()
                # Если username уже существует - добавляем telegram_id для уникальности
                if 'already exists' in error_msg or 'a019' in error_msg:
                    unique_username = f"{username}_{telegram_id}"
                    logger.info(f"Username {username} already exists, trying {unique_username}")
                    remnawave_user = remnawave.remnawave_api.create_user_with_params(
                        telegram_id=telegram_id,
                        username=unique_username,
                        days=days,
                        traffic_limit_bytes=traffic_bytes,
                        hwid_device_limit=devices,
                        active_internal_squads=squad_uuids if squad_uuids else None
                    )
                else:
                    raise create_error
        
        if not remnawave_user:
            return jsonify({'error': 'Не удалось создать пользователя в Remnawave'}), 500
        
        # Сохраняем или обновляем ключ в БД
        conn = database.get_db_connection()
        cursor = conn.cursor()
        
        expiry_date = format_datetime_msk(datetime.now() + timedelta(days=days))
        key_uuid = remnawave_user.uuid if hasattr(remnawave_user, 'uuid') else remnawave_user.get('uuid')
        subscription_url = remnawave_user.subscription_url if hasattr(remnawave_user, 'subscription_url') else remnawave_user.get('subscription_url', '')
        
        # Проверяем существует ли уже ключ для этого пользователя
        cursor.execute("SELECT id FROM vpn_keys WHERE user_id = ? AND key_uuid = ?", (user_id, key_uuid))
        existing_key = cursor.fetchone()
        
        if existing_key:
            # Обновляем существующий ключ
            cursor.execute("""
                UPDATE vpn_keys
                SET status = 'Active', expiry_date = ?, traffic_limit = ?, devices_limit = ?, 
                    key_config = ?
                WHERE id = ?
            """, (expiry_date, traffic_bytes, devices, subscription_url, existing_key['id']))
            key_id = existing_key['id']
        else:
            # Создаем новый ключ
            cursor.execute("""
                INSERT INTO vpn_keys (user_id, key_uuid, key_config, status, expiry_date, 
                                    devices_limit, traffic_limit, plan_type)
                VALUES (?, ?, ?, 'Active', ?, ?, ?, ?)
            """, (user_id, key_uuid, subscription_url, expiry_date, devices, traffic_bytes, plan_type))
            key_id = cursor.lastrowid
        
        conn.commit()
        conn.close()
        
        # Уведомление админу удалено - оставляем только для пополнений и запросов на вывод
        
        # Отправляем ключ пользователю с кнопкой открытия приложения
        core.send_key_created_notification(telegram_id, days, traffic_gb, devices)
        
        return jsonify({
            'success': True,
            'key_id': key_id,
            'key_uuid': key_uuid,
            'subscription_url': subscription_url,
            'expiry_date': expiry_date
        }), 201
        
    except Exception as e:
        logger.error(f"Ошибка создания ключа: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': f'Ошибка создания ключа: {str(e)}'}), 500


@app.route('/api/panel/keys/<int:key_id>/block', methods=['POST'])
@require_auth
def toggle_key_block(key_id):
    """Заблокировать/разблокировать ключ вручную"""
    data = request.json
    blocked = data.get('blocked', True)
    
    conn = database.get_db_connection()
    cursor = conn.cursor()
    
    try:
        # Обновляем статус ключа
        new_status = 'Blocked' if blocked else 'Active'
        cursor.execute("""
            UPDATE vpn_keys 
            SET status = ?, last_used = CURRENT_TIMESTAMP
            WHERE id = ?
        """, (new_status, key_id))
        
        if cursor.rowcount == 0:
            return jsonify({'error': 'Ключ не найден'}), 404
        
        conn.commit()
        
        # Если блокируем, также отключаем в Remnawave через update_user
        cursor.execute("SELECT key_uuid FROM vpn_keys WHERE id = ?", (key_id,))
        row = cursor.fetchone()
        
        if row and row['key_uuid']:
            try:
                from src.api.remnawave import UserStatus
                
                # Обновляем статус в Remnawave
                status = UserStatus.DISABLED if blocked else UserStatus.ACTIVE
                remnawave.remnawave_api.update_user_sync(
                    uuid=row['key_uuid'],
                    status=status
                )
                logger.info(f"Key {key_id} {'blocked' if blocked else 'unblocked'} in Remnawave")
            except Exception as e:
                logger.error(f"Failed to update key status in Remnawave: {e}")
        
        return jsonify({
            'success': True,
            'key_id': key_id,
            'status': new_status,
            'blocked': blocked
        })
    except Exception as e:
        logger.error(f"Error toggling key block: {e}")
        return jsonify({'error': str(e)}), 500


@app.route('/api/panel/keys/<int:key_id>/enable', methods=['POST'])
@require_auth
def enable_key(key_id):
    conn = database.get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("SELECT key_uuid FROM vpn_keys WHERE id = ?", (key_id,))
        key = cursor.fetchone()
        if not key:
            return jsonify({'error': 'Key not found'}), 404
        cursor.execute("UPDATE vpn_keys SET status = 'Active' WHERE id = ?", (key_id,))
        conn.commit()
        if key['key_uuid']:
            remnawave.remnawave_api.update_user_sync(uuid=key['key_uuid'], status=remnawave.UserStatus.ACTIVE)
        return jsonify({'success': True, 'blocked': False})
    except Exception as e:
        logger.error(f"enable_key error: {e}")
        return jsonify({'error': str(e)}), 500
    finally:
        conn.close()


@app.route('/api/panel/keys/<int:key_id>/disable', methods=['POST'])
@require_auth
def disable_key(key_id):
    conn = database.get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("SELECT key_uuid FROM vpn_keys WHERE id = ?", (key_id,))
        key = cursor.fetchone()
        if not key:
            return jsonify({'error': 'Key not found'}), 404
        cursor.execute("UPDATE vpn_keys SET status = 'Blocked' WHERE id = ?", (key_id,))
        conn.commit()
        if key['key_uuid']:
            remnawave.remnawave_api.update_user_sync(uuid=key['key_uuid'], status=remnawave.UserStatus.DISABLED)
        return jsonify({'success': True, 'blocked': True})
    except Exception as e:
        logger.error(f"disable_key error: {e}")
        return jsonify({'error': str(e)}), 500
    finally:
        conn.close()


@app.route('/api/panel/keys/<int:key_id>/hwid/reset', methods=['POST'])
@require_auth
def reset_key_hwid(key_id):
    conn = database.get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("SELECT key_uuid FROM vpn_keys WHERE id = ?", (key_id,))
        row = cursor.fetchone()
        if not row or not row['key_uuid']:
            return jsonify({'error': 'Key not found'}), 404
        key_uuid = row['key_uuid']
        try:
            remnawave.remnawave_api.delete_all_hwid_devices_sync(key_uuid)
        except Exception as e:
            logger.error(f"Failed to reset hwid in remnawave: {e}")
            return jsonify({'error': 'Failed to reset hwid'}), 500
        cursor.execute("UPDATE vpn_keys SET hwid_hash = NULL, last_ip = NULL WHERE id = ?", (key_id,))
        conn.commit()
        return jsonify({'success': True})
    finally:
        conn.close()


@app.route('/api/panel/keys/<int:key_id>', methods=['DELETE'])
@require_auth
def delete_key(key_id: int):
    """Удалить ключ из панели и Remnawave"""
    conn = database.get_db_connection()
    cursor = conn.cursor()
    
    try:
        # Получаем информацию о ключе
        cursor.execute("SELECT key_uuid, user_id FROM vpn_keys WHERE id = ?", (key_id,))
        row = cursor.fetchone()
        
        if not row:
            return jsonify({'error': 'Ключ не найден'}), 404
        
        key_uuid = row['key_uuid']
        user_id = row['user_id']
        
        # Удаляем из Remnawave
        if key_uuid:
            try:
                remnawave.remnawave_api.delete_user_sync(key_uuid)
                logger.info(f"Deleted key {key_uuid} from Remnawave")
            except Exception as e:
                logger.error(f"Failed to delete key {key_uuid} from Remnawave: {e}")
        
        # Удаляем ключ/устройство (теперь одна запись)
        cursor.execute("DELETE FROM vpn_keys WHERE id = ?", (key_id,))
        
        conn.commit()
        
        # Уведомляем пользователя
        cursor.execute("SELECT telegram_id FROM users WHERE id = ?", (user_id,))
        user_row = cursor.fetchone()
        if user_row:
            core.send_notification_to_user(
                user_row['telegram_id'],
                notify_msgs.build_admin_deleted_subscription_message(),
            )
        
        logger.info(f"Key {key_id} deleted from panel")
        
        return jsonify({'success': True})
    except Exception as e:
        logger.error(f"Error deleting key {key_id}: {e}")
        return jsonify({'error': str(e)}), 500
    finally:
        conn.close()


@app.route('/api/panel/keys/<int:key_id>', methods=['PUT'])
@require_auth
def update_key(key_id: int):
    """Обновить параметры ключа"""
    data = request.json
    
    conn = database.get_db_connection()
    cursor = conn.cursor()
    
    try:
        # Получаем информацию о ключе
        cursor.execute("SELECT key_uuid, expiry_date, traffic_limit, devices_limit FROM vpn_keys WHERE id = ?", (key_id,))
        row = cursor.fetchone()
        
        if not row:
            return jsonify({'error': 'Ключ не найден'}), 404
        
        key_uuid = row['key_uuid']
        
        # Новые значения
        new_expiry_days = data.get('expiry_days')
        new_traffic_gb = data.get('traffic_gb')
        new_devices = data.get('devices_limit')
        
        # Обновляем в БД
        updates = []
        values = []
        
        if new_expiry_days is not None:
            new_expiry_date = format_datetime_msk(datetime.now() + timedelta(days=int(new_expiry_days)))
            updates.append("expiry_date = ?")
            values.append(new_expiry_date)
        
        if new_traffic_gb is not None:
            traffic_bytes = int(float(new_traffic_gb) * (1024 ** 3))
            updates.append("traffic_limit = ?")
            values.append(traffic_bytes)
        
        if new_devices is not None:
            updates.append("devices_limit = ?")
            values.append(int(new_devices))
        
        if updates:
            values.append(key_id)
            cursor.execute(f"UPDATE vpn_keys SET {', '.join(updates)} WHERE id = ?", tuple(values))
            conn.commit()
        
        # Обновляем в Remnawave
        if key_uuid:
            try:
                update_params = {'uuid': key_uuid}
                
                if new_expiry_days is not None:
                    update_params['expire_at'] = datetime.now() + timedelta(days=int(new_expiry_days))
                
                if new_traffic_gb is not None:
                    update_params['traffic_limit_bytes'] = int(float(new_traffic_gb) * (1024 ** 3))
                
                if new_devices is not None:
                    update_params['hwid_device_limit'] = int(new_devices)
                
                remnawave.remnawave_api.update_user_sync(**update_params)
                logger.info(f"Updated key {key_uuid} in Remnawave")
            except Exception as e:
                logger.error(f"Failed to update key {key_uuid} in Remnawave: {e}")
        
        return jsonify({'success': True})
    except Exception as e:
        logger.error(f"Error updating key {key_id}: {e}")
        return jsonify({'error': str(e)}), 500
    finally:
        conn.close()


@app.route('/api/user/referrals', methods=['GET'])
def get_user_referrals():
    """Получить список рефералов пользователя"""
    telegram_id = request.args.get('telegram_id', type=int)
    auth_err = enforce_telegram_id_auth(telegram_id)
    if auth_err:
        return auth_err

    user = database.get_user_by_telegram_id(telegram_id)
    if not user:
        return jsonify({'error': 'User not found'}), 404

    conn = database.get_db_connection()
    cursor = conn.cursor()

    try:
        cursor.execute(
            """
            SELECT id, username, full_name, registration_date
            FROM users
            WHERE referred_by = ?
            ORDER BY registration_date DESC
            """,
            (user["id"],),
        )
        referrals_rows = cursor.fetchall()

        rate_pct = 20
        referrals = []
        for r in referrals_rows:
            ref_id = r["id"]

            cursor.execute(
                "SELECT COUNT(*) as cnt FROM users WHERE referred_by = ?",
                (ref_id,),
            )
            invited_cnt_row = cursor.fetchone()
            invited_count = int(invited_cnt_row["cnt"] or 0) if invited_cnt_row else 0

            cursor.execute(
                """
                SELECT COALESCE(SUM(ABS(amount)), 0) as total
                FROM transactions
                WHERE user_id = ? AND type IN ('subscription', 'subscription_extend')
                  AND amount < 0
                """,
                (ref_id,),
            )
            spent_row = cursor.fetchone()
            total_spent = float(spent_row["total"] or 0)

            ref_username = r["username"] if r["username"] else None
            ref_full_name = r["full_name"] if r["full_name"] else None
            my_profit = database.sum_referral_income_from_buyer(
                user["id"],
                ref_id,
                line=1,
                buyer_username=ref_username,
                buyer_full_name=ref_full_name,
            )
            # Старые начисления без buyer_user_id в description — оценка по фактическим покупкам
            if my_profit <= 0 and total_spent > 0:
                my_profit = round(total_spent * (rate_pct / 100.0), 2)

            cursor.execute(
                """
                SELECT type, amount, created_at, description
                FROM transactions
                WHERE user_id = ? AND type IN ('subscription', 'subscription_extend')
                  AND amount < 0
                ORDER BY created_at DESC
                LIMIT 5
                """,
                (ref_id,),
            )
            history_rows = cursor.fetchall()
            history = []
            for h in history_rows:
                amount = abs(float(h["amount"] or 0))
                trans_type = h["type"]
                if trans_type == 'subscription_extend':
                    title = f"Продление подписки: {round(amount, 2)}₽"
                else:
                    title = f"Покупка подписки: {round(amount, 2)}₽"
                referrer_income = round(amount * (rate_pct / 100.0), 2)
                history.append({
                    "type": trans_type,
                    "title": title,
                    "amount": round(amount, 2),
                    "income": referrer_income,
                    "date": h["created_at"] or "",
                })

            referrals.append(
                {
                    "id": ref_id,
                    "name": r["full_name"] or r["username"] or f"id{ref_id}",
                    "date": r["registration_date"] or "",
                    "spent": round(total_spent, 2),
                    "myProfit": round(my_profit, 2),
                    "lineLabel": "1-я линия",
                    "ratePercent": rate_pct,
                    "invitedCount": invited_count,
                    "history": history,
                }
            )

        # Распределить старый доход 1-й линии без buyer_user_id в описании
        if referrals:
            cursor.execute(
                """
                SELECT COALESCE(SUM(amount), 0) AS total
                FROM transactions
                WHERE user_id = ? AND type = 'referral_income'
                  AND description NOT LIKE '%line=2|%'
                  AND description NOT LIKE '%2-й линии%'
                """,
                (user["id"],),
            )
            l1_pool_row = cursor.fetchone()
            l1_pool = float(l1_pool_row["total"] or 0) if l1_pool_row else 0.0
            assigned = sum(float(x["myProfit"]) for x in referrals)
            remainder = round(l1_pool - assigned, 2)
            if remainder > 0.01:
                total_spent_all = sum(float(x["spent"]) for x in referrals)
                if total_spent_all > 0:
                    for item in referrals:
                        share = float(item["spent"]) / total_spent_all
                        item["myProfit"] = round(float(item["myProfit"]) + remainder * share, 2)
                elif len(referrals) == 1:
                    referrals[0]["myProfit"] = round(float(referrals[0]["myProfit"]) + remainder, 2)

        return jsonify(referrals)
    except Exception as e:
        logger.error("get_user_referrals error: %s", e, exc_info=True)
        return jsonify({'error': 'Failed to load referrals'}), 500
    finally:
        conn.close()


@app.route('/api/user/referral-history', methods=['GET'])
def get_referral_income_history():
    """Получить историю реферального дохода пользователя"""
    telegram_id = request.args.get('telegram_id', type=int)
    auth_err = enforce_telegram_id_auth(telegram_id)
    if auth_err:
        return auth_err
    
    user = database.get_user_by_telegram_id(telegram_id)
    if not user:
        return jsonify({'error': 'User not found'}), 404
    
    conn = database.get_db_connection()
    cursor = conn.cursor()
    
    try:
        # Получаем все транзакции реферального дохода и вывода
        cursor.execute("""
            SELECT id, type, amount, status, description, created_at
            FROM transactions
            WHERE user_id = ? AND type IN ('referral_income', 'transfer', 'withdrawal_request')
            ORDER BY created_at DESC
            LIMIT 50
        """, (user['id'],))
        
        rows = cursor.fetchall()
        history = []
        
        for row in rows:
            trans_type = row['type']
            amount = round(float(row['amount'] or 0), 2)
            description = row['description'] or ''
            
            if trans_type == 'referral_income':
                title = f'💰 Реферальный доход: +{amount}₽'
                icon = 'income'
            elif trans_type == 'transfer':
                title = f'🔄 Перевод на баланс: {amount}₽'
                icon = 'transfer'
            else:
                title = f'💸 Заявка на вывод: {amount}₽'
                icon = 'withdrawal'
            
            history.append({
                'id': row['id'],
                'type': icon,
                'title': title,
                'amount': amount,
                'status': row['status'],
                'description': description,
                'date': row['created_at']
            })
        
        return jsonify(history)
    finally:
        conn.close()


@app.route('/api/user/withdraw', methods=['POST'])
def request_withdrawal():
    """Запрос на вывод средств из реферального баланса"""
    data = request.json
    telegram_id = data.get('telegram_id')
    amount = data.get('amount', 0)
    method = data.get('method')  # 'balance', 'card', 'cryptobot', 'crypto'
    
    # Дополнительные данные в зависимости от метода
    card_number = str(data.get('card_number', '')).strip()
    crypto_net = data.get('crypto_net', '')
    crypto_addr = data.get('crypto_addr', '')
    
    logger.info(f"Withdrawal request: telegram_id={telegram_id}, amount={amount}, method={method}")
    
    if not telegram_id or not method:
        logger.error("Missing required fields: telegram_id or method")
        return jsonify({'error': 'Missing required fields'}), 400

    try:
        telegram_id = int(telegram_id)
    except (TypeError, ValueError):
        return jsonify({'error': 'Invalid telegram_id'}), 400

    auth_err = enforce_telegram_id_auth(telegram_id)
    if auth_err:
        return auth_err
    
    try:
        amount = float(amount)
    except (ValueError, TypeError):
        logger.error(f"Invalid amount: {amount}")
        return jsonify({'error': 'Invalid amount'}), 400
        
    if amount <= 0:
        logger.error(f"Amount must be positive: {amount}")
        return jsonify({'error': 'Invalid amount'}), 400
    
    min_limits = {
        'balance': 1,
        'card': 1000,
        'cryptobot': 10,
        'crypto': 300
    }
    if method not in min_limits:
        return jsonify({'error': f'Unknown withdrawal method: {method}'}), 400
    if amount < min_limits[method]:
        return jsonify({'error': f'Минимальная сумма для выбранного метода: {min_limits[method]}₽'}), 400
    
    user = database.get_user_by_telegram_id(telegram_id)
    if not user:
        logger.error(f"User not found: {telegram_id}")
        return jsonify({'error': 'User not found'}), 404
    
    partner_balance = user.get('partner_balance', 0)
    logger.info(f"User partner_balance: {partner_balance}, requested: {amount}")
    
    if amount > partner_balance:
        return jsonify({'error': 'Insufficient partner balance'}), 400
    
    conn = database.get_db_connection()
    cursor = conn.cursor()
    
    # Проверка лимита для вывода на карту - не чаще 1 раза в 30 дней
    if method == 'card':
        cursor.execute("""
            SELECT created_at FROM transactions 
            WHERE user_id = ? AND type = 'withdrawal_request' AND payment_method = 'Карта' AND status = 'Pending'
            ORDER BY created_at DESC LIMIT 1
        """, (user['id'],))
        last_card_withdrawal = cursor.fetchone()
        
        if last_card_withdrawal:
            from datetime import datetime, timedelta
            last_date_str = last_card_withdrawal['created_at']
            try:
                if isinstance(last_date_str, str):
                    last_date = datetime.fromisoformat(last_date_str.replace('Z', '+00:00'))
                else:
                    last_date = last_date_str
                
                days_since = (datetime.now() - last_date.replace(tzinfo=None)).days
                if days_since < 30:
                    days_left = 30 - days_since
                    return jsonify({'error': f'Вывод на карту доступен не чаще 1 раза в 30 дней. Осталось дней: {days_left}'}), 400
            except Exception as e:
                logger.error(f"Error parsing last withdrawal date: {e}")
    
    try:
        if method == 'balance':
            # Перевод на основной баланс
            cursor.execute("""
                UPDATE users 
                SET balance = balance + ?, partner_balance = partner_balance - ?
                WHERE id = ?
            """, (amount, amount, user['id']))
            
            cursor.execute("""
                INSERT INTO transactions (user_id, type, amount, status, description)
                VALUES (?, 'transfer', ?, 'Success', 'Перевод с реферального баланса на основной')
            """, (user['id'], amount))
            
            conn.commit()
            
            return jsonify({
                'success': True,
                'message': f'Переведено {amount}₽ на основной баланс'
            })
        
        elif method in ('card', 'cryptobot', 'crypto'):
            # Запрос на вывод - списываем с partner_balance и создаем заявку
            cursor.execute("""
                UPDATE users SET partner_balance = partner_balance - ? WHERE id = ?
            """, (amount, user['id']))
            
            # Создаем заявку на вывод
            if method == 'card':
                if not card_number:
                    return jsonify({'error': 'Номер карты обязателен'}), 400
                description = f'Заявка на вывод {amount}₽ на карту РФ. Номер: {card_number}'
                details = f"💳 Карта: {card_number}"
            elif method == 'cryptobot':
                description = f'Заявка на вывод {amount}₽ в CryptoBot'
                details = "🤖 CryptoBot"
            else:
                if crypto_net not in ('TON', 'TRC-20'):
                    return jsonify({'error': 'Выберите сеть TON или TRC-20'}), 400
                if crypto_net == 'TRC-20' and not str(crypto_addr).startswith('T'):
                    return jsonify({'error': 'Адрес TRC-20 должен начинаться с T'}), 400
                description = f'Заявка на вывод {amount}₽ в криптовалюте. Сеть: {crypto_net}, Адрес: {crypto_addr}'
                details = f"🌐 Сеть: {crypto_net}\n📝 Адрес: {crypto_addr}"
            
            cursor.execute("""
                INSERT INTO transactions (user_id, type, amount, status, description, payment_method)
                VALUES (?, 'withdrawal_request', ?, 'Pending', ?, ?)
            """, (user['id'], -amount, description, 'Карта' if method == 'card' else ('CryptoBot' if method == 'cryptobot' else 'Crypto')))
            
            transaction_id = cursor.lastrowid
            conn.commit()
            
            # Отправляем запрос ТОЛЬКО админу с кнопками Принять/Отказать
            username = user.get('username', 'N/A')
            method_name = 'Банковская карта' if method == 'card' else ('CryptoBot' if method == 'cryptobot' else 'Криптовалюта')
            
            core.send_withdrawal_request_to_admin(
                transaction_id=transaction_id,
                user_id=user['id'],
                telegram_id=telegram_id,
                username=username,
                amount=amount,
                method=method_name,
                details=details
            )

            core.send_notification_to_user(
                telegram_id,
                notify_msgs.build_withdrawal_created_message(transaction_id),
            )
            
            return jsonify({
                'success': True,
                'message': f'Заявка на вывод {amount}₽ создана. Ожидайте обработки.'
            })
        
        else:
            return jsonify({'error': f'Unknown withdrawal method: {method}'}), 400
            
    except Exception as e:
        logger.error(f"Error processing withdrawal request: {e}")
        return jsonify({'error': str(e)}), 500
    finally:
        conn.close()


@app.route('/api/panel/stats/charts', methods=['GET'])
@require_auth
def get_stats_charts():
    """Графики по ключам/подпискам для дашборда (последние 14 дней)."""
    conn = database.get_db_connection()
    cursor = conn.cursor()
    from datetime import datetime, timedelta

    try:
        # Подготовим даты
        days = []
        today = datetime.utcnow().date()
        for i in range(14):
            days.append(today - timedelta(days=13 - i))

        # Новые ключи по дням
        cursor.execute(
            """
            SELECT DATE(created_at) as d, COUNT(*) as cnt
            FROM vpn_keys
            GROUP BY DATE(created_at)
            """
        )
        keys_new_map = {row["d"]: int(row["cnt"] or 0) for row in cursor.fetchall()}
        keys_new_series = [keys_new_map.get(str(d), 0) for d in days]

        # Новые подписки по дням
        cursor.execute(
            """
            SELECT DATE(created_at) as d, COUNT(*) as cnt
            FROM transactions
            WHERE type IN ('subscription', 'trial')
            GROUP BY DATE(created_at)
            """
        )
        subs_new_map = {row["d"]: int(row["cnt"] or 0) for row in cursor.fetchall()}
        subs_new_series = [subs_new_map.get(str(d), 0) for d in days]

        return jsonify({
            "keys_new": keys_new_series,
            "subs_new": subs_new_series,
            "labels": [d.strftime("%d.%m") for d in days],
        })
    finally:
        conn.close()


@app.route('/api/panel/stats/summary', methods=['GET'])
@require_auth
def get_stats_summary():
    """
    Сводные метрики для дашборда:
    - total_users: всего пользователей
    - active_keys: активных ключей
    - monthly_revenue: сумма депозитов за текущий месяц
    """
    conn = database.get_db_connection()
    cursor = conn.cursor()
    from datetime import datetime

    try:
        # Всего пользователей
        cursor.execute("SELECT COUNT(*) AS cnt FROM users")
        total_users = cursor.fetchone()["cnt"] or 0

        # Активные ключи
        cursor.execute("SELECT COUNT(*) AS cnt FROM vpn_keys WHERE status = 'Active'")
        active_keys = cursor.fetchone()["cnt"] or 0

        # Доход за текущий месяц (без админских ручных начислений)
        now = datetime.utcnow()
        month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        cursor.execute(
            """
            SELECT COALESCE(SUM(amount), 0) AS total
            FROM transactions
            WHERE type = 'deposit'
              AND (description IS NULL OR LOWER(description) NOT LIKE '%администрац%')
              AND created_at >= ?
              AND status = 'Success'
            """,
            (month_start.isoformat(),),
        )
        monthly_revenue = float(cursor.fetchone()["total"] or 0)

        return jsonify(
            {
                "total_users": total_users,
                "active_keys": active_keys,
                "monthly_revenue": monthly_revenue,
            }
        )
    finally:
        conn.close()

@app.route('/api/panel/finance/stats', methods=['GET'])
@require_auth
def get_finance_stats():
    """Статистика финансов (пополнения, списания, успешные операции)"""
    conn = database.get_db_connection()
    cursor = conn.cursor()
    from datetime import datetime, timedelta
    
    try:
        # Пополнения (без админских ручных начислений)
        cursor.execute("""
            SELECT COALESCE(SUM(amount), 0) AS total, COUNT(*) AS cnt
            FROM transactions
            WHERE type = 'deposit'
              AND status = 'Success'
              AND (description IS NULL OR LOWER(description) NOT LIKE '%администрац%')
        """)
        deposits_row = cursor.fetchone()
        deposits_total = float(deposits_row['total'] or 0)
        deposits_count = deposits_row['cnt'] or 0
        
        # Расходы: выводы/рефанды без админских ручных списаний
        cursor.execute("""
            SELECT COALESCE(SUM(ABS(amount)), 0) AS total, COUNT(*) AS cnt
            FROM transactions
            WHERE type IN ('referral_withdrawal', 'refund', 'withdrawal')
              AND status = 'Success'
              AND (description IS NULL OR LOWER(description) NOT LIKE '%администрац%')
        """)
        withdrawals_row = cursor.fetchone()
        withdrawals_total = float(withdrawals_row['total'] or 0)
        withdrawals_count = withdrawals_row['cnt'] or 0
        
        # Успешные операции
        cursor.execute("""
            SELECT COUNT(*) AS cnt
            FROM transactions
            WHERE status = 'Success'
        """)
        successful_ops = cursor.fetchone()['cnt'] or 0
        
        # Изменение за период (сравнение с предыдущим месяцем)
        now = datetime.utcnow()
        month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        prev_month_start = (month_start - timedelta(days=1)).replace(day=1)
        
        cursor.execute("""
            SELECT COALESCE(SUM(amount), 0) AS total
            FROM transactions
            WHERE type = 'deposit'
              AND status = 'Success'
              AND (description IS NULL OR LOWER(description) NOT LIKE '%администрац%')
              AND created_at >= ? AND created_at < ?
        """, (prev_month_start.isoformat(), month_start.isoformat()))
        prev_deposits = float(cursor.fetchone()['total'] or 0)
        
        deposits_change = ((deposits_total - prev_deposits) / prev_deposits * 100) if prev_deposits > 0 else 0
        
        return jsonify({
            'deposits': deposits_total,
            'depositsChange': f"+{deposits_change:.1f}%" if deposits_change >= 0 else f"{deposits_change:.1f}%",
            'withdrawals': withdrawals_total,
            'withdrawalsChange': '+2.1%',  # Упрощенно
            'successfulOps': successful_ops
        })
    finally:
        conn.close()

@app.route('/api/panel/statistics/full', methods=['GET'])
@require_auth
def get_full_statistics():
    """Полная статистика для страницы Статистика"""
    conn = database.get_db_connection()
    cursor = conn.cursor()
    from datetime import datetime, timedelta
    
    try:
        # Основные метрики
        cursor.execute("SELECT COUNT(*) AS cnt FROM users")
        total_users = cursor.fetchone()['cnt'] or 0
        
        cursor.execute("SELECT COUNT(*) AS cnt FROM vpn_keys WHERE status = 'Active'")
        active_subscriptions = cursor.fetchone()['cnt'] or 0
        
        today_start = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
        cursor.execute("""
            SELECT COUNT(*) AS cnt FROM transactions
            WHERE type = 'deposit'
              AND status = 'Success'
              AND (description IS NULL OR LOWER(description) NOT LIKE '%администрац%')
              AND created_at >= ?
        """, (today_start.isoformat(),))
        payments_today = cursor.fetchone()['cnt'] or 0
        
        cursor.execute("SELECT COALESCE(SUM(balance), 0) AS total FROM users")
        clients_balance = float(cursor.fetchone()['total'] or 0)
        
        # Выручка по дням (последние 30 дней)
        revenue_data = []
        revenue_labels = []
        for i in range(30):
            day = (datetime.utcnow() - timedelta(days=29-i)).date()
            day_start = datetime.combine(day, datetime.min.time())
            day_end = day_start + timedelta(days=1)
            cursor.execute("""
                SELECT COALESCE(SUM(amount), 0) AS total
                FROM transactions
                WHERE type = 'deposit' AND status = 'Success'
                  AND (description IS NULL OR LOWER(description) NOT LIKE '%администрац%')
                  AND created_at >= ? AND created_at < ?
            """, (day_start.isoformat(), day_end.isoformat()))
            revenue_data.append(float(cursor.fetchone()['total'] or 0))
            revenue_labels.append(day.strftime('%d.%m.%Y'))
        
        # Распределение пользователей (на основе состояния их ключей)
        cursor.execute("""
            SELECT COUNT(DISTINCT user_id) AS cnt FROM vpn_keys 
            WHERE status = 'Active' AND expiry_date > datetime('now')
        """)
        active_users = cursor.fetchone()['cnt'] or 0
        
        cursor.execute("SELECT COUNT(*) AS cnt FROM users WHERE trial_used = 0")
        trial_users = cursor.fetchone()['cnt'] or 0
        
        cursor.execute("SELECT COUNT(*) AS cnt FROM users WHERE is_banned = 1")
        banned_users = cursor.fetchone()['cnt'] or 0
        
        cursor.execute("""
            SELECT COUNT(DISTINCT user_id) AS cnt FROM vpn_keys 
            WHERE status = 'Expired' OR (expiry_date IS NOT NULL AND expiry_date < datetime('now'))
        """)
        expired_users = cursor.fetchone()['cnt'] or 0
        
        sleeping_users = max(0, total_users - active_users - trial_users - banned_users - expired_users)
        
        user_dist_data = [
            {'label': 'Активные', 'value': active_users},
            {'label': 'Ушли', 'value': expired_users},
            {'label': 'Trial', 'value': trial_users},
            {'label': 'Бан', 'value': banned_users},
            {'label': 'Спящие', 'value': sleeping_users},
        ]
        
        # Способы оплаты
        cursor.execute("""
            SELECT payment_method, COUNT(*) AS cnt
            FROM transactions
            WHERE type = 'deposit' AND status = 'Success'
              AND (description IS NULL OR LOWER(description) NOT LIKE '%администрац%')
            GROUP BY payment_method
        """)
        payment_methods_raw = cursor.fetchall()
        total_payments = sum(row['cnt'] for row in payment_methods_raw) or 1
        payment_methods_data = []
        for row in payment_methods_raw:
            method = row['payment_method'] or 'Other'
            count = row['cnt']
            payment_methods_data.append({
                'label': method,
                'value': int((count / total_payments) * 100)
            })
        
        # Подписки
        cursor.execute("SELECT COUNT(*) AS cnt FROM vpn_keys")
        total_subscriptions = cursor.fetchone()['cnt'] or 0
        cursor.execute("SELECT COUNT(*) AS cnt FROM vpn_keys WHERE status = 'Active' AND expiry_date > datetime('now')")
        paid_subscriptions = cursor.fetchone()['cnt'] or 0
        
        week_start = datetime.utcnow() - timedelta(days=7)
        cursor.execute("""
            SELECT COUNT(*) AS cnt FROM vpn_keys
            WHERE created_at >= ?
        """, (week_start.isoformat(),))
        bought_this_week = cursor.fetchone()['cnt'] or 0
        
        # Конверсия Trial -> Paid (на основе наличия активных подписок)
        cursor.execute("SELECT COUNT(*) AS cnt FROM users WHERE trial_used = 1")
        used_trial = cursor.fetchone()['cnt'] or 0
        cursor.execute("""
            SELECT COUNT(DISTINCT u.id) AS cnt 
            FROM users u
            JOIN vpn_keys vk ON vk.user_id = u.id
            WHERE u.trial_used = 1 AND vk.status = 'Active' AND vk.expiry_date > datetime('now')
        """)
        converted = cursor.fetchone()['cnt'] or 0
        conversion_rate = (converted / used_trial * 100) if used_trial > 0 else 0
        
        # Рефералы
        cursor.execute("SELECT COUNT(*) AS cnt FROM users WHERE referred_by IS NOT NULL")
        total_invited = cursor.fetchone()['cnt'] or 0
        cursor.execute("SELECT COUNT(*) AS cnt FROM users WHERE is_partner = 1")
        partners = cursor.fetchone()['cnt'] or 0
        cursor.execute("SELECT COALESCE(SUM(total_earned), 0) AS total FROM users")
        total_paid = float(cursor.fetchone()['total'] or 0)
        
        # Топ рефералов
        cursor.execute("""
            SELECT u.id, u.username, u.partner_rate,
                   COUNT(r.id) AS referrals_count,
                   COALESCE(SUM(CASE WHEN t.status = 'Success' THEN t.amount ELSE 0 END), 0) AS total_spent
            FROM users u
            LEFT JOIN users r ON r.referred_by = u.id
            LEFT JOIN transactions t ON t.user_id = r.id
                AND t.type = 'deposit'
                AND t.status = 'Success'
                AND (t.description IS NULL OR LOWER(t.description) NOT LIKE '%администрац%')
            GROUP BY u.id
            HAVING referrals_count > 0
            ORDER BY referrals_count DESC, total_spent DESC
            LIMIT 10
        """)
        top_referrers_raw = cursor.fetchall()
        top_referrers = []
        for idx, row in enumerate(top_referrers_raw, 1):
            username = row['username'] or f"id{row['id']}"
            rate = row['partner_rate'] or 25
            total_spent = float(row['total_spent'] or 0)
            earned = total_spent * (rate / 100)
            top_referrers.append({
                'id': idx,
                'name': f"@{username}" if not username.startswith('@') else username,
                'count': row['referrals_count'] or 0,
                'earned': earned
            })
        
        # Средняя выручка в день
        avg_daily = sum(revenue_data) / len(revenue_data) if revenue_data else 0
        best_day_value = max(revenue_data) if revenue_data else 0
        best_day_idx = revenue_data.index(best_day_value) if revenue_data else 0
        best_day_date = (datetime.utcnow() - timedelta(days=29-best_day_idx)).strftime('%d %B') if revenue_data else ''
        
        return jsonify({
            'totalUsers': total_users,
            'activeSubscriptions': active_subscriptions,
            'paymentsToday': payments_today,
            'clientsBalance': clients_balance,
            'revenueData': revenue_data,
            'revenueLabels': revenue_labels,
            'userDistData': user_dist_data,
            'paymentMethodsData': payment_methods_data,
            'totalSubscriptions': total_subscriptions,
            'paidSubscriptions': paid_subscriptions,
            'boughtThisWeek': bought_this_week,
            'conversionRate': conversion_rate,
            'totalInvited': total_invited,
            'partners': partners,
            'totalPaid': total_paid,
            'topReferrers': top_referrers,
            'avgDaily': avg_daily,
            'bestDayValue': best_day_value,
            'bestDayDate': best_day_date
        })
    finally:
        conn.close()

@app.route('/api/panel/promocodes/stats', methods=['GET'])
@require_auth
def get_promocodes_stats():
    """Статистика промокодов"""
    conn = database.get_db_connection()
    cursor = conn.cursor()
    
    try:
        cursor.execute("""
            SELECT 
                COUNT(*) AS total,
                SUM(uses_count) AS total_uses,
                COUNT(CASE WHEN is_active = 1 THEN 1 END) AS active_count
            FROM promocodes
        """)
        row = cursor.fetchone()
        return jsonify({
            'total': row['total'] or 0,
            'totalUses': row['total_uses'] or 0,
            'activeCount': row['active_count'] or 0
        })
    finally:
        conn.close()

@app.route('/api/tariffs', methods=['GET'])
def get_public_tariffs():
    """Публичный API для получения тарифов (для мини-приложения)"""
    conn = database.get_db_connection()
    cursor = conn.cursor()
    
    try:
        cursor.execute("""
            SELECT * FROM tariff_plans
            WHERE is_active = 1
            ORDER BY plan_type, sort_order
        """)
        rows = cursor.fetchall()
        plans = []
        for row in rows:
            plans.append({
                'id': row['id'],
                'plan_type': row['plan_type'],
                'name': row['name'],
                'price': float(row['price']),
                'duration_days': row['duration_days'],
                'is_active': bool(row['is_active']),
                'sort_order': row['sort_order']
            })
        return jsonify(plans)
    finally:
        conn.close()


@app.route('/api/panel/tariffs', methods=['GET'])
@require_auth
def get_tariffs():
    """Получить тарифные планы (для панели)"""
    conn = database.get_db_connection()
    cursor = conn.cursor()
    
    try:
        cursor.execute("""
            SELECT * FROM tariff_plans
            WHERE is_active = 1
            ORDER BY plan_type, sort_order
        """)
        rows = cursor.fetchall()
        plans = []
        for row in rows:
            plans.append({
                'id': row['id'],
                'plan_type': row['plan_type'],
                'name': row['name'],
                'price': float(row['price']),
                'duration_days': row['duration_days'],
                'is_active': bool(row['is_active']),
                'sort_order': row['sort_order']
            })
        return jsonify(plans)
    finally:
        conn.close()

@app.route('/api/panel/tariffs', methods=['POST'])
@require_auth
def create_tariff():
    """Создать тарифный план"""
    data = request.json
    conn = database.get_db_connection()
    cursor = conn.cursor()
    
    try:
        cursor.execute("""
            INSERT INTO tariff_plans (plan_type, name, price, duration_days, is_active, sort_order)
            VALUES (?, ?, ?, ?, ?, ?)
        """, (
            data.get('plan_type'),
            data.get('name'),
            data.get('price'),
            data.get('duration_days'),
            1 if data.get('is_active', True) else 0,
            data.get('sort_order', 0)
        ))
        conn.commit()
        plan_id = cursor.lastrowid
        cursor.execute("SELECT * FROM tariff_plans WHERE id = ?", (plan_id,))
        return jsonify({'success': True, 'plan': dict(cursor.fetchone())})
    finally:
        conn.close()

@app.route('/api/panel/tariffs/<int:plan_id>', methods=['PUT'])
@require_auth
def update_tariff(plan_id: int):
    """Обновить тарифный план"""
    data = request.json
    conn = database.get_db_connection()
    cursor = conn.cursor()
    
    try:
        fields = []
        values = []
        for key in ['plan_type', 'name', 'price', 'duration_days', 'is_active', 'sort_order']:
            if key in data:
                if key == 'is_active':
                    values.append(1 if data[key] else 0)
                else:
                    values.append(data[key])
                fields.append(f"{key} = ?")
        
        if not fields:
            return jsonify({'success': False, 'error': 'Nothing to update'}), 400
        
        values.append(plan_id)
        cursor.execute(f"UPDATE tariff_plans SET {', '.join(fields)}, updated_at = CURRENT_TIMESTAMP WHERE id = ?", tuple(values))
        conn.commit()
        cursor.execute("SELECT * FROM tariff_plans WHERE id = ?", (plan_id,))
        row = cursor.fetchone()
        if not row:
            return jsonify({'success': False, 'error': 'Plan not found'}), 404
        return jsonify({'success': True, 'plan': dict(row)})
    finally:
        conn.close()

@app.route('/api/panel/tariffs/whitelist', methods=['PUT'])
@require_auth
def update_whitelist_tariff():
    """Обновить настройки whitelist тарифа"""
    data = request.json
    conn = database.get_db_connection()
    cursor = conn.cursor()
    
    try:
        # Обновляем или создаем настройки whitelist
        cursor.execute("SELECT id FROM whitelist_settings ORDER BY id DESC LIMIT 1")
        row = cursor.fetchone()
        
        if row:
            settings_id = row['id']
            cursor.execute("""
                UPDATE whitelist_settings 
                SET subscription_fee = ?, price_per_gb = ?, pricing_type = ?, updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
            """, (
                data.get('subscription_fee', 100.0),
                data.get('price_per_gb', 15.0),
                data.get('pricing_type', 'dynamic'),
                settings_id
            ))
        else:
            cursor.execute("""
                INSERT INTO whitelist_settings (subscription_fee, price_per_gb, pricing_type, min_gb, max_gb)
                VALUES (?, ?, ?, 5, 500)
            """, (
                data.get('subscription_fee', 100.0),
                data.get('price_per_gb', 15.0),
                data.get('pricing_type', 'dynamic')
            ))
        
        conn.commit()
        return jsonify({'success': True})
    finally:
        conn.close()

@app.route('/api/panel/tariffs/<int:plan_id>', methods=['DELETE'])
@require_auth
def delete_tariff(plan_id: int):
    """Удалить тарифный план"""
    conn = database.get_db_connection()
    cursor = conn.cursor()
    
    try:
        cursor.execute("UPDATE tariff_plans SET is_active = 0 WHERE id = ?", (plan_id,))
        conn.commit()
        return jsonify({'success': True})
    finally:
        conn.close()

@app.route('/api/panel/whitelist/settings', methods=['GET'])
@require_auth
def get_whitelist_settings():
    """Получить настройки whitelist bypass"""
    conn = database.get_db_connection()
    cursor = conn.cursor()
    
    try:
        cursor.execute("SELECT * FROM whitelist_settings ORDER BY id DESC LIMIT 1")
        row = cursor.fetchone()
        if row:
            return jsonify(dict(row))
        return jsonify({
            'subscription_fee': 100.0,
            'price_per_gb': 15.0,
            'min_gb': 5,
            'max_gb': 500,
            'auto_pay_enabled': True,
            'auto_pay_threshold_mb': 100
        })
    finally:
        conn.close()

@app.route('/api/panel/whitelist/settings', methods=['PUT'])
@require_auth
def update_whitelist_settings():
    """Обновить настройки whitelist bypass"""
    data = request.json
    conn = database.get_db_connection()
    cursor = conn.cursor()
    
    try:
        cursor.execute("SELECT id FROM whitelist_settings ORDER BY id DESC LIMIT 1")
        row = cursor.fetchone()
        if row:
            settings_id = row['id']
            fields = []
            values = []
            for key in ['subscription_fee', 'price_per_gb', 'min_gb', 'max_gb', 'auto_pay_enabled', 'auto_pay_threshold_mb']:
                if key in data:
                    if key == 'auto_pay_enabled':
                        values.append(1 if data[key] else 0)
                    else:
                        values.append(data[key])
                    fields.append(f"{key} = ?")
            if fields:
                values.append(settings_id)
                cursor.execute(f"UPDATE whitelist_settings SET {', '.join(fields)}, updated_at = CURRENT_TIMESTAMP WHERE id = ?", tuple(values))
        else:
            cursor.execute("""
                INSERT INTO whitelist_settings (subscription_fee, price_per_gb, min_gb, max_gb, auto_pay_enabled, auto_pay_threshold_mb)
                VALUES (?, ?, ?, ?, ?, ?)
            """, (
                data.get('subscription_fee', 100.0),
                data.get('price_per_gb', 15.0),
                data.get('min_gb', 5),
                data.get('max_gb', 500),
                1 if data.get('auto_pay_enabled', True) else 0,
                data.get('auto_pay_threshold_mb', 100)
            ))
        conn.commit()
        return jsonify({'success': True})
    finally:
        conn.close()

@app.route('/api/panel/auto-discounts', methods=['GET'])
@require_auth
def get_auto_discounts():
    """Получить список авто-скидок"""
    conn = database.get_db_connection()
    cursor = conn.cursor()
    
    try:
        cursor.execute("SELECT * FROM auto_discounts ORDER BY created_at DESC")
        rows = cursor.fetchall()
        discounts = []
        for row in rows:
            discounts.append({
                'id': row['id'],
                'name': row['name'],
                'condition_type': row['condition_type'],
                'condition_value': row['condition_value'],
                'discount_type': row['discount_type'],
                'discount_value': float(row['discount_value']),
                'is_active': bool(row['is_active'])
            })
        return jsonify(discounts)
    finally:
        conn.close()

@app.route('/api/panel/auto-discounts', methods=['POST'])
@require_auth
def create_auto_discount():
    """Создать правило авто-скидки"""
    data = request.json
    conn = database.get_db_connection()
    cursor = conn.cursor()
    
    try:
        cursor.execute("""
            INSERT INTO auto_discounts (name, condition_type, condition_value, discount_type, discount_value, is_active)
            VALUES (?, ?, ?, ?, ?, ?)
        """, (
            data.get('name'),
            data.get('condition_type'),
            data.get('condition_value'),
            data.get('discount_type'),
            data.get('discount_value'),
            1 if data.get('is_active', True) else 0
        ))
        conn.commit()
        discount_id = cursor.lastrowid
        cursor.execute("SELECT * FROM auto_discounts WHERE id = ?", (discount_id,))
        return jsonify({'success': True, 'discount': dict(cursor.fetchone())})
    finally:
        conn.close()

@app.route('/api/panel/auto-discounts/<int:discount_id>', methods=['PUT'])
@require_auth
def update_auto_discount(discount_id: int):
    """Обновить правило авто-скидки"""
    data = request.json
    conn = database.get_db_connection()
    cursor = conn.cursor()
    
    try:
        fields = []
        values = []
        for key in ['name', 'condition_type', 'condition_value', 'discount_type', 'discount_value', 'is_active']:
            if key in data:
                if key == 'is_active':
                    values.append(1 if data[key] else 0)
                else:
                    values.append(data[key])
                fields.append(f"{key} = ?")
        if not fields:
            return jsonify({'success': False, 'error': 'Nothing to update'}), 400
        values.append(discount_id)
        cursor.execute(f"UPDATE auto_discounts SET {', '.join(fields)}, updated_at = CURRENT_TIMESTAMP WHERE id = ?", tuple(values))
        conn.commit()
        cursor.execute("SELECT * FROM auto_discounts WHERE id = ?", (discount_id,))
        row = cursor.fetchone()
        if not row:
            return jsonify({'success': False, 'error': 'Discount not found'}), 404
        return jsonify({'success': True, 'discount': dict(row)})
    finally:
        conn.close()

@app.route('/api/panel/auto-discounts/<int:discount_id>', methods=['DELETE'])
@require_auth
def delete_auto_discount(discount_id: int):
    """Удалить правило авто-скидки"""
    conn = database.get_db_connection()
    cursor = conn.cursor()
    
    try:
        cursor.execute("DELETE FROM auto_discounts WHERE id = ?", (discount_id,))
        conn.commit()
        return jsonify({'success': True})
    finally:
        conn.close()

@app.route('/api/panel/public-pages', methods=['GET'])
@require_auth
def get_public_pages():
    """Получить публичные страницы"""
    conn = database.get_db_connection()
    cursor = conn.cursor()
    
    try:
        cursor.execute("SELECT * FROM public_pages")
        rows = cursor.fetchall()
        pages = {}
        for row in rows:
            pages[row['page_type']] = {
                'id': row['id'],
                'content': row['content'],
                'updated_at': row['updated_at']
            }
        return jsonify(pages)
    finally:
        conn.close()

@app.route('/api/panel/public-pages/<page_type>', methods=['PUT'])
@require_auth
def update_public_page(page_type: str):
    """Обновить публичную страницу"""
    data = request.json
    conn = database.get_db_connection()
    cursor = conn.cursor()
    
    try:
        cursor.execute("SELECT id FROM public_pages WHERE page_type = ?", (page_type,))
        row = cursor.fetchone()
        if row:
            cursor.execute("""
                UPDATE public_pages SET content = ?, updated_at = CURRENT_TIMESTAMP
                WHERE page_type = ?
            """, (data.get('content', ''), page_type))
        else:
            cursor.execute("""
                INSERT INTO public_pages (page_type, content)
                VALUES (?, ?)
            """, (page_type, data.get('content', '')))
        conn.commit()
        return jsonify({'success': True})
    finally:
        conn.close()

@app.route('/api/public-pages', methods=['GET'])
def get_all_public_pages():
    """Получить все публичные страницы (публичный эндпоинт для мини-приложения)"""
    conn = database.get_db_connection()
    cursor = conn.cursor()
    
    try:
        cursor.execute("SELECT page_type, content, updated_at FROM public_pages")
        rows = cursor.fetchall()
        pages = {}
        for row in rows:
            pages[row['page_type']] = {
                'content': row['content'],
                'updated_at': row['updated_at']
            }
        return jsonify(pages)
    finally:
        conn.close()


@app.route('/api/public-pages/<page_type>', methods=['GET'])
def get_public_page(page_type: str):
    """Получить публичную страницу (публичный эндпоинт для мини-приложения)"""
    conn = database.get_db_connection()
    cursor = conn.cursor()
    
    try:
        cursor.execute("SELECT content FROM public_pages WHERE page_type = ?", (page_type,))
        row = cursor.fetchone()
        if row:
            return jsonify({'content': row['content']})
        return jsonify({'content': ''})
    finally:
        conn.close()

@app.route('/api/panel/settings', methods=['GET'])
@require_auth
def get_settings():
    """Получить настройки системы"""
    conn = database.get_db_connection()
    cursor = conn.cursor()
    
    try:
        # Настройки из БД (кроме env-ключей)
        cursor.execute("SELECT setting_key, setting_value FROM system_settings")
        db_settings = {
            row['setting_key']: row['setting_value']
            for row in cursor.fetchall()
            if row['setting_key'] not in ENV_SETTINGS_KEYS
        }
        
        # Настройки из .env (без маскирования)
        env_raw = parse_env_file()
        env_settings = {
            # Читаем сначала из .env (включая legacy алиасы), затем из process env
            'TELEGRAM_BOT_TOKEN': env_raw.get('TELEGRAM_BOT_TOKEN', env_raw.get('BOT_TOKEN', os.getenv('TELEGRAM_BOT_TOKEN', os.getenv('BOT_TOKEN', '')))),
            'TELEGRAM_ADMIN_IDS': env_raw.get('TELEGRAM_ADMIN_IDS', env_raw.get('TELEGRAM_ADMIN_ID', os.getenv('TELEGRAM_ADMIN_IDS', os.getenv('TELEGRAM_ADMIN_ID', '')))),
            'REMWAVE_PANEL_URL': env_raw.get('REMWAVE_PANEL_URL', env_raw.get('REMNAWAVE_URL', os.getenv('REMWAVE_PANEL_URL', os.getenv('REMNAWAVE_URL', '')))),
            'REMWAVE_API_KEY': env_raw.get('REMWAVE_API_KEY', env_raw.get('REMNAWAVE_API_KEY', os.getenv('REMWAVE_API_KEY', os.getenv('REMNAWAVE_API_KEY', '')))),
            'PLATEGA_MERCHANT_ID': env_raw.get('PLATEGA_MERCHANT_ID', os.getenv('PLATEGA_MERCHANT_ID', '')),
            'PLATEGA_SECRET_KEY': env_raw.get('PLATEGA_SECRET_KEY', os.getenv('PLATEGA_SECRET_KEY', '')),
            'ROLLYPAY_API_KEY': env_raw.get('ROLLYPAY_API_KEY', os.getenv('ROLLYPAY_API_KEY', '')),
            'ROLLYPAY_SIGNING_SECRET': env_raw.get('ROLLYPAY_SIGNING_SECRET', os.getenv('ROLLYPAY_SIGNING_SECRET', '')),
            'HELEKET_MERCHANT': env_raw.get('HELEKET_MERCHANT', os.getenv('HELEKET_MERCHANT', '')),
            'HELEKET_API_KEY': env_raw.get('HELEKET_API_KEY', os.getenv('HELEKET_API_KEY', '')),
            'CRYPTOPAY_API_TOKEN': env_raw.get('CRYPTOPAY_API_TOKEN', os.getenv('CRYPTOPAY_API_TOKEN', '')),
            'CRYPTOBOT_API_TOKEN': env_raw.get('CRYPTOBOT_API_TOKEN', os.getenv('CRYPTOBOT_API_TOKEN', env_raw.get('CRYPTOPAY_API_TOKEN', os.getenv('CRYPTOPAY_API_TOKEN', '')))),
            'TELEGRAM_WEBHOOK_SECRET': env_raw.get('TELEGRAM_WEBHOOK_SECRET', os.getenv('TELEGRAM_WEBHOOK_SECRET', '')),
            'BOT_USERNAME': env_raw.get('BOT_USERNAME', os.getenv('BOT_USERNAME', '')),
            'PANEL_PASSWORD_HINT': 'Смена пароля доступна отдельным действием',
        }
        
        return jsonify({**db_settings, **env_settings})
    finally:
        conn.close()

@app.route('/api/panel/settings', methods=['PUT'])
@require_auth
def update_settings():
    """Обновить настройки системы"""
    data = request.json
    conn = database.get_db_connection()
    cursor = conn.cursor()
    
    try:
        # Обновляем настройки в БД только для не-env ключей
        for key, value in data.items():
            if key in ENV_SETTINGS_KEYS:
                continue
            cursor.execute("""
                INSERT OR REPLACE INTO system_settings (setting_key, setting_value, updated_at)
                VALUES (?, ?, CURRENT_TIMESTAMP)
            """, (key, str(value)))
            
        env_raw = parse_env_file()
        env_map = {
            'TELEGRAM_BOT_TOKEN': str(data.get('TELEGRAM_BOT_TOKEN', env_raw.get('TELEGRAM_BOT_TOKEN', env_raw.get('BOT_TOKEN', '')))),
            'TELEGRAM_ADMIN_IDS': str(data.get('TELEGRAM_ADMIN_IDS', env_raw.get('TELEGRAM_ADMIN_IDS', env_raw.get('TELEGRAM_ADMIN_ID', '')))),
            'REMWAVE_PANEL_URL': str(data.get('REMWAVE_PANEL_URL', env_raw.get('REMWAVE_PANEL_URL', env_raw.get('REMNAWAVE_URL', '')))),
            'REMWAVE_API_KEY': str(data.get('REMWAVE_API_KEY', env_raw.get('REMWAVE_API_KEY', env_raw.get('REMNAWAVE_API_KEY', '')))),
            'PLATEGA_MERCHANT_ID': str(data.get('PLATEGA_MERCHANT_ID', env_raw.get('PLATEGA_MERCHANT_ID', ''))),
            'PLATEGA_SECRET_KEY': str(data.get('PLATEGA_SECRET_KEY', env_raw.get('PLATEGA_SECRET_KEY', ''))),
            'ROLLYPAY_API_KEY': str(data.get('ROLLYPAY_API_KEY', env_raw.get('ROLLYPAY_API_KEY', ''))),
            'ROLLYPAY_SIGNING_SECRET': str(data.get('ROLLYPAY_SIGNING_SECRET', env_raw.get('ROLLYPAY_SIGNING_SECRET', ''))),
            'HELEKET_MERCHANT': str(data.get('HELEKET_MERCHANT', env_raw.get('HELEKET_MERCHANT', ''))),
            'HELEKET_API_KEY': str(data.get('HELEKET_API_KEY', env_raw.get('HELEKET_API_KEY', ''))),
            'CRYPTOPAY_API_TOKEN': str(data.get('CRYPTOPAY_API_TOKEN', env_raw.get('CRYPTOPAY_API_TOKEN', env_raw.get('CRYPTOBOT_API_TOKEN', '')))),
            'CRYPTOBOT_API_TOKEN': str(data.get('CRYPTOBOT_API_TOKEN', env_raw.get('CRYPTOBOT_API_TOKEN', data.get('CRYPTOPAY_API_TOKEN', env_raw.get('CRYPTOPAY_API_TOKEN', ''))))),
            'TELEGRAM_WEBHOOK_SECRET': str(data.get('TELEGRAM_WEBHOOK_SECRET', env_raw.get('TELEGRAM_WEBHOOK_SECRET', ''))),
            'BOT_USERNAME': str(data.get('BOT_USERNAME', env_raw.get('BOT_USERNAME', ''))),
        }
        # Совместимость legacy переменных
        env_map['BOT_TOKEN'] = env_map['TELEGRAM_BOT_TOKEN']
        env_map['REMNAWAVE_URL'] = env_map['REMWAVE_PANEL_URL']
        env_map['REMNAWAVE_API_KEY'] = env_map['REMWAVE_API_KEY']
        admin_ids_str = env_map['TELEGRAM_ADMIN_IDS'].strip()
        env_map['TELEGRAM_ADMIN_ID'] = admin_ids_str.split(',')[0].strip() if admin_ids_str else ''
        update_env_values(env_map)
        
        conn.commit()
        env_after = parse_env_file()
        return jsonify({'success': True, 'env': env_after})
    except Exception as e:
        logger.error(f"Error updating settings: {e}")
        return jsonify({'error': str(e)}), 500
    finally:
        conn.close()

@app.route('/api/panel/default-squads', methods=['GET'])
@require_auth
def get_default_squads():
    """Получить список сквадов по умолчанию для подписок"""
    vpn_squads = database.get_default_squads('vpn')
    whitelist_squads = database.get_default_squads('whitelist')
    return jsonify({
        'vpn_squads': vpn_squads,
        'whitelist_squads': whitelist_squads
    })

@app.route('/api/panel/default-squads', methods=['PUT'])
@require_auth
def set_default_squads():
    """Установить список сквадов по умолчанию для подписок"""
    data = request.json
    vpn_squads = data.get('vpn_squads', [])
    whitelist_squads = data.get('whitelist_squads', [])
    
    if not isinstance(vpn_squads, list) or not isinstance(whitelist_squads, list):
        return jsonify({'error': 'squads должен быть массивом UUID'}), 400
    
    success_vpn = database.set_default_squads(vpn_squads, 'vpn')
    success_whitelist = database.set_default_squads(whitelist_squads, 'whitelist')
    
    if success_vpn and success_whitelist:
        return jsonify({
            'success': True, 
            'vpn_squads': vpn_squads,
            'whitelist_squads': whitelist_squads
        })
    return jsonify({'error': 'Ошибка сохранения настроек'}), 500

@app.route('/api/panel/payment-fees', methods=['GET'])
@require_auth
def get_payment_fees():
    """Получить комиссии платежных систем"""
    conn = database.get_db_connection()
    cursor = conn.cursor()
    
    try:
        cursor.execute("SELECT * FROM payment_fees")
        rows = cursor.fetchall()
        fees = {}
        for row in rows:
            fees[row['payment_method']] = {
                'fee_percent': float(row['fee_percent']),
                'fee_fixed': float(row['fee_fixed'])
            }
        return jsonify(fees)
    finally:
        conn.close()

@app.route('/api/panel/payment-fees', methods=['PUT'])
@require_auth
def update_payment_fees():
    """Обновить комиссии платежных систем"""
    data = request.json
    conn = database.get_db_connection()
    cursor = conn.cursor()
    
    try:
        for method, fees in data.items():
            cursor.execute("""
                INSERT OR REPLACE INTO payment_fees (payment_method, fee_percent, fee_fixed, updated_at)
                VALUES (?, ?, ?, CURRENT_TIMESTAMP)
            """, (method, fees.get('fee_percent', 0), fees.get('fee_fixed', 0)))
        conn.commit()
        return jsonify({'success': True})
    finally:
        conn.close()

@app.route('/api/panel/payment-settings', methods=['GET'])
@require_auth
def get_payment_settings():
    """Получить настройки платежных систем"""
    conn = database.get_db_connection()
    cursor = conn.cursor()
    
    try:
        cursor.execute("SELECT * FROM payment_provider_settings")
        rows = cursor.fetchall()
        settings = {}
        for row in rows:
            provider = row['provider']
            if provider not in settings:
                settings[provider] = {}
            settings[provider][row['setting_key']] = row['setting_value']
        
        # Заполняем пустыми значениями если нет в БД
        providers = ['heleket', 'platega', 'cryptobot']
        for p in providers:
            if p not in settings:
                settings[p] = {'enabled': '0'}
        
        return jsonify(settings)
    finally:
        conn.close()

@app.route('/api/panel/payment-settings/<provider>', methods=['PUT'])
@require_auth
def update_payment_settings(provider: str):
    """Обновить настройки платежной системы"""
    data = request.json
    conn = database.get_db_connection()
    cursor = conn.cursor()
    
    try:
        for key, value in data.items():
            # Upsert: INSERT OR REPLACE
            cursor.execute("""
                INSERT OR REPLACE INTO payment_provider_settings (provider, setting_key, setting_value, updated_at)
                VALUES (?, ?, ?, CURRENT_TIMESTAMP)
            """, (provider, key, str(value)))
        conn.commit()
        
        # Обновляем переменные окружения в памяти (опционально)
        # Это позволит применить настройки без перезапуска
        if provider == 'heleket':
            if 'merchant' in data:
                os.environ['HELEKET_MERCHANT'] = str(data['merchant'])
            if 'api_key' in data:
                os.environ['HELEKET_API_KEY'] = str(data['api_key'])
        elif provider == 'platega':
            if 'merchant_id' in data:
                os.environ['PLATEGA_MERCHANT_ID'] = str(data['merchant_id'])
            if 'secret_key' in data:
                os.environ['PLATEGA_SECRET_KEY'] = str(data['secret_key'])
        elif provider == 'cryptobot':
            if 'api_token' in data:
                token = str(data['api_token'])
                os.environ['CRYPTOPAY_API_TOKEN'] = token
                os.environ['CRYPTOBOT_API_TOKEN'] = token

        # Persist payment settings to .env automatically
        env_updates: dict[str, str] = {}
        if provider == 'heleket':
            if 'merchant' in data:
                env_updates['HELEKET_MERCHANT'] = str(data['merchant'])
            if 'api_key' in data:
                env_updates['HELEKET_API_KEY'] = str(data['api_key'])
        elif provider == 'platega':
            if 'merchant_id' in data:
                env_updates['PLATEGA_MERCHANT_ID'] = str(data['merchant_id'])
            if 'secret_key' in data:
                env_updates['PLATEGA_SECRET_KEY'] = str(data['secret_key'])
        elif provider == 'cryptobot':
            if 'api_token' in data:
                env_updates['CRYPTOPAY_API_TOKEN'] = str(data['api_token'])
                env_updates['CRYPTOBOT_API_TOKEN'] = str(data['api_token'])

        if env_updates:
            update_env_values(env_updates)
        
        return jsonify({'success': True})
    except Exception as e:
        logger.error(f"Error updating payment settings for {provider}: {e}")
        return jsonify({'error': str(e)}), 500
    finally:
        conn.close()

@app.route('/api/panel/backups/status', methods=['GET'])
@require_auth
def get_backup_status():
    """Получить статус резервного копирования"""
    conn = database.get_db_connection()
    cursor = conn.cursor()
    
    try:
        cursor.execute("SELECT * FROM backup_settings ORDER BY id DESC LIMIT 1")
        row = cursor.fetchone()
        if row:
            return jsonify({
                'enabled': bool(row['enabled']),
                'interval_hours': row['interval_hours'],
                'last_backup': row['last_backup']
            })
        return jsonify({
            'enabled': False,
            'interval_hours': 12,
            'last_backup': None
        })
    finally:
        conn.close()


@app.route('/api/panel/backups/settings', methods=['PUT'])
@require_auth
def update_backup_settings():
    """Обновить настройки резервного копирования"""
    data = request.json
    conn = database.get_db_connection()
    cursor = conn.cursor()
    
    try:
        cursor.execute("SELECT id FROM backup_settings ORDER BY id DESC LIMIT 1")
        row = cursor.fetchone()
        if row:
            cursor.execute("""
                UPDATE backup_settings SET enabled = ?, interval_hours = ?, updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
            """, (1 if data.get('enabled') else 0, data.get('interval_hours', 12), row['id']))
        else:
            cursor.execute("""
                INSERT INTO backup_settings (enabled, interval_hours)
                VALUES (?, ?)
            """, (1 if data.get('enabled') else 0, data.get('interval_hours', 12)))
        conn.commit()
        return jsonify({'success': True})
    finally:
        conn.close()


@app.route('/api/panel/backups/create', methods=['POST'])
@require_auth
def create_backup():
    """Создать резервную копию и отправить администратору"""
    import os
    import shutil
    import tempfile
    from datetime import datetime
    
    try:
        # Используем тот же путь что и в database.py
        db_path = os.getenv('DB_PATH', 'data.db')
        
        # Если путь относительный, делаем его абсолютным
        if not os.path.isabs(db_path):
            db_path = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), db_path)
        
        if not os.path.exists(db_path):
            return jsonify({'error': 'Database file not found'}), 404
        
        # Создаем временный файл с копией БД
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        backup_name = f'blinvpn_backup_{timestamp}.db'
        
        with tempfile.TemporaryDirectory() as temp_dir:
            backup_path = os.path.join(temp_dir, backup_name)
            shutil.copy2(db_path, backup_path)
            
            # Создаем zip архив
            zip_path = os.path.join(temp_dir, f'{backup_name}.zip')
            shutil.make_archive(backup_path, 'zip', temp_dir, backup_name)
            
            # Отправляем файл администраторам
            admin_ids = get_admin_ids()
            bot_token = os.getenv('TELEGRAM_BOT_TOKEN')
            
            if admin_ids and bot_token:
                import requests
                with open(f'{backup_path}.zip', 'rb') as f:
                    archive_payload = f.read()
                for admin_id in admin_ids:
                    url = f"https://api.telegram.org/bot{bot_token}/sendDocument"
                    response = requests.post(
                        url,
                        data={
                            'chat_id': admin_id,
                            'caption': f'🗄️ Резервная копия БД\n📅 {datetime.now().strftime("%d.%m.%Y %H:%M")}'
                        },
                        files={'document': (f'{backup_name}.zip', archive_payload, 'application/zip')},
                        timeout=30
                    )
                    if response.status_code != 200:
                        logger.error(f"Failed to send backup to {admin_id}: {response.text}")
        
        # Обновляем время последнего бекапа
        conn = database.get_db_connection()
        cursor = conn.cursor()
        try:
            cursor.execute("UPDATE backup_settings SET last_backup = CURRENT_TIMESTAMP")
            conn.commit()
        finally:
            conn.close()
        
        return jsonify({'success': True})
    except Exception as e:
        logger.error(f"Backup creation error: {e}")
        return jsonify({'error': str(e)}), 500


@app.route('/api/panel/remnawave/squads', methods=['GET'])
@require_auth
def get_remnawave_squads():
    """Получить список сквадов из Remnawave"""
    try:
        import asyncio
        from src.api.remnawave import get_remnawave_api, RemnaWaveAPI
        
        async def fetch_squads():
            api = get_remnawave_api()
            async with api as connected_api:
                internal_squads = await connected_api.get_internal_squads()
                return [{
                    'uuid': s.uuid,
                    'name': s.name,
                    'members_count': s.members_count,
                    'inbounds_count': s.inbounds_count,
                } for s in internal_squads]
        
        squads = asyncio.run(fetch_squads())
        # Убираем дубликаты по UUID
        seen_uuids = set()
        unique_squads = []
        for sq in squads:
            if sq['uuid'] not in seen_uuids:
                seen_uuids.add(sq['uuid'])
                unique_squads.append(sq)
        return jsonify(unique_squads)
    except Exception as e:
        logger.error(f"Error fetching Remnawave squads: {e}")
        return jsonify({'error': str(e)}), 500


@app.route('/api/panel/remnawave/sync', methods=['POST'])
@require_auth
def sync_remnawave_keys():
    """Синхронизировать ключи с Remnawave - удалить из БД ключи, которых нет в Remnawave"""
    try:
        result = core.sync_keys_with_remnawave()
        return jsonify(result)
    except Exception as e:
        logger.error(f"Error syncing with Remnawave: {e}")
        return jsonify({'error': str(e)}), 500


@app.route('/api/panel/users/mass-action', methods=['POST'])
@require_auth
def mass_user_action():
    """Массовые действия над пользователями"""
    data = request.get_json()
    action_type = data.get('action')
    value = data.get('value', '')
    notify = data.get('notify', False)
    user_ids = data.get('user_ids', [])  # Если пустой - применить ко всем
    
    conn = database.get_db_connection()
    cursor = conn.cursor()
    
    try:
        # Получаем список пользователей
        if user_ids:
            placeholders = ','.join('?' * len(user_ids))
            cursor.execute(f"SELECT id, telegram_id, balance FROM users WHERE id IN ({placeholders})", user_ids)
        else:
            cursor.execute("SELECT id, telegram_id, balance FROM users")
        users = cursor.fetchall()
        
        affected = 0
        notifications = []
        
        for user in users:
            user_id = user['id']
            telegram_id = user['telegram_id']
            
            if action_type == 'MASS_ADD_BALANCE':
                amount = float(value)
                cursor.execute("UPDATE users SET balance = balance + ? WHERE id = ?", (amount, user_id))
                cursor.execute("""
                    INSERT INTO transactions (user_id, amount, type, status, description)
                    VALUES (?, ?, 'deposit', 'Success', 'Начисление от администрации')
                """, (user_id, amount))
                if notify:
                    notifications.append((telegram_id, notify_msgs.build_admin_balance_add_message(amount)))
                affected += 1
                
            elif action_type == 'MASS_ADD_DAYS':
                days = int(value)
                cursor.execute("""
                    UPDATE vpn_keys SET expiry_date = datetime(
                        CASE WHEN expiry_date > datetime('now') THEN expiry_date ELSE datetime('now') END,
                        '+' || ? || ' days'
                    ) WHERE user_id = ?
                """, (days, user_id))
                if notify:
                    notifications.append((telegram_id, notify_msgs.build_admin_subscription_extended_message(days)))
                affected += 1
                
            elif action_type == 'MASS_BAN':
                cursor.execute("UPDATE users SET is_banned = 1, ban_reason = ? WHERE id = ?", (value or 'Аккаунт заблокирован', user_id))
                if notify:
                    notifications.append((telegram_id, notify_msgs.build_ban_message((value or '').strip() or None)))
                affected += 1
                
            elif action_type == 'MASS_UNBAN':
                cursor.execute("UPDATE users SET is_banned = 0 WHERE id = ?", (user_id,))
                if notify:
                    notifications.append((telegram_id, notify_msgs.build_unban_message()))
                affected += 1
                
            elif action_type == 'MASS_RESET_TRIAL':
                cursor.execute("UPDATE users SET trial_used = 0 WHERE id = ?", (user_id,))
                if notify:
                    notifications.append((telegram_id, notify_msgs.build_trial_reset_message()))
                affected += 1
                
            elif action_type == 'MASS_DELETE_KEYS':
                cursor.execute("DELETE FROM vpn_keys WHERE user_id = ?", (user_id,))
                if notify:
                    notifications.append((telegram_id, notify_msgs.build_keys_deleted_by_admin_message()))
                affected += 1
                
            elif action_type == 'MASS_SET_PARTNER':
                rate = int(value) if value else 25
                cursor.execute("UPDATE users SET is_partner = 1, partner_rate = ? WHERE id = ?", (rate, user_id))
                if notify:
                    notifications.append((telegram_id, notify_msgs.build_partner_enabled_message(rate)))
                affected += 1
                
            elif action_type == 'MASS_REMOVE_PARTNER':
                cursor.execute("UPDATE users SET is_partner = 0, partner_rate = 0 WHERE id = ?", (user_id,))
                if notify:
                    notifications.append((telegram_id, notify_msgs.build_partner_disabled_message()))
                affected += 1
        
        conn.commit()
        
        # Отправляем уведомления через бота (асинхронно)
        if notifications:
            from threading import Thread
            def send_notifications():
                import asyncio
                from aiogram import Bot
                bot = Bot(token=os.getenv('TELEGRAM_BOT_TOKEN', ''))
                async def send_all():
                    for tg_id, msg in notifications:
                        try:
                            await bot.send_message(tg_id, msg)
                        except Exception as e:
                            logger.warning(f"Failed to send notification to {tg_id}: {e}")
                    await bot.session.close()
                asyncio.run(send_all())
            Thread(target=send_notifications, daemon=True).start()
        
        return jsonify({'success': True, 'affected': affected})
    except Exception as e:
        conn.rollback()
        logger.error(f"Mass action error: {e}")
        return jsonify({'error': str(e)}), 500
    finally:
        conn.close()


@app.route('/api/panel/users/<int:user_id>/action', methods=['POST'])
@require_auth
def single_user_action(user_id):
    """Действия над одним пользователем"""
    data = request.get_json()
    action_type = data.get('action')
    value = data.get('value', '')
    notify = data.get('notify', False)
    subscription_id = data.get('subscription_id')
    
    conn = database.get_db_connection()
    cursor = conn.cursor()
    
    try:
        cursor.execute("SELECT telegram_id, balance FROM users WHERE id = ?", (user_id,))
        user = cursor.fetchone()
        if not user:
            return jsonify({'error': 'User not found'}), 404
        
        telegram_id = user['telegram_id']
        notification_msg = None
        
        selected_sub = None
        if subscription_id:
            cursor.execute("""
                SELECT id, key_uuid, expiry_date
                FROM vpn_keys
                WHERE id = ? AND user_id = ?
            """, (subscription_id, user_id))
            selected_sub = cursor.fetchone()
            if not selected_sub and action_type in {'EXTEND_SUB', 'REDUCE_SUB', 'SET_TRAFFIC', 'SET_DEVICES'}:
                return jsonify({'error': 'Subscription not found'}), 404
        elif action_type in {'EXTEND_SUB', 'REDUCE_SUB', 'SET_TRAFFIC', 'SET_DEVICES'}:
            return jsonify({'error': 'subscription_id required'}), 400

        if action_type == 'ADD_BALANCE':
            amount = float(value)
            cursor.execute("UPDATE users SET balance = balance + ? WHERE id = ?", (amount, user_id))
            cursor.execute("""
                INSERT INTO transactions (user_id, amount, type, status, description)
                VALUES (?, ?, 'deposit', 'Success', 'Начисление от администрации')
            """, (user_id, amount))
            notification_msg = notify_msgs.build_admin_balance_add_message(amount)
            
        elif action_type == 'SUB_BALANCE':
            amount = float(value)
            cursor.execute("UPDATE users SET balance = balance - ? WHERE id = ?", (amount, user_id))
            cursor.execute("""
                INSERT INTO transactions (user_id, amount, type, status, description)
                VALUES (?, ?, 'withdrawal', 'Success', 'Списание администрацией')
            """, (user_id, -amount))
            notification_msg = notify_msgs.build_admin_balance_sub_message(amount)
            
        elif action_type == 'EXTEND_SUB':
            days = int(value)
            sub_id = selected_sub['id']
            expiry_src = selected_sub['expiry_date']
            expiry_dt = None
            try:
                if expiry_src:
                    expiry_dt = datetime.fromisoformat(str(expiry_src).replace('Z', '+00:00').replace('+00:00', ''))
            except Exception:
                expiry_dt = None
            base = expiry_dt if expiry_dt and expiry_dt > datetime.utcnow() else datetime.utcnow()
            new_expiry = base + timedelta(days=days)
            cursor.execute("UPDATE vpn_keys SET expiry_date = ?, status = 'Active' WHERE id = ?", (new_expiry.isoformat(), sub_id))
            if selected_sub['key_uuid']:
                try:
                    remnawave.remnawave_api.update_user_sync(
                        uuid=selected_sub['key_uuid'],
                        expire_at=new_expiry,
                        status=remnawave.UserStatus.ACTIVE,
                    )
                except Exception as e:
                    logger.error(f"Failed to extend key in Remnawave: {e}")
            notification_msg = notify_msgs.build_admin_subscription_extended_message(days)
            
        elif action_type == 'REDUCE_SUB':
            days = int(value)
            sub_id = selected_sub['id']
            expiry_src = selected_sub['expiry_date']
            expiry_dt = None
            try:
                if expiry_src:
                    expiry_dt = datetime.fromisoformat(str(expiry_src).replace('Z', '+00:00').replace('+00:00', ''))
            except Exception:
                expiry_dt = None
            base = expiry_dt if expiry_dt else datetime.utcnow()
            new_expiry = base - timedelta(days=days)
            cursor.execute("UPDATE vpn_keys SET expiry_date = ? WHERE id = ?", (new_expiry.isoformat(), sub_id))
            if selected_sub['key_uuid']:
                try:
                    remnawave.remnawave_api.update_user_sync(
                        uuid=selected_sub['key_uuid'],
                        expire_at=new_expiry,
                    )
                except Exception as e:
                    logger.error(f"Failed to reduce key expiry in Remnawave: {e}")
            notification_msg = notify_msgs.build_admin_subscription_reduced_message(days)
            
        elif action_type == 'SET_TRAFFIC':
            limit_gb = int(value)
            bytes_limit = limit_gb * 1024 * 1024 * 1024
            cursor.execute("UPDATE vpn_keys SET traffic_limit = ? WHERE id = ?", (bytes_limit, selected_sub['id']))
            if selected_sub['key_uuid']:
                try:
                    remnawave.remnawave_api.update_user_sync(
                        uuid=selected_sub['key_uuid'],
                        traffic_limit_bytes=bytes_limit,
                    )
                except Exception as e:
                    logger.error(f"Failed to set key traffic in Remnawave: {e}")
            notification_msg = notify_msgs.build_admin_traffic_limit_message(limit_gb)
            
        elif action_type == 'SET_DEVICES':
            limit = int(value)
            cursor.execute("UPDATE vpn_keys SET devices_limit = ? WHERE id = ?", (limit, selected_sub['id']))
            if selected_sub['key_uuid']:
                try:
                    remnawave.remnawave_api.update_user_sync(
                        uuid=selected_sub['key_uuid'],
                        hwid_device_limit=limit,
                    )
                except Exception as e:
                    logger.error(f"Failed to set key devices in Remnawave: {e}")
            notification_msg = notify_msgs.build_admin_devices_limit_message(limit)

        elif action_type == 'SET_PARTNER_RATE':
            new_rate = int(value)
            if new_rate < 0 or new_rate > 100:
                return jsonify({'error': 'Invalid partner rate'}), 400
            cursor.execute("UPDATE users SET is_partner = 1, partner_rate = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", (new_rate, user_id))
            notification_msg = notify_msgs.build_partner_rate_message(new_rate)

        elif action_type == 'SET_SECOND_LEVEL_RATE':
            new_rate = int(value)
            if new_rate < 0 or new_rate > 100:
                return jsonify({'error': 'Invalid second level rate'}), 400
            cursor.execute("UPDATE users SET is_partner = 1, second_level_rate = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", (new_rate, user_id))
            notification_msg = notify_msgs.build_second_level_rate_message(new_rate)

        elif action_type == 'SET_THIRD_LEVEL_RATE':
            new_rate = int(value)
            if new_rate < 0 or new_rate > 100:
                return jsonify({'error': 'Invalid third level rate'}), 400
            cursor.execute("UPDATE users SET is_partner = 1, third_level_rate = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", (new_rate, user_id))
            notification_msg = notify_msgs.build_third_level_rate_message(new_rate)
            
        elif action_type == 'BAN':
            ban_reason = (value or '').strip() or None
            cursor.execute(
                "UPDATE users SET is_banned = 1, ban_reason = ? WHERE id = ?",
                (ban_reason or 'Аккаунт заблокирован', user_id),
            )
            notification_msg = notify_msgs.build_ban_message(ban_reason)
            
        elif action_type == 'UNBAN':
            cursor.execute("UPDATE users SET is_banned = 0, ban_reason = NULL WHERE id = ?", (user_id,))
            # Также удаляем из черного списка
            cursor.execute("DELETE FROM blacklist WHERE telegram_id = ?", (telegram_id,))
            notification_msg = notify_msgs.build_unban_message()
            
        elif action_type == 'NOTIFY':
            notification_msg = value
        
        conn.commit()
        
        # Отправляем уведомление
        if notify and notification_msg:
            from threading import Thread
            def send_notification():
                import asyncio
                from aiogram import Bot
                bot = Bot(token=os.getenv('TELEGRAM_BOT_TOKEN', ''))
                async def send():
                    try:
                        await bot.send_message(telegram_id, notification_msg)
                    except Exception as e:
                        logger.warning(f"Failed to send notification: {e}")
                    await bot.session.close()
                asyncio.run(send())
            Thread(target=send_notification, daemon=True).start()
        
        return jsonify({'success': True})
    except Exception as e:
        conn.rollback()
        logger.error(f"User action error: {e}")
        return jsonify({'error': str(e)}), 500
    finally:
        conn.close()


# ========== Авторизация панели (логин/пароль) ==========

@app.route('/api/panel/auth/login', methods=['POST'])
def panel_login():
    """Авторизация в панели по логину и паролю"""
    data = request.json
    username = data.get('username')
    password = data.get('password')
    ip_address = get_client_ip()

    # Brute-force protection: 5 failures -> 15 min block
    block_state = database.panel_is_ip_blocked(ip_address)
    if block_state.get("blocked"):
        return jsonify({
            "error": "Too many failed attempts. Try later.",
            "blocked_until": block_state.get("blocked_until"),
        }), 429
    
    if not username or not password:
        return jsonify({'error': 'Username and password required'}), 400
    
    admin = database.verify_panel_admin(username, password)
    if not admin:
        database.panel_record_login_failure(ip_address, max_attempts=5, block_minutes=15)
        return jsonify({'error': 'Invalid credentials'}), 401

    # success -> reset failures
    database.panel_reset_login_failures(ip_address)
    
    code = f"{random.randint(100000, 999999)}"
    temp_token = secrets.token_urlsafe(24)
    user_agent = request.headers.get('User-Agent', '')[:255]
    expires_at = (datetime.utcnow() + timedelta(minutes=10)).isoformat()
    conn = database.get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute(
            "UPDATE panel_login_challenges SET used = 1 WHERE admin_id = ? AND used = 0",
            (admin['id'],),
        )
        cursor.execute(
            """
            INSERT INTO panel_login_challenges (admin_id, temp_token, code, ip_address, user_agent, expires_at, used)
            VALUES (?, ?, ?, ?, ?, ?, 0)
            """,
            (admin['id'], temp_token, code, ip_address, user_agent, expires_at),
        )
        conn.commit()
    finally:
        conn.close()

    for tg_admin_id in get_admin_ids():
        core.send_notification_to_user(
            tg_admin_id,
            notify_msgs.build_panel_login_2fa_message(
                code,
                ip_address,
                admin['username'],
                datetime.utcnow().strftime('%d.%m.%Y %H:%M:%S'),
            ),
        )

    return jsonify({
        'success': True,
        'requires_2fa': True,
        'temp_token': temp_token,
        'username': admin['username'],
    })


@app.route('/api/panel/auth/verify-code', methods=['POST'])
def panel_verify_login_code():
    """Подтверждение входа по коду из Telegram"""
    data = request.json or {}
    temp_token = str(data.get('temp_token', ''))
    code = str(data.get('code', '')).strip()
    if not temp_token or not code:
        return jsonify({'error': 'temp_token and code required'}), 400

    conn = database.get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute(
            """
            SELECT * FROM panel_login_challenges
            WHERE temp_token = ? AND used = 0 AND expires_at > CURRENT_TIMESTAMP
            ORDER BY id DESC LIMIT 1
            """,
            (temp_token,),
        )
        challenge = cursor.fetchone()
        if not challenge:
            return jsonify({'error': 'Challenge expired or invalid'}), 401
        if str(challenge['code']) != code:
            return jsonify({'error': 'Invalid verification code'}), 401

        cursor.execute("UPDATE panel_login_challenges SET used = 1 WHERE id = ?", (challenge['id'],))
        conn.commit()
        session_token = database.create_panel_session(challenge['admin_id'])
    finally:
        conn.close()

    if not session_token:
        return jsonify({'error': 'Failed to create session'}), 500
    database.clear_panel_pending_initial_credentials()
    return jsonify({'success': True, 'session_token': session_token})


@app.route('/api/panel/auth/logout', methods=['POST'])
def panel_logout():
    """Выход из панели"""
    auth_header = request.headers.get('Authorization')
    if auth_header and auth_header.startswith('Bearer '):
        token = auth_header[7:]
        database.delete_panel_session(token)
    return jsonify({'success': True})


@app.route('/api/panel/auth/check', methods=['GET'])
def panel_auth_check():
    """Проверка авторизации (для клиента)"""
    auth_header = request.headers.get('Authorization')
    if not auth_header or not auth_header.startswith('Bearer '):
        return jsonify({'authenticated': False}), 401
    
    token = auth_header[7:]
    
    # Сессия
    session = database.verify_panel_session(token)
    if session:
        return jsonify({
            'authenticated': True, 
            'method': 'session',
            'username': session['username']
        })
    
    return jsonify({'authenticated': False}), 401


@app.route('/api/panel/auth/init', methods=['GET'])
def panel_auth_init():
    """
    Получить информацию об инициализации авторизации.
    При первом запуске создаёт дефолтного админа и возвращает пароль.
    """
    result = database.get_or_create_default_admin()
    
    if result.get('password'):
        is_new = not result.get('exists')
        msg = 'Сохраните эти данные! Пароль показывается до первой успешной авторизации.'
        if result.get('password_regenerated'):
            msg = (
                'Пароль был сброшен (первый вход ещё не выполнен). '
                'Используйте новый пароль ниже — он показывается до первой успешной авторизации.'
            )
        return jsonify({
            'initialized': True,
            'show_credentials': True,
            'new_admin': is_new,
            'pending_login': bool(result.get('pending')),
            'password_regenerated': bool(result.get('password_regenerated')),
            'username': result['username'],
            'password': result['password'],
            'message': msg,
        })
    elif result.get('exists'):
        return jsonify({
            'initialized': True,
            'show_credentials': False,
            'new_admin': False,
            'username': result['username']
        })
    else:
        return jsonify({'initialized': False, 'error': 'Failed to initialize admin'}), 500


@app.route('/api/panel/auth/change-password', methods=['POST'])
@require_auth
def panel_change_password():
    """Смена пароля администратора"""
    auth_header = request.headers.get('Authorization')
    token = auth_header[7:] if auth_header and auth_header.startswith('Bearer ') else None
    
    session = database.verify_panel_session(token) if token else None
    if not session:
        return jsonify({'error': 'Session required for password change'}), 403
    
    data = request.json or {}
    new_password = (data.get('new_password') or data.get('password') or '').strip()
    
    if len(new_password) < 6:
        return jsonify({'error': 'Password must be at least 6 characters'}), 400
    
    admin_id = session.get('admin_id')

    if admin_id and database.update_admin_password(admin_id, new_password):
        return jsonify({'success': True})
    return jsonify({'error': 'Failed to update password'}), 500


# ========== Управление сквадами ==========

def _guess_squad_type(name: str) -> str:
    name_lower = name.lower()
    if 'trial' in name_lower or 'test' in name_lower:
        return 'trial'
    if 'whitelist' in name_lower or 'lte' in name_lower:
        return 'whitelist'
    if 'vpn' in name_lower or 'wifi' in name_lower:
        return 'vpn'
    return 'vpn'


async def _fetch_remnawave_squads():
    api = remnawave.get_remnawave_api()
    async with api as rw_api:
        return await rw_api.get_internal_squads()


def _merge_squads_with_local_config(rw_squads) -> list:
    local_by_uuid = {c['squad_uuid']: c for c in database.get_all_squad_configs()}
    merged = []
    for squad in rw_squads:
        local = local_by_uuid.get(squad.uuid, {})
        merged.append({
            'id': local.get('id', 0),
            'squad_uuid': squad.uuid,
            'squad_name': squad.name,
            'squad_type': local.get('squad_type') or _guess_squad_type(squad.name),
            'max_users': local.get('max_users', 0),
            'current_users': squad.members_count,
            'inbounds_count': squad.inbounds_count,
            'is_active': bool(local.get('is_active', 1)),
            'priority': local.get('priority', squad.view_position),
        })
    return merged


def _persist_remnawave_squads(rw_squads) -> None:
    """Обновить локальную БД актуальными данными Remnawave для балансировщика."""
    synced_uuids = []
    for squad in rw_squads:
        database.sync_remnawave_squad(
            squad_uuid=squad.uuid,
            squad_name=squad.name,
            squad_type=_guess_squad_type(squad.name),
            priority=squad.view_position,
            members_count=squad.members_count,
        )
        synced_uuids.append(squad.uuid)
    database.delete_squads_not_in(synced_uuids)


@app.route('/api/panel/squads', methods=['GET'])
@require_auth
def get_squads():
    """Получить сквады из Remnawave с локальными настройками балансировщика"""
    try:
        import asyncio
        rw_squads = asyncio.run(_fetch_remnawave_squads())
        _persist_remnawave_squads(rw_squads)
        squads = _merge_squads_with_local_config(rw_squads)
        existing_uuids = {squad.uuid for squad in rw_squads}
        mapping = database.get_subscription_squad_mapping()
        filtered_mapping = {
            key: [uuid for uuid in uuids if uuid in existing_uuids]
            for key, uuids in mapping.items()
        }
        return jsonify({
            'squads': squads,
            'mapping': filtered_mapping
        })
    except Exception as e:
        logger.error(f"Error fetching squads from Remnawave: {e}")
        return jsonify({'error': f'Не удалось загрузить сквады из Remnawave: {e}'}), 500


@app.route('/api/panel/squads/sync', methods=['POST'])
@require_auth
def sync_squads():
    """Синхронизировать сквады с Remnawave"""
    try:
        import asyncio
        
        async def do_sync():
            rw_squads = await _fetch_remnawave_squads()
            _persist_remnawave_squads(rw_squads)
            return [{
                'uuid': squad.uuid,
                'name': squad.name,
                'type': _guess_squad_type(squad.name),
                'members_count': squad.members_count,
            } for squad in rw_squads]
        
        synced = asyncio.run(do_sync())
        return jsonify({
            'success': True,
            'synced': synced,
            'count': len(synced)
        })
    except Exception as e:
        logger.error(f"Squad sync error: {e}")
        return jsonify({'error': str(e)}), 500


@app.route('/api/panel/squads/<squad_uuid>', methods=['PUT'])
@require_auth
def update_squad(squad_uuid: str):
    """Обновить настройки сквада"""
    data = request.json
    
    squad_name = data.get('squad_name')
    squad_type = data.get('squad_type')
    max_users = data.get('max_users', 0)
    priority = data.get('priority', 0)
    is_active = data.get('is_active', True)
    
    if not squad_name or not squad_type:
        return jsonify({'error': 'squad_name and squad_type required'}), 400
    
    conn = database.get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("""
            UPDATE squad_configs 
            SET squad_name = ?, squad_type = ?, max_users = ?, 
                priority = ?, is_active = ?, updated_at = CURRENT_TIMESTAMP
            WHERE squad_uuid = ?
        """, (squad_name, squad_type, max_users, priority, 1 if is_active else 0, squad_uuid))
        conn.commit()
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'error': str(e)}), 500
    finally:
        conn.close()


@app.route('/api/panel/squads/mapping', methods=['PUT'])
@require_auth
def update_squad_mapping():
    """Обновить привязку сквадов к типам подписок"""
    data = request.json
    
    vpn_squads = data.get('vpn', [])
    whitelist_squads = data.get('whitelist', [])
    trial_squads = data.get('trial', [])
    
    success = True
    success = success and database.set_subscription_squads('vpn', vpn_squads)
    success = success and database.set_subscription_squads('whitelist', whitelist_squads)
    success = success and database.set_subscription_squads('trial', trial_squads)
    
    if success:
        return jsonify({'success': True})
    return jsonify({'error': 'Failed to update mapping'}), 500


@app.route('/api/panel/squads/counts', methods=['POST'])
@require_auth
def sync_squad_counts():
    """Синхронизировать счётчики пользователей в сквадах"""
    database.sync_squad_user_counts()
    return jsonify({'success': True})


# ========== Выдача ключа с выбором типа ==========

@app.route('/api/panel/issue-key', methods=['POST'])
@require_auth
def issue_key_with_type():
    """
    Выдать ключ пользователю с указанием типа подписки.
    Автоматически выбирает лучший сквад для балансировки.
    """
    data = request.json
    user_id = data.get('user_id')
    plan_type = data.get('plan_type', 'vpn')  # vpn, whitelist, trial
    days = data.get('days', 30)
    traffic_limit_gb = data.get('traffic_limit_gb', 0)  # 0 = безлимит
    
    if not user_id:
        return jsonify({'error': 'user_id required'}), 400
    
    user = database.get_user_by_id(user_id)
    if not user:
        return jsonify({'error': 'User not found'}), 404
    
    try:
        # Выбираем лучший сквад для этого типа подписки
        best_squad = database.get_best_squad_for_subscription(plan_type)
        squad_uuids = [best_squad['squad_uuid']] if best_squad else None
        
        if not squad_uuids:
            # Используем дефолтные сквады из настроек
            squad_uuids = database.get_default_squads(plan_type)
        
        # Конвертируем трафик в байты
        traffic_limit_bytes = int(traffic_limit_gb * 1024 * 1024 * 1024) if traffic_limit_gb > 0 else 0
        
        # Создаём подписку через core
        result = core.create_user_and_subscription(
            telegram_id=user['telegram_id'],
            username=user.get('username', ''),
            days=days,
            traffic_limit=traffic_limit_bytes,
            plan_type=plan_type,
            squad_uuids=squad_uuids
        )
        
        if result:
            # Обновляем счётчик сквада
            if best_squad:
                database.update_squad_user_count(best_squad['squad_uuid'], 1)
            
            return jsonify({
                'success': True,
                'subscription': result,
                'squad': best_squad['squad_name'] if best_squad else 'default'
            })
        
        return jsonify({'error': 'Failed to create subscription'}), 500
    except Exception as e:
        logger.error(f"Issue key error: {e}")
        return jsonify({'error': str(e)}), 500


# Функция создания автоматического бэкапа
def auto_backup():
    """Создать автоматический бэкап и отправить администратору"""
    import shutil
    import tempfile
    
    try:
        # Проверяем, включены ли бэкапы
        conn = database.get_db_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT enabled, interval_hours, last_backup FROM backup_settings ORDER BY id DESC LIMIT 1")
        row = cursor.fetchone()
        conn.close()
        
        if not row or not row['enabled']:
            logger.info("Auto backup skipped - disabled in settings")
            return
        
        db_path = os.getenv('DB_PATH', 'data.db')
        if not os.path.isabs(db_path):
            db_path = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), db_path)
        if not os.path.exists(db_path):
            logger.error("Database file not found for auto backup")
            return

        if row and row['last_backup'] and row['interval_hours']:
            try:
                last_backup_dt = datetime.fromisoformat(str(row['last_backup']).replace('Z', '+00:00').replace('+00:00', ''))
                if datetime.utcnow() - last_backup_dt < timedelta(hours=int(row['interval_hours'])):
                    logger.info("Auto backup skipped - interval not reached")
                    return
            except Exception:
                pass
        
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        backup_name = f'blinvpn_auto_backup_{timestamp}.db'
        
        with tempfile.TemporaryDirectory() as temp_dir:
            backup_path = os.path.join(temp_dir, backup_name)
            shutil.copy2(db_path, backup_path)
            
            # Создаем zip архив
            shutil.make_archive(backup_path, 'zip', temp_dir, backup_name)
            
            # Отправляем администраторам
            admin_ids = get_admin_ids()
            bot_token = os.getenv('TELEGRAM_BOT_TOKEN')
            
            if admin_ids and bot_token:
                import requests
                with open(f'{backup_path}.zip', 'rb') as f:
                    archive_payload = f.read()
                for admin_id in admin_ids:
                    url = f"https://api.telegram.org/bot{bot_token}/sendDocument"
                    response = requests.post(
                        url,
                        data={
                            'chat_id': admin_id,
                            'caption': f'🗄️ Автоматический бэкап БД\n📅 {datetime.now().strftime("%d.%m.%Y %H:%M")} МСК'
                        },
                        files={'document': (f'{backup_name}.zip', archive_payload, 'application/zip')},
                        timeout=60
                    )
                    if response.status_code == 200:
                        logger.info(f"Auto backup sent successfully to {admin_id}")
                    else:
                        logger.error(f"Failed to send auto backup to {admin_id}: {response.text}")
        
        # Обновляем время последнего бэкапа
        conn = database.get_db_connection()
        cursor = conn.cursor()
        cursor.execute("UPDATE backup_settings SET last_backup = CURRENT_TIMESTAMP")
        conn.commit()
        conn.close()
        
    except Exception as e:
        logger.error(f"Auto backup error: {e}")


# ===== TOOLS ENDPOINTS =====

@app.route('/api/panel/export/<data_type>', methods=['GET'])
@require_auth
def export_data(data_type: str):
    """Экспорт данных в JSON"""
    conn = database.get_db_connection()
    cursor = conn.cursor()
    
    try:
        if data_type == 'users':
            cursor.execute("SELECT * FROM users ORDER BY id")
        elif data_type == 'keys':
            cursor.execute("SELECT * FROM vpn_keys ORDER BY id")
        elif data_type == 'transactions':
            cursor.execute("SELECT * FROM transactions ORDER BY id DESC LIMIT 10000")
        else:
            return jsonify({'error': 'Invalid data type'}), 400
        
        rows = cursor.fetchall()
        data = [dict(row) for row in rows]
        return jsonify({'data': data})
    finally:
        conn.close()

@app.route('/api/panel/diagnostics', methods=['GET'])
@require_auth
def get_diagnostics():
    """Диагностика системы"""
    conn = database.get_db_connection()
    cursor = conn.cursor()
    issues = []
    
    try:
        # Количество пользователей
        cursor.execute("SELECT COUNT(*) FROM users")
        users_count = cursor.fetchone()[0]
        
        # Количество ключей
        cursor.execute("SELECT COUNT(*) FROM vpn_keys")
        keys_count = cursor.fetchone()[0]
        
        # Активные ключи
        cursor.execute("SELECT COUNT(*) FROM vpn_keys WHERE status = 'Active' AND expiry_date > datetime('now')")
        active_keys = cursor.fetchone()[0]
        
        # Истёкшие ключи
        cursor.execute("SELECT COUNT(*) FROM vpn_keys WHERE expiry_date < datetime('now')")
        expired_keys = cursor.fetchone()[0]
        
        # Забаненные пользователи
        cursor.execute("SELECT COUNT(*) FROM users WHERE is_banned = 1")
        banned_users = cursor.fetchone()[0]
        
        # Проверка Remnawave
        remnawave_status = 'OK'
        try:
            rw_squads = remnawave.remnawave_api.get_all_squads()
            if not rw_squads:
                remnawave_status = 'Нет сквадов'
                issues.append('Remnawave: нет доступных сквадов')
        except Exception as e:
            remnawave_status = 'Ошибка'
            issues.append(f'Remnawave: {str(e)[:50]}')
        
        # Проверка проблем
        if expired_keys > 100:
            issues.append(f'Много истёкших ключей: {expired_keys}')
        
        cursor.execute("SELECT COUNT(*) FROM users WHERE balance < 0")
        negative_balance = cursor.fetchone()[0]
        if negative_balance > 0:
            issues.append(f'Пользователей с отрицательным балансом: {negative_balance}')
        
        return jsonify({
            'users_count': users_count,
            'keys_count': keys_count,
            'active_keys': active_keys,
            'expired_keys': expired_keys,
            'banned_users': banned_users,
            'remnawave_status': remnawave_status,
            'issues': issues
        })
    finally:
        conn.close()

@app.route('/api/panel/tools/cleanup-expired', methods=['POST'])
@require_auth
def cleanup_expired_keys():
    """Удалить истёкшие ключи старше 30 дней"""
    conn = database.get_db_connection()
    cursor = conn.cursor()
    
    try:
        # Получаем ключи для удаления
        cursor.execute("""
            SELECT key_uuid FROM vpn_keys 
            WHERE expiry_date < datetime('now', '-30 days')
        """)
        keys_to_delete = [row[0] for row in cursor.fetchall()]
        
        # Удаляем из Remnawave
        deleted = 0
        for key_uuid in keys_to_delete:
            try:
                remnawave.delete_user(key_uuid)
                deleted += 1
            except:
                pass
        
        # Удаляем из базы
        cursor.execute("""
            DELETE FROM vpn_keys 
            WHERE expiry_date < datetime('now', '-30 days')
        """)
        conn.commit()
        
        return jsonify({'success': True, 'deleted': deleted})
    finally:
        conn.close()

# Запуск планировщика для автоматических бэкапов
def start_backup_scheduler():
    """Запустить планировщик периодических бэкапов"""
    try:
        from apscheduler.schedulers.background import BackgroundScheduler
        scheduler = BackgroundScheduler()

        # Проверка каждый час, auto_backup сам учитывает interval_hours
        scheduler.add_job(
            auto_backup,
            'interval',
            hours=1,
            id='auto_backup',
            name='Periodic backup checker',
            replace_existing=True
        )
        
        scheduler.start()
        logger.info("Backup scheduler started - checks every hour")
        
    except ImportError:
        logger.warning("APScheduler not installed, auto backups disabled. Install with: pip install apscheduler pytz")
    except Exception as e:
        logger.error(f"Failed to start backup scheduler: {e}")


if __name__ == '__main__':
    # Запускаем обновление черного списка
    start_blacklist_updater()
    
    # Запускаем планировщик бэкапов
    start_backup_scheduler()

    # Запускаем поллер платежей (перестрахование от потерянных вебхуков)
    start_payment_poller()

    app.run(host='0.0.0.0', port=int(os.getenv('API_PORT', 8000)))
