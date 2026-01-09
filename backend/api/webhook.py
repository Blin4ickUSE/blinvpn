"""
Модуль для обработки webhook'ов от платежных систем
"""
import os
import logging
from typing import Dict, Any, Optional
from flask import Flask, request, jsonify
from backend.api import yookassa, heleket, platega
from backend.database import database
from backend.core import core

logger = logging.getLogger(__name__)

app = Flask(__name__)

@app.route('/yookassa', methods=['POST'])
def yookassa_webhook():
    """Обработка webhook от YooKassa"""
    try:
        data = request.json
        event = data.get('event')
        object_data = data.get('object', {})
        
        if event == 'payment.succeeded':
            payment_id = object_data.get('id')
            amount = float(object_data.get('amount', {}).get('value', 0))
            metadata = object_data.get('metadata', {})
            user_id = metadata.get('user_id')
            
            if user_id:
                # Обновляем баланс пользователя
                database.update_user_balance(int(user_id), amount)
                
                # Создаем транзакцию
                conn = database.get_db_connection()
                cursor = conn.cursor()
                cursor.execute("""
                    INSERT INTO transactions (user_id, type, amount, status, payment_method, payment_provider, payment_id)
                    VALUES (?, 'deposit', ?, 'Success', 'Card', 'YooKassa', ?)
                """, (int(user_id), amount, payment_id))
                conn.commit()
                conn.close()
                
                # Уведомление в бот
                user = database.get_user_by_id(int(user_id))
                if user:
                    core.send_notification_to_user(user['telegram_id'], f"Баланс пополнен на {amount}₽ через YooKassa")
        
        return jsonify({'status': 'ok'}), 200
    except Exception as e:
        logger.error(f"YooKassa webhook error: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/heleket', methods=['POST'])
def heleket_webhook():
    """Обработка webhook от Heleket"""
    try:
        data = request.json
        status = data.get('status')
        order_id = data.get('order_id')
        amount = float(data.get('amount', 0))
        
        if status == 'paid' or status == 'paid_over':
            # Получаем user_id из order_id (формат: user_{user_id}_{timestamp})
            parts = order_id.split('_')
            if len(parts) >= 2 and parts[0] == 'user':
                user_id = int(parts[1])
                
                # Обновляем баланс
                database.update_user_balance(user_id, amount)
                
                # Создаем транзакцию
                conn = database.get_db_connection()
                cursor = conn.cursor()
                cursor.execute("""
                    INSERT INTO transactions (user_id, type, amount, status, payment_method, payment_provider, payment_id)
                    VALUES (?, 'deposit', ?, 'Success', 'Crypto', 'Heleket', ?)
                """, (user_id, amount, order_id))
                conn.commit()
                conn.close()
                
                # Уведомление
                core.send_notification_to_user(user_id, f"Баланс пополнен на {amount}₽ через Heleket")
        
        return jsonify({'status': 'ok'}), 200
    except Exception as e:
        logger.error(f"Heleket webhook error: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/platega', methods=['POST'])
def platega_webhook():
    """Обработка webhook от Platega"""
    try:
        data = request.json
        status = data.get('status')
        order_id = data.get('order_id')
        amount = float(data.get('amount', 0))
        
        if status == 'success':
            # Получаем user_id из order_id
            parts = order_id.split('_')
            if len(parts) >= 2 and parts[0] == 'user':
                user_id = int(parts[1])
                
                # Обновляем баланс
                database.update_user_balance(user_id, amount)
                
                # Создаем транзакцию
                conn = database.get_db_connection()
                cursor = conn.cursor()
                cursor.execute("""
                    INSERT INTO transactions (user_id, type, amount, status, payment_method, payment_provider, payment_id)
                    VALUES (?, 'deposit', ?, 'Success', 'SBP', 'Platega', ?)
                """, (user_id, amount, order_id))
                conn.commit()
                conn.close()
                
                # Уведомление
                core.send_notification_to_user(user_id, f"Баланс пополнен на {amount}₽ через Platega")
        
        return jsonify({'status': 'ok'}), 200
    except Exception as e:
        logger.error(f"Platega webhook error: {e}")
        return jsonify({'error': str(e)}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=int(os.getenv('WEBHOOK_PORT', 5000)))

