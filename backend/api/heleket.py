"""
API модуль для работы с Heleket
Интеграция криптоплатежной системы Heleket
"""
import os
import json
import hashlib
import base64
import hmac
import requests
import logging
import time
import secrets
from typing import Optional, Dict, Any
from datetime import datetime

logger = logging.getLogger(__name__)

HELEKET_API_URL = os.getenv('HELEKET_API_URL', 'https://api.heleket.com')
HELEKET_MERCHANT = os.getenv('HELEKET_MERCHANT', '')
HELEKET_API_KEY = os.getenv('HELEKET_API_KEY', '')
HELEKET_CALLBACK_URL = os.getenv('HELEKET_CALLBACK_URL', '')
HELEKET_RETURN_URL = os.getenv('HELEKET_RETURN_URL', '')
HELEKET_SUCCESS_URL = os.getenv('HELEKET_SUCCESS_URL', '')
HELEKET_DEFAULT_CURRENCY = os.getenv('HELEKET_DEFAULT_CURRENCY', 'USDT')  # По умолчанию USDT
HELEKET_DEFAULT_NETWORK = os.getenv('HELEKET_DEFAULT_NETWORK', 'tron')    # По умолчанию TRC20
HELEKET_LIFETIME = int(os.getenv('HELEKET_LIFETIME', '3600'))  # Время жизни платежа в секундах


class HeleketAPI:
    """Класс для работы с Heleket API"""
    
    def __init__(self):
        self.base_url = HELEKET_API_URL.rstrip('/')
        self.merchant = HELEKET_MERCHANT
        self.api_key = HELEKET_API_KEY
    
    @property
    def is_configured(self) -> bool:
        """Проверить, настроен ли Heleket"""
        return bool(self.merchant and self.api_key)
    
    def _prepare_body(self, payload: Dict[str, Any], *, 
                     ignore_none: bool = True, 
                     sort_keys: bool = True) -> str:
        """Подготовить тело запроса для подписи"""
        if ignore_none:
            cleaned = {key: value for key, value in payload.items() if value is not None}
        else:
            cleaned = dict(payload)
        
        serialized = json.dumps(
            cleaned,
            ensure_ascii=False,
            separators=(',', ':'),
            sort_keys=sort_keys
        )
        
        # Экранируем слеши как требует Heleket
        if '/' in serialized:
            serialized = serialized.replace('/', '\\/')
        
        return serialized
    
    def _generate_signature(self, body: str) -> str:
        """Генерация подписи для запроса по документации Heleket"""
        api_key = self.api_key or ''
        # Base64 кодируем тело
        encoded = base64.b64encode(body.encode('utf-8')).decode('utf-8')
        # Конкатенируем с API ключом и хешируем MD5
        raw = f"{encoded}{api_key}"
        return hashlib.md5(raw.encode('utf-8')).hexdigest()
    
    def _request(self, endpoint: str, payload: Dict[str, Any]) -> Optional[Dict]:
        """Выполнить запрос к Heleket API"""
        if not self.is_configured:
            logger.error("Heleket не настроен: отсутствуют MERCHANT или API_KEY")
            return None
        
        body = self._prepare_body(payload, ignore_none=True, sort_keys=True)
        signature = self._generate_signature(body)
        
        url = f"{self.base_url}/{endpoint.lstrip('/')}"
        headers = {
            'merchant': self.merchant,
            'sign': signature,
            'Content-Type': 'application/json'
        }
        
        try:
            response = requests.post(
                url,
                data=body.encode('utf-8'),
                headers=headers,
                timeout=30
            )
            
            if response.headers.get('Content-Type', '').find('application/json') == -1:
                logger.error(f"Heleket вернул не JSON: {response.text}")
                return None
            
            try:
                data = response.json()
            except json.JSONDecodeError:
                logger.error(f"Ошибка парсинга JSON от Heleket: {response.text}")
                return None
            
            if response.status_code >= 400:
                logger.error(f"Heleket API {endpoint} вернул статус {response.status_code}: {data}")
                return None
            
            # Heleket возвращает state=0 при успехе
            if isinstance(data, dict) and data.get('state') == 0:
                return data
            
            logger.error(f"Heleket API вернул ошибку: {data}")
            return None
            
        except requests.exceptions.RequestException as e:
            logger.error(f"Ошибка запроса к Heleket API: {e}")
            return None
    
    def create_payment(self, amount: float, user_id: int, 
                      currency: str = 'RUB',
                      to_currency: str = None,
                      network: str = None) -> Optional[Dict]:
        """Создать криптоплатеж через Heleket
        
        Args:
            amount: Сумма в рублях
            user_id: ID пользователя
            currency: Валюта счета (RUB)
            to_currency: Криптовалюта (USDT, BTC, ETH и т.д.)
            network: Сеть блокчейна (tron, ethereum, bitcoin и т.д.)
        """
        if not self.is_configured:
            return None
        
        order_id = f"heleket_{user_id}_{int(time.time())}_{secrets.token_hex(3)}"
        
        payload: Dict[str, Any] = {
            'amount': f"{amount:.2f}",
            'currency': currency,
            'order_id': order_id,
            'lifetime': HELEKET_LIFETIME
        }
        
        # Криптовалюта для оплаты
        final_to_currency = (to_currency or HELEKET_DEFAULT_CURRENCY).strip()
        if final_to_currency:
            payload['to_currency'] = final_to_currency
        
        # Сеть блокчейна
        final_network = (network or HELEKET_DEFAULT_NETWORK).strip()
        if final_network:
            payload['network'] = final_network
        
        # URL'ы для callbacks
        if HELEKET_CALLBACK_URL:
            payload['url_callback'] = HELEKET_CALLBACK_URL
        if HELEKET_RETURN_URL:
            payload['url_return'] = HELEKET_RETURN_URL
        if HELEKET_SUCCESS_URL:
            payload['url_success'] = HELEKET_SUCCESS_URL
        
        result = self._request('v1/payment', payload)
        
        if not result:
            return None
        
        payment_result = result.get('result')
        if not payment_result:
            logger.error(f"Некорректный ответ Heleket: {result}")
            return None
        
        # Извлекаем данные из ответа
        uuid = str(payment_result.get('uuid', ''))
        response_order_id = payment_result.get('order_id') or order_id
        url = payment_result.get('url')
        status = payment_result.get('status') or payment_result.get('payment_status') or 'check'
        payer_amount = payment_result.get('payer_amount')
        payer_currency = payment_result.get('payer_currency')
        exchange_rate = payment_result.get('payer_amount_exchange_rate')
        
        # Вычисляем курс если не предоставлен
        exchange_rate_value = None
        if exchange_rate:
            try:
                exchange_rate_value = float(exchange_rate)
            except (TypeError, ValueError):
                pass
        
        if exchange_rate_value is None and payer_amount:
            try:
                exchange_rate_value = float(payer_amount) / amount if amount else None
            except (TypeError, ValueError, ZeroDivisionError):
                pass
        
        logger.info(f"Heleket платеж создан: {uuid} для пользователя {user_id} на сумму {amount}₽")
        
        return {
            'uuid': uuid,
            'order_id': response_order_id,
            'payment_url': url,
            'status': status,
            'amount': amount,
            'payer_amount': payer_amount,
            'payer_currency': payer_currency,
            'exchange_rate': exchange_rate_value
        }
    
    def get_payment_info(self, uuid: str = None, order_id: str = None) -> Optional[Dict]:
        """Получить информацию о платеже"""
        if not uuid and not order_id:
            raise ValueError("Нужно указать uuid или order_id")
        
        payload: Dict[str, Any] = {}
        if uuid:
            payload['uuid'] = uuid
        if order_id:
            payload['order_id'] = order_id
        
        result = self._request('v1/payment/info', payload)
        
        if result and result.get('result'):
            return result.get('result')
        
        return None
    
    def get_payment_status(self, order_id: str) -> Optional[Dict]:
        """Получить статус платежа (устаревший метод, для совместимости)"""
        return self.get_payment_info(order_id=order_id)
    
    def verify_webhook_signature(self, payload: Dict[str, Any]) -> bool:
        """Проверить подпись webhook от Heleket"""
        if not self.is_configured:
            logger.warning("Heleket не настроен, пропускаем проверку подписи")
            return True
        
        if not isinstance(payload, dict):
            logger.error(f"Heleket webhook payload не dict: {payload}")
            return False
        
        signature = payload.get('sign')
        if not signature:
            logger.error("Heleket webhook без подписи")
            return False
        
        # Убираем sign из payload перед проверкой
        data = dict(payload)
        data.pop('sign', None)
        
        # Для webhook не сортируем ключи
        body = self._prepare_body(data, ignore_none=False, sort_keys=False)
        expected = self._generate_signature(body)
        
        is_valid = hmac.compare_digest(expected, str(signature))
        
        if not is_valid:
            logger.error(f"Неверная подпись Heleket webhook: ожидается {expected}, получено {signature}")
        
        return is_valid
    
    def get_available_services(self) -> Optional[Dict]:
        """Получить доступные платежные сервисы/криптовалюты"""
        return self._request('v1/payment/services', {})


heleket_api = HeleketAPI()
