"""
API модуль для работы с YooKassa
Интеграция платежной системы YooKassa
"""
import os
import uuid
import logging
from typing import Optional, Dict, Any
from yookassa import Configuration, Payment, Refund

logger = logging.getLogger(__name__)

YOOKASSA_SHOP_ID = os.getenv('YOOKASSA_SHOP_ID', '')
YOOKASSA_SECRET_KEY = os.getenv('YOOKASSA_SECRET_KEY', '')

# Настройка YooKassa
if YOOKASSA_SHOP_ID and YOOKASSA_SECRET_KEY:
    Configuration.account_id = YOOKASSA_SHOP_ID
    Configuration.secret_key = YOOKASSA_SECRET_KEY

class YooKassaAPI:
    """Класс для работы с YooKassa API"""
    
    @staticmethod
    def is_configured() -> bool:
        """Проверить, настроен ли YooKassa"""
        return bool(YOOKASSA_SHOP_ID and YOOKASSA_SECRET_KEY)
    
    @staticmethod
    def create_payment(amount: float, description: str, return_url: str, 
                      user_id: int = None, metadata: Dict = None, 
                      save_payment_method: bool = False, 
                      payment_method_id: str = None,
                      payment_type: str = 'bank_card') -> Optional[Dict]:
        """Создать платеж в YooKassa
        
        Args:
            amount: Сумма платежа
            description: Описание платежа
            return_url: URL для возврата после оплаты
            user_id: ID пользователя
            metadata: Дополнительные метаданные
            save_payment_method: Сохранить способ оплаты для автоплатежей
            payment_method_id: ID сохраненного способа оплаты для автоплатежа
            payment_type: Тип платежа ('bank_card', 'sbp')
        """
        if not YooKassaAPI.is_configured():
            logger.error("YooKassa не настроен: отсутствуют SHOP_ID или SECRET_KEY")
            return None
            
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
                if payment_type == 'sbp':
                    # СБП платеж через YooKassa
                    payment_data["confirmation"] = {
                        "type": "redirect",
                        "return_url": return_url
                    }
                    payment_data["payment_method_data"] = {
                        "type": "sbp"
                    }
                else:
                    # Банковская карта
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
            
            idempotence_key = str(uuid.uuid4())
            payment = Payment.create(payment_data, idempotence_key)
            
            result = {
                'id': payment.id,
                'status': payment.status,
                'confirmation_url': None,
                'amount': float(payment.amount.value),
                'paid': payment.paid
            }
            
            # Получаем URL подтверждения
            if payment.confirmation:
                result['confirmation_url'] = payment.confirmation.confirmation_url
            
            # Если способ оплаты сохранен, добавляем его ID
            if hasattr(payment, 'payment_method') and payment.payment_method:
                if hasattr(payment.payment_method, 'saved') and payment.payment_method.saved:
                    result['payment_method_id'] = payment.payment_method.id
                    result['payment_method_saved'] = True
                    if hasattr(payment.payment_method, 'card') and payment.payment_method.card:
                        result['card_last4'] = payment.payment_method.card.last4
                        result['card_brand'] = payment.payment_method.card.card_type
            
            logger.info(f"YooKassa платеж создан: {payment.id} на сумму {amount}₽")
            return result
            
        except Exception as e:
            logger.error(f"YooKassa payment creation error: {e}")
            return None
    
    @staticmethod
    def create_sbp_payment(amount: float, description: str, return_url: str,
                          user_id: int = None, metadata: Dict = None) -> Optional[Dict]:
        """Создать СБП платеж через YooKassa"""
        return YooKassaAPI.create_payment(
            amount=amount,
            description=description,
            return_url=return_url,
            user_id=user_id,
            metadata=metadata,
            payment_type='sbp'
        )
    
    @staticmethod
    def get_payment_status(payment_id: str) -> Optional[Dict]:
        """Получить статус платежа"""
        if not YooKassaAPI.is_configured():
            return None
            
        try:
            payment = Payment.find_one(payment_id)
            result = {
                'id': payment.id,
                'status': payment.status,
                'paid': payment.paid,
                'amount': float(payment.amount.value),
                'created_at': payment.created_at.isoformat() if payment.created_at else None,
                'refundable': getattr(payment, 'refundable', False)
            }
            
            # Проверяем, сохранен ли способ оплаты
            if hasattr(payment, 'payment_method') and payment.payment_method:
                result['payment_method_type'] = payment.payment_method.type
                if hasattr(payment.payment_method, 'saved') and payment.payment_method.saved:
                    result['payment_method_id'] = payment.payment_method.id
                    result['payment_method_saved'] = True
                    if hasattr(payment.payment_method, 'card') and payment.payment_method.card:
                        result['card_last4'] = payment.payment_method.card.last4
                        result['card_brand'] = payment.payment_method.card.card_type
            
            return result
        except Exception as e:
            logger.error(f"YooKassa get payment error: {e}")
            return None
    
    @staticmethod
    def create_refund(payment_id: str, amount: float = None, description: str = None) -> Optional[Dict]:
        """Создать возврат по платежу
        
        Args:
            payment_id: ID платежа в YooKassa
            amount: Сумма возврата (если None - полный возврат)
            description: Описание причины возврата
        """
        if not YooKassaAPI.is_configured():
            logger.error("YooKassa не настроен для возврата")
            return None
            
        try:
            # Сначала получаем информацию о платеже
            payment = Payment.find_one(payment_id)
            if not payment:
                logger.error(f"Платеж {payment_id} не найден")
                return None
            
            if payment.status != 'succeeded':
                logger.error(f"Невозможно сделать возврат: платеж {payment_id} в статусе {payment.status}")
                return None
            
            if not getattr(payment, 'refundable', True):
                logger.error(f"Платеж {payment_id} не подлежит возврату")
                return None
            
            # Определяем сумму возврата
            refund_amount = amount if amount else float(payment.amount.value)
            
            refund_data = {
                "payment_id": payment_id,
                "amount": {
                    "value": f"{refund_amount:.2f}",
                    "currency": payment.amount.currency
                }
            }
            
            if description:
                refund_data["description"] = description
            
            idempotence_key = str(uuid.uuid4())
            refund = Refund.create(refund_data, idempotence_key)
            
            result = {
                'id': refund.id,
                'status': refund.status,
                'amount': float(refund.amount.value),
                'payment_id': payment_id,
                'created_at': refund.created_at.isoformat() if hasattr(refund, 'created_at') and refund.created_at else None
            }
            
            logger.info(f"YooKassa возврат создан: {refund.id} на сумму {refund_amount}₽")
            return result
            
        except Exception as e:
            logger.error(f"YooKassa refund error: {e}")
            return None
    
    @staticmethod
    def cancel_payment(payment_id: str) -> bool:
        """Отменить платеж"""
        if not YooKassaAPI.is_configured():
            return False
            
        try:
            idempotence_key = str(uuid.uuid4())
            payment = Payment.cancel(payment_id, idempotence_key)
            return payment.status == 'canceled'
        except Exception as e:
            logger.error(f"YooKassa cancel payment error: {e}")
            return False

yookassa_api = YooKassaAPI()
