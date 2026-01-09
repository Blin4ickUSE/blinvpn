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

# Цена за ГБ при превышении лимита
OVER_LIMIT_PRICE_PER_GB = 10.0

def calculate_whitelist_price(gb: int) -> float:
    """
    Рассчитывает цену за whitelist bypass по прогрессивной системе:
    5-9 ГБ: 30₽/ГБ
    10-14 ГБ: 25₽/ГБ
    15-24 ГБ: 20₽/ГБ
    25-50 ГБ: 15₽/ГБ
    """
    if gb < 5:
        gb = 5
    if gb > 50:
        gb = 50
    
    total = 0.0
    
    # 5-9 ГБ: 30₽/ГБ
    if gb >= 5:
        tier1 = min(gb, 9) - 4  # ГБ с 5 по 9 (включительно)
        total += tier1 * 30.0
    
    # 10-14 ГБ: 25₽/ГБ
    if gb >= 10:
        tier2 = min(gb, 14) - 9  # ГБ с 10 по 14 (включительно)
        total += tier2 * 25.0
    
    # 15-24 ГБ: 20₽/ГБ
    if gb >= 15:
        tier3 = min(gb, 24) - 14  # ГБ с 15 по 24 (включительно)
        total += tier3 * 20.0
    
    # 25-50 ГБ: 15₽/ГБ
    if gb >= 25:
        tier4 = gb - 24  # ГБ с 25 по 50 (включительно)
        total += tier4 * 15.0
    
    return total

def process_whitelist_overage(user_id: int, vpn_key_id: int, traffic_bytes: float, 
                              whitelist_limit_gb: float) -> Dict[str, Any]:
    """
    Обрабатывает превышение лимита whitelist трафика
    Списывает с баланса по 10₽ за каждый ГБ превышения
    
    Args:
        user_id: ID пользователя
        vpn_key_id: ID VPN ключа
        traffic_bytes: Использованный трафик в байтах
        whitelist_limit_gb: Лимит whitelist в ГБ
    
    Returns:
        Dict с результатом обработки
    """
    conn = database.get_db_connection()
    cursor = conn.cursor()
    
    try:
        # Получаем текущее использование трафика за месяц
        # Предполагаем, что whitelist лимит хранится в traffic_limit ключа
        cursor.execute("""
            SELECT traffic_used, traffic_limit
            FROM vpn_keys
            WHERE id = ?
        """, (vpn_key_id,))
        
        result = cursor.fetchone()
        if not result:
            return {'error': 'VPN key not found'}
        
        current_traffic_bytes = result[0] or 0
        traffic_limit_bytes = (whitelist_limit_gb * (1024 ** 3)) if whitelist_limit_gb else 0
        
        # Конвертируем в ГБ
        current_traffic_gb = current_traffic_bytes / (1024 ** 3)
        limit_gb = traffic_limit_bytes / (1024 ** 3) if traffic_limit_bytes > 0 else 0
        
        # Новое использование после добавления трафика
        new_traffic_gb = (current_traffic_bytes + traffic_bytes) / (1024 ** 3)
        
        # Если превышен лимит, списываем за превышение
        if limit_gb > 0 and new_traffic_gb > limit_gb:
            overage_gb = new_traffic_gb - limit_gb
            charge_amount = overage_gb * OVER_LIMIT_PRICE_PER_GB
            
            # Получаем баланс пользователя
            user = database.get_user_by_id(user_id)
            if not user:
                return {'error': 'User not found'}
            
            current_balance = user.get('balance', 0)
            
            # Если баланса достаточно, списываем
            if current_balance >= charge_amount:
                deducted = database.update_user_balance(user_id, -charge_amount, ensure_non_negative=True)
                if deducted:
                    # Создаем транзакцию
                    cursor.execute("""
                        INSERT INTO transactions (user_id, type, amount, status, description, payment_method)
                        VALUES (?, 'whitelist_overage', ?, 'Success', ?, 'Balance')
                    """, (user_id, -charge_amount, f'Превышение лимита whitelist: {overage_gb:.2f} ГБ'))
                    conn.commit()
                    
                    # Уведомляем пользователя
                    core.send_notification_to_user(
                        user['telegram_id'],
                        f"⚠️ Превышен лимит whitelist на {overage_gb:.2f} ГБ. "
                        f"Списано {charge_amount:.2f}₽ с баланса (10₽/ГБ). "
                        f"Остаток баланса: {current_balance - charge_amount:.2f}₽"
                    )
                    
                    return {
                        'overage_detected': True,
                        'overage_gb': overage_gb,
                        'charged': charge_amount,
                        'new_balance': current_balance - charge_amount
                    }
                else:
                    return {
                        'overage_detected': True,
                        'error': 'Failed to deduct balance',
                        'overage_gb': overage_gb,
                        'required_balance': charge_amount
                    }
            else:
                # Недостаточно баланса - отключаем пользователя от remnawave
                # Отключаем ключ
                cursor.execute("""
                    UPDATE vpn_keys
                    SET status = 'Suspended'
                    WHERE id = ?
                """, (vpn_key_id,))
                conn.commit()
                
                # Уведомляем пользователя
                core.send_notification_to_user(
                    user['telegram_id'],
                    f"❌ Превышен лимит whitelist на {overage_gb:.2f} ГБ. "
                    f"Недостаточно средств на балансе ({current_balance:.2f}₽). "
                    f"Требуется: {charge_amount:.2f}₽. "
                    f"Доступ приостановлен. Пополните баланс для продолжения работы."
                )
                
                return {
                    'overage_detected': True,
                    'suspended': True,
                    'overage_gb': overage_gb,
                    'required_balance': charge_amount,
                    'current_balance': current_balance
                }
        
        return {'overage_detected': False}
    finally:
        conn.close()

