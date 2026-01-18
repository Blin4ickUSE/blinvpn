"""
Модуль для обработки webhook'ов от платежных систем
"""
import os
import logging
import asyncio
from typing import Dict, Any, Optional
from flask import Flask, request, jsonify
from backend.api import yookassa, heleket, platega
from backend.database import database
from backend.core import core
from backend.api.yookassa_nalog import nalog_service

logger = logging.getLogger(__name__)

app = Flask(__name__)

def notify_admin_about_deposit(user: Dict, amount: float, method: str, provider: str):
    """Уведомить администратора только о успешном пополнении баланса"""
    username = user.get('username', 'N/A')
    telegram_id = user.get('telegram_id', 'N/A')
    
    message = (
        f"💰 <b>Пополнение баланса</b>\n\n"
        f"👤 Пользователь: @{username}\n"
        f"🆔 Telegram ID: {telegram_id}\n"
        f"💵 Сумма: {amount}₽\n"
        f"💳 Способ: {method}\n"
        f"🏦 Провайдер: {provider}"
    )
    
    core.send_notification_to_admin(message)

@app.route('/yookassa', methods=['POST'])
def yookassa_webhook():
    """Обработка webhook от YooKassa"""
    try:
        data = request.json
        event = data.get('event')
        object_data = data.get('object', {})
        
        logger.info(f"YooKassa webhook: event={event}, payment_id={object_data.get('id')}")
        
        if event == 'payment.succeeded':
            payment_id = object_data.get('id')
            amount = float(object_data.get('amount', {}).get('value', 0))
            metadata = object_data.get('metadata', {})
            user_id = metadata.get('user_id')
            
            if not user_id:
                logger.warning(f"YooKassa webhook без user_id: {payment_id}")
                return jsonify({'status': 'ok'}), 200
            
            user_id = int(user_id)
            
            # Проверяем, не был ли уже обработан этот платеж
            conn = database.get_db_connection()
            cursor = conn.cursor()
            cursor.execute(
                "SELECT id FROM transactions WHERE payment_id = ? AND payment_provider = 'YooKassa'",
                (payment_id,)
            )
            existing = cursor.fetchone()
            conn.close()
            
            if existing:
                logger.info(f"YooKassa платеж {payment_id} уже обработан")
                return jsonify({'status': 'ok'}), 200
            
            # Получаем информацию о методе оплаты
            payment_method = object_data.get('payment_method', {})
            payment_method_type = payment_method.get('type', 'bank_card')
            
            # Обновляем баланс пользователя
            database.update_user_balance(user_id, amount)
            
            # Создаем транзакцию
            conn = database.get_db_connection()
            cursor = conn.cursor()
            cursor.execute("""
                INSERT INTO transactions (user_id, type, amount, status, payment_method, payment_provider, payment_id)
                VALUES (?, 'deposit', ?, 'Success', ?, 'YooKassa', ?)
            """, (user_id, amount, 'СБП' if payment_method_type == 'sbp' else 'Карта', payment_id))
            conn.commit()
            conn.close()
            
            # Уведомление пользователю
            user = database.get_user_by_id(user_id)
            if user:
                msg = f"✅ Баланс пополнен на {amount}₽ через YooKassa"
                core.send_notification_to_user(user['telegram_id'], msg)
                
                # Уведомление администратору о пополнении
                notify_admin_about_deposit(
                    user, amount, 
                    'СБП' if payment_method_type == 'sbp' else 'Банковская карта',
                    'YooKassa'
                )
                
                # Создание чека через "Мой Налог" (если включено)
                if nalog_service.is_configured:
                    try:
                        # Используем дефолтное описание из service_name (настроено через панель или переменную окружения)
                        receipt_uuid = asyncio.run(nalog_service.process_yookassa_payment(
                            payment_id=payment_id,
                            amount=amount,
                            user_id=user_id,
                            telegram_id=user.get('telegram_id'),
                            description=None,  # Используется service_name по умолчанию
                        ))
                        if receipt_uuid:
                            logger.info(f"Создан чек {receipt_uuid} для платежа {payment_id}")
                    except Exception as e:
                        logger.error(f"Ошибка создания чека для платежа {payment_id}: {e}")
            
            logger.info(f"YooKassa платеж {payment_id} успешно обработан: {amount}₽ для user {user_id}")
        
        elif event == 'payment.canceled':
            payment_id = object_data.get('id')
            logger.info(f"YooKassa платеж {payment_id} отменен")
        
        return jsonify({'status': 'ok'}), 200
    except Exception as e:
        logger.error(f"YooKassa webhook error: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/heleket', methods=['POST'])
def heleket_webhook():
    """Обработка webhook от Heleket"""
    try:
        data = request.json
        
        logger.info(f"Heleket webhook: {data}")
        
        # Проверяем подпись
        if not heleket.heleket_api.verify_webhook_signature(data):
            logger.error("Heleket webhook: неверная подпись")
            return jsonify({'error': 'Invalid signature'}), 401
        
        status = data.get('status', '').lower()
        order_id = data.get('order_id', '')
        uuid = data.get('uuid', '')
        amount = float(data.get('amount', 0))
        payer_amount = data.get('payer_amount')
        payer_currency = data.get('payer_currency')
        
        if status in ('paid', 'paid_over'):
            # Извлекаем user_id из order_id (формат: heleket_{user_id}_{timestamp}_{hex})
            parts = order_id.split('_')
            if len(parts) >= 2 and parts[0] == 'heleket':
                user_id = int(parts[1])
                
                # Проверяем, не был ли уже обработан этот платеж
                conn = database.get_db_connection()
                cursor = conn.cursor()
                cursor.execute(
                    "SELECT id FROM transactions WHERE payment_id = ? AND payment_provider = 'Heleket'",
                    (uuid or order_id,)
                )
                existing = cursor.fetchone()
                conn.close()
                
                if existing:
                    logger.info(f"Heleket платеж {uuid or order_id} уже обработан")
                    return jsonify({'status': 'ok'}), 200
                
                # Обновляем баланс
                database.update_user_balance(user_id, amount)
                
                # Создаем транзакцию
                conn = database.get_db_connection()
                cursor = conn.cursor()
                description = f"Пополнение через Heleket"
                if payer_amount and payer_currency:
                    description += f" ({payer_amount} {payer_currency})"
                    
                cursor.execute("""
                    INSERT INTO transactions (user_id, type, amount, status, payment_method, payment_provider, payment_id, description)
                    VALUES (?, 'deposit', ?, 'Success', 'Crypto', 'Heleket', ?, ?)
                """, (user_id, amount, uuid or order_id, description))
                conn.commit()
                conn.close()
                
                # Уведомление пользователю
                user = database.get_user_by_id(user_id)
                if user:
                    msg = f"✅ Баланс пополнен на {amount}₽ через Heleket"
                    if payer_amount and payer_currency:
                        msg += f"\n🪙 Оплата: {payer_amount} {payer_currency}"
                    core.send_notification_to_user(user['telegram_id'], msg)
                    
                    # Уведомление администратору о пополнении
                    notify_admin_about_deposit(user, amount, 'Криптовалюта', 'Heleket')
                
                logger.info(f"Heleket платеж {uuid or order_id} успешно обработан: {amount}₽ для user {user_id}")
            else:
                logger.error(f"Heleket webhook: некорректный order_id {order_id}")
        
        return jsonify({'status': 'ok'}), 200
    except Exception as e:
        logger.error(f"Heleket webhook error: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/platega', methods=['POST'])
def platega_webhook():
    """Обработка webhook от Platega"""
    try:
        data = request.json
        
        logger.info(f"Platega webhook: {data}")
        
        # Проверяем подпись если есть
        signature = request.headers.get('Signature', '')
        if signature and not platega.platega_api.verify_webhook_signature(data, signature):
            logger.error("Platega webhook: неверная подпись")
            return jsonify({'error': 'Invalid signature'}), 401
        
        status = str(data.get('status', '')).upper()
        transaction_id = data.get('transactionId') or data.get('id')
        payload = data.get('payload', '')
        amount_kopeks = data.get('amount', 0)
        amount = amount_kopeks / 100 if amount_kopeks else 0
        
        if status == 'CONFIRMED':
            # Извлекаем user_id из payload (формат: platega:platega_{user_id}_{timestamp})
            user_id = None
            if payload and payload.startswith('platega:'):
                correlation_id = payload.replace('platega:', '')
                parts = correlation_id.split('_')
                if len(parts) >= 2 and parts[0] == 'platega':
                    user_id = int(parts[1])
            
            if not user_id:
                logger.error(f"Platega webhook: не удалось извлечь user_id из payload {payload}")
                return jsonify({'status': 'ok'}), 200
            
            # Проверяем, не был ли уже обработан этот платеж
            conn = database.get_db_connection()
            cursor = conn.cursor()
            cursor.execute(
                "SELECT id FROM transactions WHERE payment_id = ? AND payment_provider = 'Platega'",
                (transaction_id,)
            )
            existing = cursor.fetchone()
            conn.close()
            
            if existing:
                logger.info(f"Platega платеж {transaction_id} уже обработан")
                return jsonify({'status': 'ok'}), 200
            
            # Определяем метод оплаты из данных
            payment_method = data.get('paymentMethod', 0)
            method_name = 'СБП' if payment_method == 1 else 'Карта'
            
            # Обновляем баланс
            database.update_user_balance(user_id, amount)
            
            # Создаем транзакцию
            conn = database.get_db_connection()
            cursor = conn.cursor()
            cursor.execute("""
                INSERT INTO transactions (user_id, type, amount, status, payment_method, payment_provider, payment_id)
                VALUES (?, 'deposit', ?, 'Success', ?, 'Platega', ?)
            """, (user_id, amount, method_name, transaction_id))
            conn.commit()
            conn.close()
            
            # Уведомление пользователю
            user = database.get_user_by_id(user_id)
            if user:
                core.send_notification_to_user(
                    user['telegram_id'], 
                    f"✅ Баланс пополнен на {amount}₽ через Platega ({method_name})"
                )
                
                # Уведомление администратору о пополнении
                notify_admin_about_deposit(user, amount, method_name, 'Platega')
            
            logger.info(f"Platega платеж {transaction_id} успешно обработан: {amount}₽ для user {user_id}")
        
        return jsonify({'status': 'ok'}), 200
    except Exception as e:
        logger.error(f"Platega webhook error: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/health', methods=['GET'])
def health_check():
    """Проверка здоровья сервиса"""
    return jsonify({
        'status': 'ok',
        'yookassa_configured': yookassa.yookassa_api.is_configured(),
        'heleket_configured': heleket.heleket_api.is_configured,
        'platega_configured': platega.platega_api.is_configured
    })

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=int(os.getenv('WEBHOOK_PORT', 5000)))
