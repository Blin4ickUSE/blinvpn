"""
REST API сервер для мини-приложения и панели
"""
import os
import logging
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

@app.route('/api/user/info', methods=['GET'])
def get_user_info():
    """Получить информацию о пользователе"""
    telegram_id = request.args.get('telegram_id', type=int)
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

@app.route('/api/subscription/create', methods=['POST'])
def create_subscription():
    """Создать подписку"""
    data = request.json
    user_id = data.get('user_id')
    days = data.get('days')
    plan_type = data.get('type')  # 'vpn' or 'whitelist'
    
    if not user_id or not days:
        return jsonify({'error': 'Missing required fields'}), 400
    
    user = database.get_user_by_id(user_id)
    if not user:
        return jsonify({'error': 'User not found'}), 404
    
    # Проверяем баланс
    price = days * 3.3  # Примерная цена
    if user.get('balance', 0) < price:
        return jsonify({'error': 'Insufficient balance'}), 400
    
    # Создаем подписку
    result = core.create_user_and_subscription(
        user['telegram_id'], user.get('username', ''), days
    )
    
    if result:
        # Списываем баланс
        database.update_user_balance(user_id, -price)
        return jsonify({'success': True, 'subscription': result})
    
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

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=int(os.getenv('API_PORT', 8000)))

