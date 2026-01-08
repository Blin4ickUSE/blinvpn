"""
API модуль для работы с Remnawave
Полная интеграция со всеми функциями Remnawave API
"""
import os
import requests
import logging
from typing import Optional, Dict, Any, List
from datetime import datetime, timedelta

logger = logging.getLogger(__name__)

REMWAVE_API_URL = os.getenv('REMWAVE_API_URL', 'https://api.remnawave.com')
REMWAVE_API_KEY = os.getenv('REMWAVE_API_KEY', '')
REMWAVE_UUID = os.getenv('REMWAVE_UUID', '')

class RemnawaveAPI:
    """Класс для работы с Remnawave API"""
    
    def __init__(self):
        self.base_url = REMWAVE_API_URL
        self.api_key = REMWAVE_API_KEY
        self.uuid = REMWAVE_UUID
        self.headers = {
            'Authorization': f'Bearer {self.api_key}',
            'Content-Type': 'application/json'
        }
    
    def _request(self, method: str, endpoint: str, data: Dict = None) -> Optional[Dict]:
        """Базовый метод для выполнения запросов"""
        url = f"{self.base_url}{endpoint}"
        try:
            if method == 'GET':
                response = requests.get(url, headers=self.headers, params=data)
            elif method == 'POST':
                response = requests.post(url, headers=self.headers, json=data)
            elif method == 'PATCH':
                response = requests.patch(url, headers=self.headers, json=data)
            elif method == 'DELETE':
                response = requests.delete(url, headers=self.headers)
            else:
                raise ValueError(f"Unsupported method: {method}")
            
            response.raise_for_status()
            return response.json() if response.content else None
        except requests.exceptions.RequestException as e:
            logger.error(f"Remnawave API error: {e}")
            return None
    
    def create_user(self, telegram_id: int, username: str = None, email: str = None) -> Optional[Dict]:
        """Создать нового пользователя в Remnawave"""
        data = {
            'telegramId': telegram_id,
            'username': username or f"user_{telegram_id}",
            'email': email
        }
        return self._request('POST', '/api/users', data)
    
    def get_user_by_telegram_id(self, telegram_id: int) -> Optional[Dict]:
        """Получить пользователя по Telegram ID"""
        return self._request('GET', f'/api/users/by-telegram-id/{telegram_id}')
    
    def get_user_by_uuid(self, uuid: str) -> Optional[Dict]:
        """Получить пользователя по UUID"""
        return self._request('GET', f'/api/users/{uuid}')
    
    def create_subscription(self, user_uuid: str, days: int, traffic_limit: int = None) -> Optional[Dict]:
        """Создать подписку для пользователя"""
        expiry_date = (datetime.now() + timedelta(days=days)).isoformat()
        data = {
            'userUuid': user_uuid,
            'expiryDate': expiry_date,
            'trafficLimit': traffic_limit
        }
        return self._request('POST', '/api/subscriptions', data)
    
    def get_subscription_by_username(self, username: str) -> Optional[Dict]:
        """Получить подписку по username"""
        return self._request('GET', f'/api/subscriptions/by-username/{username}')
    
    def get_subscription_by_uuid(self, uuid: str) -> Optional[Dict]:
        """Получить подписку по UUID"""
        return self._request('GET', f'/api/subscriptions/by-uuid/{uuid}')
    
    def update_subscription(self, uuid: str, expiry_date: str = None, traffic_limit: int = None) -> Optional[Dict]:
        """Обновить подписку"""
        data = {}
        if expiry_date:
            data['expiryDate'] = expiry_date
        if traffic_limit is not None:
            data['trafficLimit'] = traffic_limit
        return self._request('PATCH', f'/api/subscriptions/by-uuid/{uuid}', data)
    
    def revoke_subscription(self, uuid: str) -> bool:
        """Отозвать подписку"""
        result = self._request('POST', f'/api/users/{uuid}/actions/revoke')
        return result is not None
    
    def disable_user(self, uuid: str) -> bool:
        """Отключить пользователя"""
        result = self._request('POST', f'/api/users/{uuid}/actions/disable')
        return result is not None
    
    def enable_user(self, uuid: str) -> bool:
        """Включить пользователя"""
        result = self._request('POST', f'/api/users/{uuid}/actions/enable')
        return result is not None
    
    def reset_traffic(self, uuid: str) -> bool:
        """Сбросить трафик пользователя"""
        result = self._request('POST', f'/api/users/{uuid}/actions/reset-traffic')
        return result is not None
    
    def get_all_subscriptions(self, size: int = 25, start: int = 0) -> Optional[List[Dict]]:
        """Получить все подписки"""
        return self._request('GET', '/api/subscriptions', {'size': size, 'start': start})
    
    def get_settings(self) -> Optional[Dict]:
        """Получить настройки Remnawave"""
        return self._request('GET', '/api/remnawave-settings')

# Глобальный экземпляр API
remnawave_api = RemnawaveAPI()

