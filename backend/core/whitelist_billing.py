"""
Модуль для обработки биллинга whitelist bypass
Обрабатывает превышение лимита трафика и списание средств
"""
import logging
from datetime import datetime, timedelta
from typing import Dict, Any, Optional
from backend.database import database
from backend.core import core

logger = logging.getLogger(__name__)

# Цена за ГБ при автоплатежах (когда осталось < 100 МБ)
AUTO_PAY_PRICE_PER_GB = 15.0
# Минимальный остаток трафика для автоплатежа (в МБ)
AUTO_PAY_THRESHOLD_MB = 100
# Минимальный баланс для автоплатежа
AUTO_PAY_MIN_BALANCE = 15.0
# Максимальный отрицательный баланс
MAX_NEGATIVE_BALANCE = -15.0

def calculate_whitelist_price(gb: int = 100, subscription_fee: float = 299.0, price_per_gb: float = 15.0, pricing_type: str = 'fixed') -> float:
    """
    Рассчитывает цену за whitelist bypass:
    - fixed: фиксированная цена 299₽/месяц с 100ГБ трафика
    - dynamic: абонентская плата + цена за ГБ
    
    По умолчанию: 299₽/месяц, 100ГБ трафика
    """
    if pricing_type == 'fixed':
        return subscription_fee  # 299₽ фиксированная цена
    
    # Динамическая цена (legacy)
    if gb < 5:
        gb = 5
    if gb > 500:
        gb = 500
    
    return subscription_fee + (gb * price_per_gb)

def check_and_process_auto_payment(user_id: int, vpn_key_id: int) -> Dict[str, Any]:
    """
    Проверяет остаток трафика и автоматически списывает 15₽/ГБ если осталось < 100 МБ
    Баланс может уйти в минус, но не сильнее чем на -15₽
    
    Args:
        user_id: ID пользователя
        vpn_key_id: ID VPN ключа
    
    Returns:
        Dict с результатом обработки
    """
    conn = database.get_db_connection()
    cursor = conn.cursor()
    
    try:
        # Получаем информацию о ключе
        cursor.execute("""
            SELECT traffic_used, traffic_limit, status
            FROM devices
            WHERE id = ? AND user_id = ?
        """, (vpn_key_id, user_id))
        
        result = cursor.fetchone()
        if not result:
            return {'error': 'VPN key not found'}
        
        traffic_used_bytes = result[0] or 0
        traffic_limit_bytes = result[1] or 0
        key_status = result[2]
        
        if traffic_limit_bytes == 0:
            return {'auto_pay_processed': False, 'reason': 'No traffic limit set'}
        
        # Вычисляем остаток в МБ
        remaining_bytes = traffic_limit_bytes - traffic_used_bytes
        remaining_mb = remaining_bytes / (1024 ** 2)
        
        # Если осталось >= 100 МБ, автоплатеж не нужен
        if remaining_mb >= AUTO_PAY_THRESHOLD_MB:
            return {'auto_pay_processed': False, 'remaining_mb': remaining_mb}
        
        # Получаем баланс пользователя
        user = database.get_user_by_id(user_id)
        if not user:
            return {'error': 'User not found'}
        
        current_balance = user.get('balance', 0)
        
        # Проверяем, можем ли списать (баланс >= 15₽ или баланс > -15₽ после списания)
        charge_amount = AUTO_PAY_PRICE_PER_GB  # 15₽ за 1 ГБ
        
        # Проверяем, не уйдет ли баланс ниже -15₽
        if current_balance - charge_amount < MAX_NEGATIVE_BALANCE:
            return {
                'auto_pay_processed': False,
                'reason': 'Balance would go below -15₽',
                'current_balance': current_balance,
                'required': charge_amount
            }
        
        # Проверяем минимальный баланс для автоплатежа
        if current_balance < AUTO_PAY_MIN_BALANCE and current_balance >= 0:
            return {
                'auto_pay_processed': False,
                'reason': 'Balance below minimum threshold',
                'current_balance': current_balance,
                'required': AUTO_PAY_MIN_BALANCE
            }
        
        # Списываем баланс (может уйти в минус до -15₽)
        new_balance = current_balance - charge_amount
        cursor.execute("""
            UPDATE users
            SET balance = ?
            WHERE id = ?
        """, (new_balance, user_id))
        
        # Увеличиваем лимит на 1 ГБ
        new_limit_bytes = traffic_limit_bytes + (1024 ** 3)  # +1 ГБ
        cursor.execute("""
            UPDATE devices
            SET traffic_limit = ?
            WHERE id = ?
        """, (new_limit_bytes, vpn_key_id))
        
        # Создаем транзакцию
        cursor.execute("""
            INSERT INTO transactions (user_id, type, amount, status, description, payment_method)
            VALUES (?, 'whitelist_auto_pay', ?, 'Success', ?, 'Balance')
        """, (user_id, -charge_amount, f'Автоплатеж whitelist: +1 ГБ (остаток был {remaining_mb:.2f} МБ)'))
        
        conn.commit()
        
        # Уведомляем пользователя
        core.send_notification_to_user(
            user['telegram_id'],
            f"💳 Автоплатеж: добавлено 1 ГБ трафика за {charge_amount}₽. "
            f"Остаток баланса: {new_balance:.2f}₽"
        )
        
        return {
            'auto_pay_processed': True,
            'charged': charge_amount,
            'new_balance': new_balance,
            'traffic_added_gb': 1.0,
            'remaining_mb_before': remaining_mb
        }
    finally:
        conn.close()

def process_whitelist_overage(user_id: int, vpn_key_id: int, traffic_bytes: float, 
                              whitelist_limit_gb: float) -> Dict[str, Any]:
    """
    Обрабатывает превышение лимита whitelist трафика
    Теперь используется для автоплатежей: если осталось < 100 МБ, списывает 15₽/ГБ
    
    Args:
        user_id: ID пользователя
        vpn_key_id: ID VPN ключа
        traffic_bytes: Использованный трафик в байтах
        whitelist_limit_gb: Лимит whitelist в ГБ
    
    Returns:
        Dict с результатом обработки
    """
    # Проверяем автоплатеж
    auto_pay_result = check_and_process_auto_payment(user_id, vpn_key_id)
    if auto_pay_result.get('auto_pay_processed'):
        return auto_pay_result
    
    return {'overage_detected': False, 'auto_pay_checked': True}

