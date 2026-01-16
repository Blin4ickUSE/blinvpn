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
            
            # Проверяем, сохранен ли способ оплаты для рекуррентных платежей
            payment_method = object_data.get('payment_method', {})
            payment_method_id = payment_method.get('id')
            payment_method_saved = payment_method.get('saved', False)
            
            if user_id:
                # Сохраняем способ оплаты, если он был сохранен
                if payment_method_saved and payment_method_id:
                    conn = database.get_db_connection()
                    cursor = conn.cursor()
                    try:
                        card_info = payment_method.get('card', {})
                        cursor.execute("""
                            INSERT OR REPLACE INTO saved_payment_methods 
                            (user_id, payment_provider, payment_method_id, payment_method_type, 
                             card_last4, card_brand, is_active)
                            VALUES (?, 'YooKassa', ?, ?, ?, ?, 1)
                        """, (
                            int(user_id),
                            payment_method_id,
                            payment_method.get('type', 'bank_card'),
                            card_info.get('last4'),
                            card_info.get('card_type')
                        ))
                        conn.commit()
                        logger.info(f"Сохранен способ оплаты {payment_method_id} для пользователя {user_id}")
                    except Exception as e:
                        logger.error(f"Ошибка сохранения способа оплаты: {e}")
                    finally:
                        conn.close()
                
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
                    msg = f"Баланс пополнен на {amount}₽ через YooKassa"
                    if payment_method_saved:
                        msg += "\n💳 Способ оплаты сохранен для автоплатежей"
                    core.send_notification_to_user(user['telegram_id'], msg)
        
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

