"""
API модуль для работы с Platega
Интеграция платежной системы Platega
"""
import os
import requests
import logging
from typing import Optional, Dict, Any
import hmac
import hashlib
import json

logger = logging.getLogger(__name__)

PLATEGA_API_URL = os.getenv('PLATEGA_API_URL', 'https://api.platega.com')
PLATEGA_MERCHANT_ID = os.getenv('PLATEGA_MERCHANT_ID', '')
PLATEGA_SECRET_KEY = os.getenv('PLATEGA_SECRET_KEY', '')

class PlategaAPI:
    """Класс для работы с Platega API"""
    
    def __init__(self):
        self.base_url = PLATEGA_API_URL
        self.merchant_id = PLATEGA_MERCHANT_ID
        self.secret_key = PLATEGA_SECRET_KEY
    
    def _generate_signature(self, data: Dict) -> str:
        """Генерация подписи для запроса"""
        json_data = json.dumps(data, separators=(',', ':'))
        signature = hmac.new(
            self.secret_key.encode(),
            json_data.encode(),
            hashlib.sha256
        ).hexdigest()
        return signature
    
    def _request(self, method: str, endpoint: str, data: Dict = None) -> Optional[Dict]:
        """Базовый метод для выполнения запросов"""
        url = f"{self.base_url}{endpoint}"
        data = data or {}
        
        try:
            signature = self._generate_signature(data)
            headers = {
                'Merchant-ID': self.merchant_id,
                'Signature': signature,
                'Content-Type': 'application/json'
            }
            
            if method == 'POST':
                response = requests.post(url, headers=headers, json=data)
            elif method == 'GET':
                response = requests.get(url, headers=headers, params=data)
            else:
                raise ValueError(f"Unsupported method: {method}")
            
            response.raise_for_status()
            return response.json() if response.content else None
        except requests.exceptions.RequestException as e:
            logger.error(f"Platega API error: {e}")
            return None
    
    def create_payment(self, amount: float, order_id: str, description: str = None,
                      return_url: str = None, callback_url: str = None) -> Optional[Dict]:
        """Создать платеж"""
        data = {
            'amount': amount,
            'order_id': order_id,
            'currency': 'RUB'
        }
        
        if description:
            data['description'] = description
        if return_url:
            data['return_url'] = return_url
        if callback_url:
            data['callback_url'] = callback_url
        
        return self._request('POST', '/api/v1/payments', data)
    
    def get_payment_status(self, order_id: str) -> Optional[Dict]:
        """Получить статус платежа"""
        return self._request('GET', f'/api/v1/payments/{order_id}')

platega_api = PlategaAPI()

