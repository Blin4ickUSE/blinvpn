"""
REST API сервер для мини-приложения и панели
"""
import os
import logging
import hmac
import hashlib
import json
from urllib.parse import parse_qsl
from functools import wraps
from flask import Flask, request, jsonify
from flask_cors import CORS
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '../'))

from backend.database import database
from backend.core import core, abuse_detected
from backend.api import remnawave, yookassa, heleket, platega

app = Flask(__name__)

# CORS для miniapp и панели
CORS(
    app,
    resources={r"/api/*": {"origins": "*"}},
)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Секретный ключ для аутентификации панели
PANEL_SECRET = os.getenv('PANEL_SECRET', 'change_this_secret')

# --- ВСТАВИТЬ СЮДА (ПЕРЕД require_auth) ---

# Получаем токен из переменных окружения
BOT_TOKEN = os.getenv('BOT_TOKEN')

def validate_telegram_data(init_data):
    """Проверяет подлинность данных от Telegram (HMAC-SHA256)"""
    if not BOT_TOKEN:
        logger.error("BOT_TOKEN is not set in environment variables")
        return None

    try:
        parsed_data = dict(parse_qsl(init_data))
    except ValueError:
        return None

    if 'hash' not in parsed_data:
        return None

    received_hash = parsed_data.pop('hash')
    # Сортируем параметры по алфавиту
    data_check_string = "\n".join(f"{k}={v}" for k, v in sorted(parsed_data.items()))
    
    # Создаем секретный ключ на основе токена бота
    secret_key = hmac.new(b"WebAppData", BOT_TOKEN.encode(), hashlib.sha256).digest()
    # Хэшируем строку данных
    calculated_hash = hmac.new(secret_key, data_check_string.encode(), hashlib.sha256).hexdigest()
    
    # Сравниваем хэши
    if calculated_hash == received_hash:
        return json.loads(parsed_data['user'])
    return None

def require_webapp_auth(f):
    """Декоратор для защиты роутов через Telegram InitData"""
    @wraps(f)
    def decorated_function(*args, **kwargs):
        # Ожидаем заголовок X-Telegram-Init-Data от фронтенда
        init_data = request.headers.get('X-Telegram-Init-Data')
        
        if not init_data:
            return jsonify({'error': 'No auth data provided'}), 401
        
        user_data = validate_telegram_data(init_data)
        if not user_data:
            return jsonify({'error': 'Invalid auth data'}), 403
            
        # Сохраняем ID проверенного пользователя в запрос
        request.validated_user_id = user_data['id']
        return f(*args, **kwargs)
    return decorated_function

# ---------------------

def require_auth(f):
    """Декоратор для проверки аутентификации"""
    def wrapper(*args, **kwargs):
        auth_header = request.headers.get('Authorization')
        if not auth_header or auth_header != f'Bearer {PANEL_SECRET}':
            return jsonify({'error': 'Unauthorized'}), 401
        return f(*args, **kwargs)
    wrapper.__name__ = f.__name__
    return wrapper

# ========== API для мини-приложения ==========

@app.route('/api/plans', methods=['GET'])
def get_plans():
    return jsonify(database.get_active_plans())

@app.route('/api/user/info', methods=['GET'])
@require_webapp_auth
def get_user_info():
    """Получить информацию о пользователе"""
    telegram_id = request.validated_user_id
    if not telegram_id:
        return jsonify({'error': 'telegram_id required'}), 400
    
    user = database.get_user_by_telegram_id(telegram_id)
    if not user:
        return jsonify({'error': 'User not found'}), 404
    
    # Проверка бана
    ban_status = abuse_detected.check_user_ban_status(user['id'])
    if ban_status.get('banned'):
        return jsonify({
            'banned': True,
            'reason': ban_status.get('reason', 'Account banned')
        }), 403
    
    stats = core.get_referral_stats(user['id'])

    return jsonify({
        'id': user['id'],
        'telegram_id': user['telegram_id'],
        'username': user.get('username'),
        'balance': user.get('balance', 0),
        'status': user.get('status', 'Trial'),
        'referral_code': user.get('referral_code'),
        'partner_balance': user.get('partner_balance', 0),
        'referrals_count': stats.get('referrals_count', 0),
        'referral_earned': stats.get('total_earned', 0),
        'referral_rate': stats.get('rate', 20),
    })

@app.route('/api/payment/create', methods=['POST'])
def create_payment():
    """Создать платеж"""
    data = request.json
    user_id = data.get('user_id')
    amount = data.get('amount')
    method = data.get('method')  # 'yookassa', 'heleket', 'platega'
    provider = data.get('provider')  # для SBP
    
    if not user_id or not amount or not method:
        return jsonify({'error': 'Missing required fields'}), 400
    
    user = database.get_user_by_id(user_id)
    if not user:
        return jsonify({'error': 'User not found'}), 404
    
    order_id = f"user_{user_id}_{int(os.urandom(4).hex(), 16)}"
    return_url = f"{os.getenv('MINIAPP_URL')}/success"
    
    if method == 'yookassa':
        payment = yookassa.yookassa_api.create_payment(
            amount, f"Пополнение баланса", return_url, user_id
        )
        if payment:
            return jsonify({
                'payment_id': payment['id'],
                'confirmation_url': payment['confirmation_url'],
                'status': payment['status']
            })
    
    elif method == 'heleket':
        payment = heleket.heleket_api.create_payment(
            amount, order_id, url_return=return_url,
            url_callback=f"{os.getenv('WEBHOOK_URL')}/heleket"
        )
        if payment:
            return jsonify({
                'payment_id': payment.get('order_id'),
                'payment_url': payment.get('payment_url'),
                'status': 'pending'
            })
    
    elif method == 'platega':
        payment = platega.platega_api.create_payment(
            amount, order_id, return_url=return_url,
            callback_url=f"{os.getenv('WEBHOOK_URL')}/platega"
        )
        if payment:
            return jsonify({
                'payment_id': payment.get('id'),
                'payment_url': payment.get('payment_url'),
                'status': 'pending'
            })
    
    return jsonify({'error': 'Payment creation failed'}), 500

@app.route('/api/promocode/apply', methods=['POST'])
def apply_promocode():
    """Применить промокод"""
    data = request.json
    user_id = data.get('user_id')
    code = data.get('code')
    
    if not user_id or not code:
        return jsonify({'error': 'Missing required fields'}), 400
    
    result = core.apply_promocode(user_id, code)
    return jsonify(result)

@app.route('/api/user/devices', methods=['GET'])
@require_webapp_auth
def get_user_devices():
    """Получить список устройств пользователя"""
    telegram_id = request.validated_user_id
    if not telegram_id:
        return jsonify({'error': 'telegram_id required'}), 400
    
    user = database.get_user_by_telegram_id(telegram_id)
    if not user:
        return jsonify({'error': 'User not found'}), 404
    
    conn = database.get_db_connection()
    cursor = conn.cursor()
    
    try:
        cursor.execute("""
            SELECT d.id, d.name, d.platform, d.added_date, d.is_active,
                   vk.key_config, vk.key_uuid, vk.status as key_status
            FROM devices d
            LEFT JOIN vpn_keys vk ON d.vpn_key_id = vk.id
            WHERE d.user_id = ? AND d.is_active = 1
            ORDER BY d.added_date DESC
        """, (user['id'],))
        
        rows = cursor.fetchall()
        devices = []
        for row in rows:
            from datetime import datetime
            added_date = row['added_date']
            if added_date:
                try:
                    if isinstance(added_date, str):
                        dt = datetime.fromisoformat(added_date.replace('Z', '+00:00'))
                    else:
                        dt = added_date
                    added_formatted = dt.strftime('%d.%m.%Y')
                except:
                    added_formatted = str(added_date)[:10]
            else:
                added_formatted = datetime.now().strftime('%d.%m.%Y')
            
            devices.append({
                'id': row['id'],
                'name': row['name'] or 'Устройство',
                'type': row['platform'] or 'unknown',
                'added': added_formatted,
                'key_config': row['key_config'],
                'key_uuid': row['key_uuid'],
                'key_status': row['key_status']
            })
        
        return jsonify(devices)
    finally:
        conn.close()

@app.route('/api/user/history', methods=['GET'])
@require_webapp_auth
def get_user_history():
    """Получить историю транзакций пользователя"""
    telegram_id = request.validated_user_id
    if not telegram_id:
        return jsonify({'error': 'telegram_id required'}), 400
    
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
            ORDER BY created_at DESC
            LIMIT 100
        """, (user['id'],))
        
        rows = cursor.fetchall()
        history = []
        for row in rows:
            # Маппинг типов транзакций
            type_map = {
                'deposit': 'deposit',
                'withdrawal': 'withdrawal',
                'subscription': 'sub_off',
                'device_purchase': 'buy_dev',
                'trial': 'trial'
            }
            
            title_map = {
                'deposit': f'Пополнение баланса ({row["payment_method"] or ""})',
                'withdrawal': 'Вывод средств',
                'subscription': 'Списание за подписку',
                'device_purchase': 'Покупка устройства',
                'trial': 'Активация пробного периода'
            }
            
            trans_type = type_map.get(row['type'], row['type'])
            title = row['description'] or title_map.get(row['type'], row['type'])
            
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

@app.route('/api/subscription/create', methods=['POST'])
@require_webapp_auth  # <--- Защита
def create_subscription():
    data = request.json
    # Берем ID из авторизации, а не из JSON, чтобы нельзя было купить другому за свой счет (или наоборот)
    auth_tg_id = request.validated_user_id 
    plan_id = data.get('plan_id')
    
    # Ищем пользователя по Telegram ID
    user = database.get_user_by_telegram_id(auth_tg_id)
    if not user:
        return jsonify({'error': 'User not found'}), 404
    
    user_id = user['id']

    # Получаем план из базы
    plan = database.get_plan_by_id(plan_id)
    if not plan:
        return jsonify({'error': 'Invalid plan'}), 400
        
    price = plan['price']
    days = plan['days']
    
    # Списание средств
    if not database.update_user_balance(user_id, -price, ensure_non_negative=True):
        return jsonify({'error': 'Insufficient balance'}), 400
    
    # Создание подписки
    result = core.create_user_and_subscription(
        user['telegram_id'], user.get('username', ''), days
    )
    
    if result:
        return jsonify({'success': True, 'subscription': result})
    
    # Возврат средств при ошибке
    database.update_user_balance(user_id, price)
    return jsonify({'error': 'Failed to create subscription'}), 500

# ========== API для панели ==========

@app.route('/api/panel/users', methods=['GET'])
@require_auth
def get_users():
    """Получить список пользователей"""
    limit = request.args.get('limit', 100, type=int)
    offset = request.args.get('offset', 0, type=int)
    raw_users = database.get_all_users(limit, offset)

    # Небольшой маппинг под фронтенд (оставляем столбцы как есть, чтобы панель могла сама адаптировать)
    return jsonify(raw_users)

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
        INSERT INTO promocodes (code, type, value, uses_limit, expires_at, is_active)
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        (
            data.get('code', '').upper(),
            data.get('type'),
            str(data.get('value')),
            data.get('uses_limit'),
            data.get('expires_at'),
            1 if data.get('is_active', 1) else 0,
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

@app.route('/api/panel/mailing', methods=['POST'])
@require_auth
def send_mailing():
    """Отправить рассылку"""
    data = request.json
    message = data.get('message')
    target_users = data.get('target_users', 'all')  # 'all' or list/int user_ids

    if not message:
        return jsonify({'success': False, 'error': 'Message is required'}), 400

    conn = database.get_db_connection()
    cursor = conn.cursor()

    try:
        # Определяем список получателей
        user_rows = []
        if target_users == 'all':
            cursor.execute("SELECT id, telegram_id FROM users")
            user_rows = cursor.fetchall()
        elif isinstance(target_users, list):
            placeholders = ",".join("?" for _ in target_users)
            cursor.execute(
                f"SELECT id, telegram_id FROM users WHERE id IN ({placeholders})",
                tuple(target_users),
            )
            user_rows = cursor.fetchall()

        sent = 0
        for row in user_rows:
            telegram_id = row['telegram_id']
            if core.send_notification_to_user(telegram_id, message):
                sent += 1

        # Сохраняем запись о рассылке
        cursor.execute(
            """
            INSERT INTO mailings (title, message_text, target_users, sent_count, status, sent_at)
            VALUES (?, ?, ?, ?, 'Completed', CURRENT_TIMESTAMP)
            """,
            (data.get('title', ''), message, str(target_users), sent),
        )
        conn.commit()
    finally:
        conn.close()

    return jsonify({'success': True, 'sent': sent})


@app.route('/api/panel/tickets', methods=['GET'])
@require_auth
def get_tickets():
    """Список тикетов для панели"""
    conn = database.get_db_connection()
    cursor = conn.cursor()

    cursor.execute(
        """
        SELECT
            t.id,
            u.username,
            u.balance,
            u.status AS user_status,
            t.status,
            t.last_message,
            t.last_message_time,
            t.unread_count
        FROM tickets t
        JOIN users u ON t.user_id = u.id
        ORDER BY t.last_message_time DESC NULLS LAST, t.created_at DESC
        """
    )
    rows = cursor.fetchall()
    conn.close()

    tickets = []
    for r in rows:
        username = r['username'] or f"id{r['id']}"
        tickets.append(
            {
                'id': r['id'],
                'user': f"@{username}" if not username.startswith('@') else username,
                'status': r['status'],
                'lastMsg': r['last_message'] or '',
                'time': r['last_message_time'] or '',
                'unread': r['unread_count'] or 0,
                'balance': r['balance'] or 0,
                'sub': r['user_status'] or '',
            }
        )

    return jsonify(tickets)

@app.route('/api/panel/transactions', methods=['GET'])
@require_auth
def get_transactions():
    """Получить список транзакций"""
    limit = request.args.get('limit', 100, type=int)
    offset = request.args.get('offset', 0, type=int)
    
    conn = database.get_db_connection()
    cursor = conn.cursor()
    
    try:
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

@app.route('/api/panel/keys', methods=['GET'])
@require_auth
def get_keys():
    """Получить список ключей VPN"""
    limit = request.args.get('limit', 100, type=int)
    offset = request.args.get('offset', 0, type=int)
    
    conn = database.get_db_connection()
    cursor = conn.cursor()
    
    try:
        cursor.execute("""
            SELECT 
                vk.id,
                vk.user_id,
                u.username,
                vk.key_uuid,
                vk.key_config,
                vk.status,
                vk.expiry_date,
                vk.traffic_used,
                vk.traffic_limit,
                vk.devices_limit,
                vk.server_location,
                vk.created_at
            FROM vpn_keys vk
            LEFT JOIN users u ON vk.user_id = u.id
            ORDER BY vk.created_at DESC
            LIMIT ? OFFSET ?
        """, (limit, offset))
        
        rows = cursor.fetchall()
        keys = []
        for row in rows:
            username = row['username'] or f"user_{row['user_id']}"
            key_display = row['key_config'] or row['key_uuid'] or f"key_{row['id']}"
            if len(key_display) > 50:
                key_display = key_display[:47] + '...'
            
            # Вычисляем оставшиеся дни
            expiry_days = 0
            if row['expiry_date']:
                try:
                    from datetime import datetime
                    if isinstance(row['expiry_date'], str):
                        expiry = datetime.fromisoformat(row['expiry_date'].replace('Z', '+00:00'))
                    else:
                        expiry = row['expiry_date']
                    now = datetime.now()
                    if expiry.tzinfo:
                        from datetime import timezone
                        now = datetime.now(timezone.utc)
                    diff = expiry - now
                    expiry_days = max(0, int(diff.total_seconds() / 86400))
                except:
                    expiry_days = 0
            
            keys.append({
                'id': row['id'],
                'key_config': row['key_config'],
                'key_uuid': row['key_uuid'],
                'key': key_display,
                'user_id': row['user_id'],
                'username': f"@{username}" if username and not username.startswith('@') else username,
                'status': row['status'] or 'Active',
                'expiry_date': row['expiry_date'],
                'expiry': expiry_days,
                'traffic_used': float(row['traffic_used'] or 0),
                'traffic_limit': float(row['traffic_limit'] or 0),
                'devices_used': 0,  # TODO: подсчитать из devices
                'devices_limit': row['devices_limit'] or 1,
                'server_location': row['server_location'] or 'Unknown'
            })
        
        return jsonify(keys)
    finally:
        conn.close()


@app.route('/api/user/referrals', methods=['GET'])
@require_webapp_auth
def get_user_referrals():
    """Получить список рефералов пользователя"""
    telegram_id = request.validated_user_id
    if not telegram_id:
        return jsonify({'error': 'telegram_id required'}), 400

    user = database.get_user_by_telegram_id(telegram_id)
    if not user:
        return jsonify({'error': 'User not found'}), 404

    conn = database.get_db_connection()
    cursor = conn.cursor()

    try:
        cursor.execute(
            """
            SELECT id, username, registration_date
            FROM users
            WHERE referred_by = ?
            ORDER BY registration_date DESC
            """,
            (user["id"],),
        )
        referrals_rows = cursor.fetchall()

        # Загружаем ставки
        rate = user.get("partner_rate", 20) / 100

        referrals = []
        for r in referrals_rows:
            ref_id = r["id"]
            # Сумма пополнений реферала
            cursor.execute(
                """
                SELECT COALESCE(SUM(amount), 0) as total
                FROM transactions
                WHERE user_id = ? AND type = 'deposit'
                """,
                (ref_id,),
            )
            spent_row = cursor.fetchone()
            total_spent = float(spent_row["total"] or 0)
            profit = total_spent * rate

            referrals.append(
                {
                    "id": ref_id,
                    "name": r["username"] or f"id{ref_id}",
                    "date": r["registration_date"] or "",
                    "spent": total_spent,
                    "myProfit": profit,
                    "history": [],  # История можно дополнить при необходимости
                }
            )

        return jsonify(referrals)
    finally:
        conn.close()


@app.route('/api/panel/stats/charts', methods=['GET'])
@require_auth
def get_stats_charts():
    """Графики для дашборда панели (последние 14 дней)"""
    conn = database.get_db_connection()
    cursor = conn.cursor()
    from datetime import datetime, timedelta

    try:
        # Подготовим даты
        days = []
        today = datetime.utcnow().date()
        for i in range(14):
            days.append(today - timedelta(days=13 - i))

        # Пользователи по дням
        cursor.execute(
            """
            SELECT DATE(registration_date) as d, COUNT(*) as cnt
            FROM users
            GROUP BY DATE(registration_date)
            """
        )
        users_map = {row["d"]: row["cnt"] for row in cursor.fetchall()}
        users_series = [users_map.get(str(d), 0) for d in days]

        # Ключи по дням
        cursor.execute(
            """
            SELECT DATE(created_at) as d, COUNT(*) as cnt
            FROM vpn_keys
            GROUP BY DATE(created_at)
            """
        )
        keys_map = {row["d"]: row["cnt"] for row in cursor.fetchall()}
        keys_series = [keys_map.get(str(d), 0) for d in days]

        return jsonify({
            "users": users_series,
            "keys": keys_series,
            "labels": [d.strftime("%d.%m") for d in days],
        })
    finally:
        conn.close()

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=int(os.getenv('API_PORT', 8000)))




