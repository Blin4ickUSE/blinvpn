"""
API модуль для работы с YooKassa
Интеграция платежной системы YooKassa
"""
import os
import uuid
import logging
from typing import Optional, Dict, Any
from yookassa import Configuration, Payment

logger = logging.getLogger(__name__)

YOOKASSA_SHOP_ID = os.getenv('YOOKASSA_SHOP_ID', '')
YOOKASSA_SECRET_KEY = os.getenv('YOOKASSA_SECRET_KEY', '')

# Настройка YooKassa
Configuration.account_id = YOOKASSA_SHOP_ID
Configuration.secret_key = YOOKASSA_SECRET_KEY

class YooKassaAPI:
    """Класс для работы с YooKassa API"""
    
    @staticmethod
    def create_payment(amount: float, description: str, return_url: str, 
                      user_id: int = None, metadata: Dict = None, 
                      save_payment_method: bool = False, 
                      payment_method_id: str = None) -> Optional[Dict]:
        """Создать платеж в YooKassa
        
        Args:
            amount: Сумма платежа
            description: Описание платежа
            return_url: URL для возврата после оплаты
            user_id: ID пользователя
            metadata: Дополнительные метаданные
            save_payment_method: Сохранить способ оплаты для автоплатежей
            payment_method_id: ID сохраненного способа оплаты для автоплатежа
        """
        try:
            payment_data = {
                "amount": {
                    "value": f"{amount:.2f}",
                    "currency": "RUB"
                },
                "capture": True,
                "description": description
            }
            
            # Если используется сохраненный способ оплаты - автоплатеж
            if payment_method_id:
                payment_data["payment_method_id"] = payment_method_id
            else:
                # Обычный платеж с подтверждением
                payment_data["confirmation"] = {
                    "type": "redirect",
                    "return_url": return_url
                }
                # Сохранение способа оплаты для будущих автоплатежей
                if save_payment_method:
                    payment_data["save_payment_method"] = True
            
            if metadata:
                payment_data["metadata"] = metadata
            elif user_id:
                payment_data["metadata"] = {"user_id": str(user_id)}
            
            payment = Payment.create(payment_data, str(uuid.uuid4()))
            
            result = {
                'id': payment.id,
                'status': payment.status,
                'confirmation_url': payment.confirmation.confirmation_url if payment.confirmation else None,
                'amount': float(payment.amount.value),
                'paid': payment.paid
            }
            
            # Если способ оплаты сохранен, добавляем его ID
            if hasattr(payment, 'payment_method') and payment.payment_method:
                if hasattr(payment.payment_method, 'saved') and payment.payment_method.saved:
                    result['payment_method_id'] = payment.payment_method.id
                    result['payment_method_saved'] = True
                    if hasattr(payment.payment_method, 'card'):
                        result['card_last4'] = payment.payment_method.card.last4 if payment.payment_method.card else None
                        result['card_brand'] = payment.payment_method.card.card_type if payment.payment_method.card else None
            
            return result
        except Exception as e:
            logger.error(f"YooKassa payment creation error: {e}")
            return None
    
    @staticmethod
    def get_payment_status(payment_id: str) -> Optional[Dict]:
        """Получить статус платежа"""
        try:
            payment = Payment.find_one(payment_id)
            result = {
                'id': payment.id,
                'status': payment.status,
                'paid': payment.paid,
                'amount': float(payment.amount.value),
                'created_at': payment.created_at.isoformat() if payment.created_at else None
            }
            
            # Проверяем, сохранен ли способ оплаты
            if hasattr(payment, 'payment_method') and payment.payment_method:
                if hasattr(payment.payment_method, 'saved') and payment.payment_method.saved:
                    result['payment_method_id'] = payment.payment_method.id
                    result['payment_method_saved'] = True
                    if hasattr(payment.payment_method, 'card'):
                        result['card_last4'] = payment.payment_method.card.last4 if payment.payment_method.card else None
                        result['card_brand'] = payment.payment_method.card.card_type if payment.payment_method.card else None
            
            return result
        except Exception as e:
            logger.error(f"YooKassa get payment error: {e}")
            return None
    
    @staticmethod
    def cancel_payment(payment_id: str) -> bool:
        """Отменить платеж"""
        try:
            payment = Payment.cancel(payment_id, str(uuid.uuid4()))
            return payment.status == 'canceled'
        except Exception as e:
            logger.error(f"YooKassa cancel payment error: {e}")
            return False

yookassa_api = YooKassaAPI()

