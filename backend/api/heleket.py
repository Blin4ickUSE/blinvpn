"""
API модуль для работы с Heleket
Интеграция криптоплатежной системы Heleket
"""
import os
import json
import hashlib
import base64
import requests
import logging
from typing import Optional, Dict, Any
from datetime import datetime, timedelta

logger = logging.getLogger(__name__)

HELEKET_API_URL = os.getenv('HELEKET_API_URL', 'https://api.heleket.com')
HELEKET_MERCHANT = os.getenv('HELEKET_MERCHANT', '')
HELEKET_API_KEY = os.getenv('HELEKET_API_KEY', '')

class HeleketAPI:
    """Класс для работы с Heleket API"""
    
    def __init__(self):
        self.base_url = HELEKET_API_URL
        self.merchant = HELEKET_MERCHANT
        self.api_key = HELEKET_API_KEY
    
    def _generate_signature(self, data: Dict) -> str:
        """Генерация подписи для запроса"""
        json_data = json.dumps(data, separators=(',', ':'))
        encoded = base64.b64encode(json_data.encode()).decode()
        sign = hashlib.md5((encoded + self.api_key).encode()).hexdigest()
        return sign
    
    def _request(self, method: str, endpoint: str, data: Dict = None) -> Optional[Dict]:
        """Базовый метод для выполнения запросов"""
        url = f"{self.base_url}{endpoint}"
        data = data or {}
        
        try:
            sign = self._generate_signature(data)
            headers = {
                'merchant': self.merchant,
                'sign': sign,
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
            logger.error(f"Heleket API error: {e}")
            return None
    
    def create_payment(self, amount: float, order_id: str, currency: str = 'RUB',
                      url_return: str = None, url_success: str = None, 
                      url_callback: str = None, network: str = None,
                      to_currency: str = None) -> Optional[Dict]:
        """Создать платеж (счет-фактуру)"""
        data = {
            'amount': str(amount),
            'currency': currency,
            'order_id': order_id
        }
        
        if url_return:
            data['url_return'] = url_return
        if url_success:
            data['url_success'] = url_success
        if url_callback:
            data['url_callback'] = url_callback
        if network:
            data['network'] = network
        if to_currency:
            data['to_currency'] = to_currency
        
        return self._request('POST', '/v1/payment', data)
    
    def get_payment_status(self, order_id: str) -> Optional[Dict]:
        """Получить статус платежа"""
        return self._request('POST', '/v1/payment/status', {'order_id': order_id})
    
    def get_payment_services(self) -> Optional[Dict]:
        """Получить доступные платежные сервисы"""
        return self._request('POST', '/v1/payment/services', {})

heleket_api = HeleketAPI()

