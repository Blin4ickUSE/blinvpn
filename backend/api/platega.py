"""
API модуль для работы с Platega
Интеграция платежной системы Platega для банковских карт и СБП
"""
import os
import requests
import logging
import hmac
import hashlib
import json
import time
import uuid
from typing import Optional, Dict, Any
from datetime import datetime

logger = logging.getLogger(__name__)

PLATEGA_API_URL = os.getenv('PLATEGA_API_URL', 'https://platega.io')
PLATEGA_MERCHANT_ID = os.getenv('PLATEGA_MERCHANT_ID', '')
PLATEGA_SECRET_KEY = os.getenv('PLATEGA_SECRET_KEY', '')
PLATEGA_API_KEY = os.getenv('PLATEGA_API_KEY', '')  # Альтернативный ключ API
PLATEGA_RETURN_URL = os.getenv('PLATEGA_RETURN_URL', '')
PLATEGA_FAILED_URL = os.getenv('PLATEGA_FAILED_URL', '')
PLATEGA_CALLBACK_URL = os.getenv('PLATEGA_CALLBACK_URL', '')

# Коды методов оплаты Platega
PLATEGA_METHOD_CARD = 0  # Банковская карта
PLATEGA_METHOD_SBP = 1   # СБП

# Статусы платежей
PLATEGA_SUCCESS_STATUSES = {"CONFIRMED"}
PLATEGA_FAILED_STATUSES = {"FAILED", "CANCELED", "EXPIRED"}
PLATEGA_PENDING_STATUSES = {"PENDING", "INPROGRESS"}


class PlategaAPI:
    """Класс для работы с Platega API"""
    
    def __init__(self):
        self.base_url = PLATEGA_API_URL.rstrip('/')
        self.merchant_id = PLATEGA_MERCHANT_ID
        self.secret_key = PLATEGA_SECRET_KEY
        self.api_key = PLATEGA_API_KEY or PLATEGA_SECRET_KEY
        self.return_url = PLATEGA_RETURN_URL
        self.failed_url = PLATEGA_FAILED_URL
        self.callback_url = PLATEGA_CALLBACK_URL
    
    @property
    def is_configured(self) -> bool:
        """Проверить, настроен ли Platega"""
        return bool(self.merchant_id and (self.secret_key or self.api_key))
    
    def _generate_signature(self, data: Dict) -> str:
        """Генерация подписи для запроса"""
        sorted_data = dict(sorted(data.items()))
        json_data = json.dumps(sorted_data, separators=(',', ':'), ensure_ascii=False)
        signature = hmac.new(
            self.secret_key.encode('utf-8'),
            json_data.encode('utf-8'),
            hashlib.sha256
        ).hexdigest()
        return signature
    
    def _request(self, method: str, endpoint: str, data: Dict = None) -> Optional[Dict]:
        """Базовый метод для выполнения запросов"""
        if not self.is_configured:
            logger.error("Platega не настроен: отсутствуют MERCHANT_ID или SECRET_KEY")
            return None
            
        url = f"{self.base_url}{endpoint}"
        data = data or {}
        
        try:
            # Подпись для данных
            signature = self._generate_signature(data) if data else ""
            
            # Пробуем разные варианты авторизации
            headers = {
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                'X-Merchant-ID': self.merchant_id,
                'X-Api-Key': self.api_key,
                'Authorization': f'Bearer {self.api_key}',
                'Merchant-ID': self.merchant_id,
                'Signature': signature,
            }
            
            logger.info(f"Platega request to {url}")
            
            if method == 'POST':
                response = requests.post(url, headers=headers, json=data, timeout=30)
            elif method == 'GET':
                response = requests.get(url, headers=headers, params=data, timeout=30)
            else:
                raise ValueError(f"Unsupported method: {method}")
            
            logger.info(f"Platega response status: {response.status_code}")
            
            response.raise_for_status()
            return response.json() if response.content else None
        except requests.exceptions.RequestException as e:
            logger.error(f"Platega API error: {e}")
            if hasattr(e, 'response') and e.response is not None:
                logger.error(f"Response: {e.response.text}")
            return None
    
    def create_payment(self, amount: float, user_id: int, description: str = None,
                      payment_method: int = PLATEGA_METHOD_CARD) -> Optional[Dict]:
        """Создать платеж через Platega"""
        if not self.is_configured:
            return None
            
        # Сумма в рублях (не в копейках - проверим оба варианта)
        amount_value = float(amount)
        amount_kopeks = int(amount * 100)
        
        # Уникальный ID для платежа
        correlation_id = uuid.uuid4().hex
        payload_token = f"platega:{correlation_id}"
        
        # Данные платежа - пробуем формат из example
        data = {
            'payment_method': payment_method,
            'amount': amount_value,  # в рублях
            'currency': 'RUB',
            'description': description or f'Пополнение баланса',
            'payload': payload_token,
            'return_url': self.return_url,
            'failed_url': self.failed_url,
        }
        
        # Убираем пустые поля
        data = {k: v for k, v in data.items() if v}
        
        result = self._request('POST', '/api/v1/payments', data)
        
        if result:
            logger.info(f"Platega платеж создан для пользователя {user_id} на сумму {amount}₽")
            return {
                'id': result.get('transactionId') or result.get('id'),
                'redirect_url': result.get('redirect'),
                'status': str(result.get('status', 'PENDING')).upper(),
                'correlation_id': correlation_id,
                'payload': payload_token,
                'amount': amount,
                'amount_kopeks': amount_kopeks
            }
        
        return None
    
    def create_card_payment(self, amount: float, user_id: int, description: str = None) -> Optional[Dict]:
        """Создать платеж банковской картой"""
        return self.create_payment(amount, user_id, description, PLATEGA_METHOD_CARD)
    
    def create_sbp_payment(self, amount: float, user_id: int, description: str = None) -> Optional[Dict]:
        """Создать СБП платеж"""
        return self.create_payment(amount, user_id, description, PLATEGA_METHOD_SBP)
    
    def get_payment_status(self, transaction_id: str) -> Optional[Dict]:
        """Получить статус платежа"""
        if not self.is_configured:
            return None
            
        result = self._request('GET', f'/api/v1/payments/{transaction_id}')
        
        if result:
            status = str(result.get('status', '')).upper()
            return {
                'id': transaction_id,
                'status': status,
                'is_paid': status in PLATEGA_SUCCESS_STATUSES,
                'is_failed': status in PLATEGA_FAILED_STATUSES,
                'is_pending': status in PLATEGA_PENDING_STATUSES,
                'amount': result.get('amount'),
                'paid_at': result.get('paidAt') or result.get('confirmedAt')
            }
        
        return None
    
    def verify_webhook_signature(self, payload: Dict, signature: str) -> bool:
        """Проверить подпись webhook"""
        if not self.is_configured:
            logger.warning("Platega не настроен, пропускаем проверку подписи")
            return True
        
        expected = self._generate_signature(payload)
        return hmac.compare_digest(expected, signature)


platega_api = PlategaAPI()
