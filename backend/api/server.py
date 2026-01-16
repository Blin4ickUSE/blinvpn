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
from backend.core.whitelist_billing import calculate_whitelist_price
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
        # Проверяем, нужны ли автоплатежи
        save_payment_method = data.get('save_payment_method', False)
        payment_method_id = data.get('payment_method_id')  # Для автоплатежа
        
        metadata = {'user_id': str(user_id)}
        if data.get('subscription_id'):
            metadata['subscription_id'] = str(data.get('subscription_id'))
        
        payment = yookassa.yookassa_api.create_payment(
            amount, f"Пополнение баланса", return_url, user_id, 
            metadata=metadata,
            save_payment_method=save_payment_method,
            payment_method_id=payment_method_id
        )
        if payment:
            result = {
                'payment_id': payment['id'],
                'confirmation_url': payment.get('confirmation_url'),
                'status': payment['status']
            }
            # Если способ оплаты сохранен, возвращаем его ID
            if payment.get('payment_method_saved'):
                result['payment_method_id'] = payment.get('payment_method_id')
                result['card_last4'] = payment.get('card_last4')
            return jsonify(result)
    
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
def get_user_devices():
    """Получить список устройств пользователя"""
    telegram_id = request.args.get('telegram_id', type=int)
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
def get_user_history():
    """Получить историю транзакций пользователя"""
    telegram_id = request.args.get('telegram_id', type=int)
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

@app.route('/api/user/payment-methods', methods=['GET'])
def get_user_payment_methods():
    """Получить сохраненные способы оплаты пользователя"""
    telegram_id = request.args.get('telegram_id', type=int)
    if not telegram_id:
        return jsonify({'error': 'telegram_id required'}), 400
    
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
    if not telegram_id:
        return jsonify({'error': 'telegram_id required'}), 400
    
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

@app.route('/api/subscription/create', methods=['POST'])
def create_subscription():
    """Создать подписку"""
    data = request.json
    user_id = data.get('user_id')
    days = data.get('days')
    plan_type = data.get('type')  # 'vpn' or 'whitelist'
    whitelist_gb = data.get('whitelist_gb', 0)  # Для whitelist подписки
    use_auto_pay = data.get('use_auto_pay', False)  # Использовать автоплатеж
    payment_method_id = data.get('payment_method_id')  # ID сохраненного способа оплаты
    
    if not user_id or not days:
        return jsonify({'error': 'Missing required fields'}), 400
    
    user = database.get_user_by_id(user_id)
    if not user:
        return jsonify({'error': 'User not found'}), 404
    
    # Рассчитываем цену в зависимости от типа подписки
    if plan_type == 'whitelist':
        if whitelist_gb < 5 or whitelist_gb > 500:
            return jsonify({'error': 'Whitelist GB must be between 5 and 500'}), 400
        from backend.core.whitelist_billing import calculate_whitelist_price
        price = calculate_whitelist_price(whitelist_gb)
    else:
        # VPN подписка - используем фиксированные цены из планов
        price = data.get('price', days * 3.3)
    
    # Если используется автоплатеж, создаем платеж через YooKassa
    if use_auto_pay and payment_method_id and plan_type == 'whitelist':
        # Автоплатеж для whitelist подписки
        payment = yookassa.yookassa_api.create_payment(
            price, f"Автоплатеж: Whitelist подписка ({days} дней, {whitelist_gb} ГБ)", 
            f"{os.getenv('MINIAPP_URL')}/success", user_id,
            metadata={'user_id': str(user_id), 'subscription_type': 'whitelist', 'days': days, 'whitelist_gb': whitelist_gb},
            payment_method_id=payment_method_id
        )
        if payment and payment.get('status') == 'succeeded':
            # Платеж успешен, создаем подписку
            traffic_limit_bytes = int(whitelist_gb * (1024 ** 3))
            result = core.create_user_and_subscription(
                user['telegram_id'], user.get('username', ''), days,
                traffic_limit=traffic_limit_bytes
            )
            if result:
                return jsonify({'success': True, 'subscription': result})
            return jsonify({'error': 'Failed to create subscription'}), 500
        else:
            return jsonify({'error': 'Auto payment failed'}), 400
    
    # Обычная покупка через баланс
    deducted = database.update_user_balance(user_id, -price, ensure_non_negative=True)
    if not deducted:
        return jsonify({'error': 'Insufficient balance'}), 400
    
    # Создаем подписку
    if plan_type == 'whitelist':
        # Для whitelist создаем подписку с лимитом трафика
        traffic_limit_bytes = int(whitelist_gb * (1024 ** 3))
        result = core.create_user_and_subscription(
            user['telegram_id'], user.get('username', ''), days,
            traffic_limit=traffic_limit_bytes
        )
    else:
        result = core.create_user_and_subscription(
            user['telegram_id'], user.get('username', ''), days
        )
    
    if result:
        # Создаем транзакцию
        conn = database.get_db_connection()
        cursor = conn.cursor()
        description = f"{'Whitelist' if plan_type == 'whitelist' else 'VPN'} подписка ({days} дней)"
        if plan_type == 'whitelist':
            description += f" - {whitelist_gb} ГБ"
        cursor.execute("""
            INSERT INTO transactions (user_id, type, amount, status, description, payment_method)
            VALUES (?, 'subscription', ?, 'Success', ?, 'Balance')
        """, (user_id, -price, description))
        conn.commit()
        conn.close()
        
        return jsonify({'success': True, 'subscription': result})
    
    # Откат баланса, если создание не удалось
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
    button_type = data.get('button_type')
    button_value = data.get('button_value')
    image_url = data.get('image_url')

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
            INSERT INTO mailings (title, message_text, target_users, sent_count, status, sent_at, button_type, button_value, image_url)
            VALUES (?, ?, ?, ?, 'Completed', CURRENT_TIMESTAMP, ?, ?, ?)
            """,
            (data.get('title', ''), message, str(target_users), sent, button_type, button_value, image_url),
        )
        conn.commit()
    finally:
        conn.close()

    return jsonify({'success': True, 'sent': sent})

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
        
        # Доставляемость (упрощенно - считаем успешными все отправленные)
        cursor.execute("SELECT COUNT(*) AS cnt FROM mailings WHERE status = 'Completed'")
        completed_count = cursor.fetchone()['cnt'] or 0
        delivered_rate = 98.5 if completed_count > 0 else 0  # Упрощенно, можно улучшить
        
        # Переходы (пока нет трекинга, возвращаем 0)
        clicks = 0
        
        # Последняя кампания
        cursor.execute("""
            SELECT title, sent_at FROM mailings 
            WHERE status = 'Completed' 
            ORDER BY sent_at DESC LIMIT 1
        """)
        last_campaign_row = cursor.fetchone()
        last_campaign = last_campaign_row['title'] if last_campaign_row else None
        last_campaign_date = last_campaign_row['sent_at'] if last_campaign_row else None
        
        return jsonify({
            'totalSent': total_sent,
            'delivered': delivered_rate,
            'clicks': clicks,
            'lastCampaign': last_campaign,
            'lastCampaignDate': last_campaign_date
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
                'sent_count': row['sent_count'] or 0,
                'status': row['status'],
                'date': date_formatted
            })
        
        return jsonify(history)
    finally:
        conn.close()


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

@app.route('/api/panel/tickets/<int:ticket_id>/messages', methods=['GET'])
@require_auth
def get_ticket_messages(ticket_id: int):
    """Получить сообщения тикета"""
    conn = database.get_db_connection()
    cursor = conn.cursor()
    
    try:
        cursor.execute("""
            SELECT 
                tm.id,
                tm.message_text,
                tm.is_admin,
                tm.created_at
            FROM ticket_messages tm
            WHERE tm.ticket_id = ?
            ORDER BY tm.created_at ASC
        """, (ticket_id,))
        
        rows = cursor.fetchall()
        messages = []
        for row in rows:
            messages.append({
                'id': row['id'],
                'text': row['message_text'] or '',
                'isAdmin': bool(row['is_admin']),
                'created_at': row['created_at']
            })
        
        return jsonify(messages)
    except Exception as e:
        logger.error(f"Error getting ticket messages {ticket_id}: {e}")
        return jsonify({'error': str(e)}), 500
    finally:
        conn.close()

@app.route('/api/panel/tickets/<int:ticket_id>/reply', methods=['POST'])
@require_auth
def reply_to_ticket(ticket_id: int):
    """Ответить на тикет из панели"""
    data = request.json
    message_text = data.get('message', '')
    
    if not message_text:
        return jsonify({'success': False, 'error': 'Message is required'}), 400
    
    conn = database.get_db_connection()
    cursor = conn.cursor()
    
    try:
        # Получаем информацию о тикете
        cursor.execute("""
            SELECT t.telegram_topic_id, u.telegram_id
            FROM tickets t
            JOIN users u ON t.user_id = u.id
            WHERE t.id = ?
        """, (ticket_id,))
        
        result = cursor.fetchone()
        if not result:
            return jsonify({'success': False, 'error': 'Ticket not found'}), 404
        
        telegram_id = result['telegram_id']
        
        # Отправляем сообщение пользователю через основной бот
        success = core.send_notification_to_user(telegram_id, message_text)
        
        if success:
            # Сохраняем сообщение в БД
            cursor.execute("""
                INSERT INTO ticket_messages (ticket_id, is_admin, message_text)
                VALUES (?, 1, ?)
            """, (ticket_id, message_text))
            
            # Обновляем тикет
            cursor.execute("""
                UPDATE tickets
                SET last_message = ?, last_message_time = CURRENT_TIMESTAMP
                WHERE id = ?
            """, (message_text, ticket_id))
            
            conn.commit()
            return jsonify({'success': True})
        else:
            return jsonify({'success': False, 'error': 'Failed to send message'}), 500
            
    except Exception as e:
        logger.error(f"Error replying to ticket {ticket_id}: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500
    finally:
        conn.close()

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
def get_user_referrals():
    """Получить список рефералов пользователя"""
    telegram_id = request.args.get('telegram_id', type=int)
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


@app.route('/api/panel/stats/summary', methods=['GET'])
@require_auth
def get_stats_summary():
    """
    Сводные метрики для дашборда:
    - total_users: всего пользователей
    - active_keys: активных ключей
    - monthly_revenue: сумма депозитов за текущий месяц
    - open_tickets: открытых тикетов
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

        # Доход за текущий месяц (по депозитам)
        now = datetime.utcnow()
        month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        cursor.execute(
            """
            SELECT COALESCE(SUM(amount), 0) AS total
            FROM transactions
            WHERE type = 'deposit'
              AND created_at >= ?
              AND status = 'Success'
            """,
            (month_start.isoformat(),),
        )
        monthly_revenue = float(cursor.fetchone()["total"] or 0)

        # Открытые тикеты
        cursor.execute("SELECT COUNT(*) AS cnt FROM tickets WHERE status = 'Open'")
        open_tickets = cursor.fetchone()["cnt"] or 0

        return jsonify(
            {
                "total_users": total_users,
                "active_keys": active_keys,
                "monthly_revenue": monthly_revenue,
                "open_tickets": open_tickets,
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
        # Пополнения (все депозиты)
        cursor.execute("""
            SELECT COALESCE(SUM(amount), 0) AS total, COUNT(*) AS cnt
            FROM transactions
            WHERE type = 'deposit' AND status = 'Success'
        """)
        deposits_row = cursor.fetchone()
        deposits_total = float(deposits_row['total'] or 0)
        deposits_count = deposits_row['cnt'] or 0
        
        # Списания (все расходы)
        cursor.execute("""
            SELECT COALESCE(SUM(ABS(amount)), 0) AS total, COUNT(*) AS cnt
            FROM transactions
            WHERE type IN ('subscription', 'whitelist_overage', 'withdrawal') AND amount < 0
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
            WHERE type = 'deposit' AND status = 'Success'
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
            WHERE type = 'deposit' AND status = 'Success' AND created_at >= ?
        """, (today_start.isoformat(),))
        payments_today = cursor.fetchone()['cnt'] or 0
        
        cursor.execute("SELECT COUNT(*) AS cnt FROM tickets WHERE status = 'Open'")
        open_tickets = cursor.fetchone()['cnt'] or 0
        
        cursor.execute("SELECT COALESCE(SUM(balance), 0) AS total FROM users")
        clients_balance = float(cursor.fetchone()['total'] or 0)
        
        # Выручка по дням (последние 30 дней)
        revenue_data = []
        for i in range(30):
            day = (datetime.utcnow() - timedelta(days=29-i)).date()
            day_start = datetime.combine(day, datetime.min.time())
            day_end = day_start + timedelta(days=1)
            cursor.execute("""
                SELECT COALESCE(SUM(amount), 0) AS total
                FROM transactions
                WHERE type = 'deposit' AND status = 'Success'
                  AND created_at >= ? AND created_at < ?
            """, (day_start.isoformat(), day_end.isoformat()))
            revenue_data.append(float(cursor.fetchone()['total'] or 0))
        
        # Распределение пользователей
        cursor.execute("SELECT COUNT(*) AS cnt FROM users WHERE status = 'Active'")
        active_users = cursor.fetchone()['cnt'] or 0
        cursor.execute("SELECT COUNT(*) AS cnt FROM users WHERE status = 'Trial'")
        trial_users = cursor.fetchone()['cnt'] or 0
        cursor.execute("SELECT COUNT(*) AS cnt FROM users WHERE is_banned = 1")
        banned_users = cursor.fetchone()['cnt'] or 0
        cursor.execute("SELECT COUNT(*) AS cnt FROM users WHERE status = 'Expired'")
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
        
        # Конверсия Trial -> Paid
        cursor.execute("SELECT COUNT(*) AS cnt FROM users WHERE trial_used = 1")
        used_trial = cursor.fetchone()['cnt'] or 0
        cursor.execute("SELECT COUNT(*) AS cnt FROM users WHERE trial_used = 1 AND status = 'Active'")
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
                   COALESCE(SUM(t.amount), 0) AS total_spent
            FROM users u
            LEFT JOIN users r ON r.referred_by = u.id
            LEFT JOIN transactions t ON t.user_id = r.id AND t.type = 'deposit'
            WHERE u.is_partner = 1
            GROUP BY u.id
            ORDER BY total_spent DESC
            LIMIT 10
        """)
        top_referrers_raw = cursor.fetchall()
        top_referrers = []
        for idx, row in enumerate(top_referrers_raw, 1):
            username = row['username'] or f"id{row['id']}"
            rate = row['partner_rate'] or 20
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
            'openTickets': open_tickets,
            'clientsBalance': clients_balance,
            'revenueData': revenue_data,
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

@app.route('/api/panel/tariffs', methods=['GET'])
@require_auth
def get_tariffs():
    """Получить тарифные планы"""
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
    import os
    conn = database.get_db_connection()
    cursor = conn.cursor()
    
    try:
        # Настройки из БД
        cursor.execute("SELECT setting_key, setting_value FROM system_settings")
        db_settings = {row['setting_key']: row['setting_value'] for row in cursor.fetchall()}
        
        # Настройки из .env (только безопасные, не секреты)
        env_settings = {
            'MINIAPP_URL': os.getenv('MINIAPP_URL', ''),
            'PANEL_URL': os.getenv('PANEL_URL', ''),
            'API_URL': os.getenv('API_URL', ''),
            'BOT_USERNAME': os.getenv('BOT_USERNAME', 'blnnnbot'),
            'TRIAL_HOURS': os.getenv('TRIAL_HOURS', '24'),
            'MIN_TOPUP_AMOUNT': os.getenv('MIN_TOPUP_AMOUNT', '50'),
            'MAX_TOPUP_AMOUNT': os.getenv('MAX_TOPUP_AMOUNT', '100000'),
        }
        
        return jsonify({**db_settings, **env_settings})
    finally:
        conn.close()

@app.route('/api/panel/settings', methods=['PUT'])
@require_auth
def update_settings():
    """Обновить настройки системы"""
    data = request.json
    import os
    conn = database.get_db_connection()
    cursor = conn.cursor()
    
    try:
        # Обновляем настройки в БД
        for key, value in data.items():
            if key not in ['MINIAPP_URL', 'PANEL_URL', 'API_URL', 'BOT_USERNAME', 'TRIAL_HOURS', 'MIN_TOPUP_AMOUNT', 'MAX_TOPUP_AMOUNT']:
                cursor.execute("""
                    INSERT OR REPLACE INTO system_settings (setting_key, setting_value, updated_at)
                    VALUES (?, ?, CURRENT_TIMESTAMP)
                """, (key, str(value)))
        
        conn.commit()
        return jsonify({'success': True})
    finally:
        conn.close()

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
        providers = ['yookassa', 'heleket', 'platega']
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
        if provider == 'yookassa':
            if 'shop_id' in data:
                os.environ['YOOKASSA_SHOP_ID'] = str(data['shop_id'])
            if 'secret_key' in data:
                os.environ['YOOKASSA_SECRET_KEY'] = str(data['secret_key'])
        elif provider == 'heleket':
            if 'merchant' in data:
                os.environ['HELEKET_MERCHANT'] = str(data['merchant'])
            if 'api_key' in data:
                os.environ['HELEKET_API_KEY'] = str(data['api_key'])
        elif provider == 'platega':
            if 'merchant_id' in data:
                os.environ['PLATEGA_MERCHANT_ID'] = str(data['merchant_id'])
            if 'secret_key' in data:
                os.environ['PLATEGA_SECRET_KEY'] = str(data['secret_key'])
        
        return jsonify({'success': True})
    except Exception as e:
        logger.error(f"Error updating payment settings for {provider}: {e}")
        return jsonify({'error': str(e)}), 500
    finally:
        conn.close()

@app.route('/api/panel/remnawave/squads', methods=['GET'])
@require_auth
def get_remnawave_squads():
    """Получить список сквадов из Remnawave"""
    try:
        import asyncio
        from backend.api.remnawave import get_remnawave_api, RemnaWaveAPI
        
        async def fetch_squads():
            api = get_remnawave_api()
            async with api as connected_api:
                internal_squads = await connected_api.get_internal_squads()
                return [{'uuid': s.uuid, 'name': s.name, 'members_count': s.members_count} for s in internal_squads]
        
        squads = asyncio.run(fetch_squads())
        return jsonify(squads)
    except Exception as e:
        logger.error(f"Error fetching Remnawave squads: {e}")
        return jsonify({'error': str(e)}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=int(os.getenv('API_PORT', 8000)))

