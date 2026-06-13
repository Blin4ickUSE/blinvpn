"""
API модуль для работы с Remnawave
Полная интеграция со всеми функциями Remnawave API
Основано на example/remnawave_api.py
"""
import os
import asyncio
import json
import ssl
import base64
import threading
from concurrent.futures import TimeoutError as FuturesTimeoutError
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Union, Any, Callable, Awaitable, TypeVar
import aiohttp
import logging
from dataclasses import dataclass
from enum import Enum
from urllib.parse import urlparse, urljoin

logger = logging.getLogger(__name__)

T = TypeVar('T')

_async_loop: Optional[asyncio.AbstractEventLoop] = None
_async_loop_lock = threading.Lock()


def _ensure_async_loop() -> asyncio.AbstractEventLoop:
    """Один фоновый event loop для всех sync-вызовов (Flask threads)."""
    global _async_loop
    with _async_loop_lock:
        if _async_loop is None or _async_loop.is_closed():
            loop = asyncio.new_event_loop()

            def _loop_runner() -> None:
                asyncio.set_event_loop(loop)
                loop.run_forever()

            threading.Thread(target=_loop_runner, name='remnawave-async', daemon=True).start()
            _async_loop = loop
        return _async_loop


def run_async(coro: Awaitable[T], timeout: float = 60) -> T:
    """Выполнить coroutine в фоновом loop (без asyncio.run из worker-потоков)."""
    loop = _ensure_async_loop()
    future = asyncio.run_coroutine_threadsafe(coro, loop)
    try:
        return future.result(timeout=timeout)
    except FuturesTimeoutError:
        future.cancel()
        raise RemnaWaveAPIError(f"Request timed out after {timeout}s")


async def with_remnawave_api(fn: Callable[['RemnaWaveAPI'], Awaitable[T]]) -> T:
    """Свежий aiohttp-session на каждый вызов — без гонок между потоками."""
    api = get_remnawave_api()
    async with api:
        return await fn(api)


class UserStatus(Enum):
    ACTIVE = "ACTIVE"
    DISABLED = "DISABLED"
    LIMITED = "LIMITED"
    EXPIRED = "EXPIRED"


class TrafficLimitStrategy(Enum):
    NO_RESET = "NO_RESET"
    DAY = "DAY"
    WEEK = "WEEK"
    MONTH = "MONTH"
    MONTH_ROLLING = "MONTH_ROLLING"


# 2 ТБ = 2048 ГБ (без бонуса за доп. устройства)
VPN_TRAFFIC_LIMIT_BYTES = 2048 * (1024 ** 3)
TRAFFIC_RESET_PRICE_RUB = 49


@dataclass
class UserTraffic:
    """Данные о трафике пользователя (новая структура API)"""
    used_traffic_bytes: int
    lifetime_used_traffic_bytes: int
    online_at: Optional[datetime] = None
    first_connected_at: Optional[datetime] = None
    last_connected_node_uuid: Optional[str] = None


@dataclass
class RemnaWaveUser:
    uuid: str
    short_uuid: str
    username: str
    status: UserStatus
    traffic_limit_bytes: int
    traffic_limit_strategy: TrafficLimitStrategy
    expire_at: datetime
    telegram_id: Optional[int]
    email: Optional[str]
    hwid_device_limit: Optional[int]
    description: Optional[str]
    tag: Optional[str]
    subscription_url: str
    active_internal_squads: List[Dict[str, str]]
    created_at: datetime
    updated_at: datetime
    user_traffic: Optional[UserTraffic] = None
    sub_last_user_agent: Optional[str] = None
    sub_last_opened_at: Optional[datetime] = None
    sub_revoked_at: Optional[datetime] = None
    last_traffic_reset_at: Optional[datetime] = None
    trojan_password: Optional[str] = None
    vless_uuid: Optional[str] = None
    ss_password: Optional[str] = None
    last_triggered_threshold: int = 0
    happ_link: Optional[str] = None
    happ_crypto_link: Optional[str] = None
    external_squad_uuid: Optional[str] = None
    id: Optional[int] = None

    @property
    def used_traffic_bytes(self) -> int:
        """Обратная совместимость: получение used_traffic_bytes из user_traffic"""
        if self.user_traffic:
            return self.user_traffic.used_traffic_bytes
        return 0

    @property
    def lifetime_used_traffic_bytes(self) -> int:
        """Обратная совместимость: получение lifetime_used_traffic_bytes из user_traffic"""
        if self.user_traffic:
            return self.user_traffic.lifetime_used_traffic_bytes
        return 0


@dataclass
class RemnaWaveInternalSquad:
    uuid: str
    name: str
    members_count: int
    inbounds_count: int
    inbounds: List[Dict]
    view_position: int = 0
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


class RemnaWaveAPIError(Exception):
    def __init__(self, message: str, status_code: int = None, response_data: dict = None):
        self.message = message
        self.status_code = status_code
        self.response_data = response_data
        super().__init__(self.message)


class RemnaWaveAPI:

    def __init__(
        self,
        base_url: str,
        api_key: str,
        secret_key: Optional[str] = None,
        username: Optional[str] = None,
        password: Optional[str] = None,
        caddy_token: Optional[str] = None,
        auth_type: str = "api_key",
    ):
        self.base_url = base_url.rstrip('/')
        self.api_key = api_key
        self.secret_key = secret_key
        self.username = username
        self.password = password
        self.caddy_token = caddy_token
        self.auth_type = auth_type.lower() if auth_type else "api_key"
        self.session: Optional[aiohttp.ClientSession] = None
        self.authenticated = False
        
    def _detect_connection_type(self) -> str:
        parsed = urlparse(self.base_url)
        
        local_hosts = [
            'localhost', '127.0.0.1', 'remnawave', 
            'remnawave-backend', 'app', 'api'
        ]
        
        if parsed.hostname in local_hosts:
            return "local"
            
        if parsed.hostname:
            if (parsed.hostname.startswith('192.168.') or 
                parsed.hostname.startswith('10.') or 
                parsed.hostname.startswith('172.') or
                parsed.hostname.endswith('.local')):
                return "local"
        
        return "external"

    def _prepare_auth_headers(self) -> Dict[str, str]:
        headers = {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'X-Forwarded-Proto': 'https',
            'X-Forwarded-For': '127.0.0.1',
            'X-Real-IP': '127.0.0.1'
        }

        # Caddy авторизация — добавляется поверх основной
        if self.caddy_token:
            headers['Authorization'] = f'Basic {self.caddy_token}'
            logger.debug("Используем Caddy Basic Auth")

        # Основная авторизация RemnaWave API
        if self.auth_type == "basic" and self.username and self.password:
            credentials = f"{self.username}:{self.password}"
            encoded_credentials = base64.b64encode(credentials.encode()).decode()
            headers['X-Api-Key'] = f"Basic {encoded_credentials}"
            logger.debug("Используем Basic Auth в X-Api-Key заголовке")
        elif self.auth_type == "caddy":
            if self.api_key:
                headers['X-Api-Key'] = self.api_key
                logger.debug("Используем API ключ для RemnaWave + Caddy авторизацию")
        else:
            # api_key или bearer — стандартный режим
            headers['X-Api-Key'] = self.api_key
            if not self.caddy_token:
                headers['Authorization'] = f'Bearer {self.api_key}'
            logger.debug("Используем API ключ в X-Api-Key заголовке")

        return headers
        
    async def __aenter__(self):
        conn_type = self._detect_connection_type()
        
        logger.debug(f"Подключение к Remnawave: {self.base_url} (тип: {conn_type})")
            
        headers = self._prepare_auth_headers() 
        
        cookies = None
        if self.secret_key:
            if ':' in self.secret_key:
                key_name, key_value = self.secret_key.split(':', 1)
                cookies = {key_name: key_value}
                logger.debug(f"Используем куки: {key_name}=***")
            else:
                cookies = {self.secret_key: self.secret_key}
                logger.debug(f"Используем куки: {self.secret_key}=***")
        
        connector_kwargs = {}
        
        if conn_type == "local":
            logger.debug("Используют локальные заголовки proxy")
            headers.update({
                'X-Forwarded-Host': 'localhost',
                'Host': 'localhost'
            })
            
            if self.base_url.startswith('https://'):
                ssl_context = ssl.create_default_context()
                ssl_context.check_hostname = False
                ssl_context.verify_mode = ssl.CERT_NONE
                connector_kwargs['ssl'] = ssl_context
                logger.debug("SSL проверка отключена для локального HTTPS")
                
        elif conn_type == "external":
            logger.debug("Используют внешнее подключение с полной SSL проверкой")
            pass
            
        connector = aiohttp.TCPConnector(**connector_kwargs)
        
        session_kwargs = {
            'timeout': aiohttp.ClientTimeout(total=30),
            'headers': headers,
            'connector': connector
        }
        
        if cookies:
            session_kwargs['cookies'] = cookies
            
        self.session = aiohttp.ClientSession(**session_kwargs)
        self.authenticated = True 
                
        return self
        
    async def __aexit__(self, exc_type, exc_val, exc_tb):
        if self.session:
            await self.session.close()
            
    async def _make_request(
        self, 
        method: str, 
        endpoint: str, 
        data: Optional[Dict] = None,
        params: Optional[Dict] = None
    ) -> Dict:
        if not self.session:
            raise RemnaWaveAPIError("Session not initialized. Use async context manager.")
            
        url = f"{self.base_url}{endpoint}"
        
        try:
            kwargs = {
                'url': url,
                'params': params
            }
            
            if data:
                kwargs['json'] = data
                
            async with self.session.request(method, **kwargs) as response:
                response_text = await response.text()
                
                try:
                    response_data = json.loads(response_text) if response_text else {}
                except json.JSONDecodeError:
                    response_data = {'raw_response': response_text}
                
                if response.status >= 400:
                    error_message = response_data.get('message', f'HTTP {response.status}')
                    logger.error(f"API Error {response.status}: {error_message}")
                    logger.error(f"Response: {response_text[:500]}")
                    raise RemnaWaveAPIError(
                        error_message, 
                        response.status, 
                        response_data
                    )
                    
                return response_data
                
        except aiohttp.ClientError as e:
            logger.error(f"Request failed: {e}")
            raise RemnaWaveAPIError(f"Request failed: {str(e)}")
    
    async def get_internal_squads(self) -> List[RemnaWaveInternalSquad]:
        response = await self._make_request('GET', '/api/internal-squads')
        squads_data = response.get('response', {}).get('internalSquads', [])
        return [self._parse_internal_squad(squad) for squad in squads_data]
    
    async def get_user_by_uuid(self, uuid: str) -> Optional[RemnaWaveUser]:
        """Получить пользователя Remnawave по UUID."""
        uuid = str(uuid or '').strip()
        if not uuid:
            return None
        try:
            response = await self._make_request('GET', f'/api/users/{uuid}')
            user_data = response.get('response', response)
            if isinstance(user_data, dict) and user_data.get('uuid'):
                return self._parse_user(user_data)
        except RemnaWaveAPIError as e:
            if getattr(e, 'status_code', None) == 404:
                return None
            raise
        return None

    async def ensure_hwid_device_limit(self, user_uuid: str, limit: int) -> bool:
        """Установить hwidDeviceLimit и проверить, что значение применилось."""
        user_uuid = str(user_uuid or '').strip()
        limit = int(limit)
        if not user_uuid or limit < 1:
            return False

        for attempt in range(2):
            user = await self.update_user(user_uuid, hwid_device_limit=limit)
            actual = user.hwid_device_limit if user else None
            if actual == limit:
                logger.info("hwidDeviceLimit synced for %s -> %s", user_uuid, limit)
                return True
            logger.warning(
                "hwidDeviceLimit mismatch for %s (attempt %s): want=%s got=%s",
                user_uuid, attempt + 1, limit, actual,
            )
        return False

    async def subscription_ever_connected(self, user_uuid: str) -> bool:
        """Была ли подписка когда-либо подключена (трафик, HWID или firstConnectedAt)."""
        user_uuid = str(user_uuid or '').strip()
        if not user_uuid:
            return True
        try:
            user = await self.get_user_by_uuid(user_uuid)
            if user and user.user_traffic:
                if user.user_traffic.first_connected_at:
                    return True
                if user.user_traffic.used_traffic_bytes > 0:
                    return True
                if user.user_traffic.lifetime_used_traffic_bytes > 0:
                    return True
            devices = await self.get_hwid_devices(user_uuid)
            return len(devices) > 0
        except Exception as e:
            logger.warning("subscription_ever_connected check failed for %s: %s", user_uuid, e)
            return True

    async def get_user_by_telegram_id(self, telegram_id: int) -> List[RemnaWaveUser]:
        try:
            response = await self._make_request('GET', f'/api/users/by-telegram-id/{telegram_id}')
            users_data = response.get('response', [])
            if not users_data:
                return []
            users = [self._parse_user(user) for user in users_data]
            return users
        except RemnaWaveAPIError as e:
            if e.status_code == 404:
                return []
            raise
    
    async def create_user(
        self,
        username: str,
        expire_at: datetime,
        status: UserStatus = UserStatus.ACTIVE,
        traffic_limit_bytes: int = 0,
        traffic_limit_strategy: TrafficLimitStrategy = TrafficLimitStrategy.NO_RESET,
        telegram_id: Optional[int] = None,
        email: Optional[str] = None,
        hwid_device_limit: Optional[int] = None,
        description: Optional[str] = None,
        tag: Optional[str] = None,
        active_internal_squads: Optional[List[str]] = None
    ) -> RemnaWaveUser:
        data = {
            'username': username,
            'status': status.value,
            'expireAt': expire_at.isoformat(),
            'trafficLimitBytes': traffic_limit_bytes,
            'trafficLimitStrategy': traffic_limit_strategy.value
        }
        
        if telegram_id:
            data['telegramId'] = telegram_id
        if email:
            data['email'] = email
        if hwid_device_limit is not None:
            data['hwidDeviceLimit'] = hwid_device_limit
        if description:
            data['description'] = description
        if tag:
            data['tag'] = tag
        if active_internal_squads:
            data['activeInternalSquads'] = active_internal_squads

        logger.info("Создание пользователя в Remnawave: %s", data)
        response = await self._make_request('POST', '/api/users', data)
        user = self._parse_user(response['response'])
        return user
    
    async def update_user(
        self,
        uuid: str,
        status: Optional[UserStatus] = None,
        traffic_limit_bytes: Optional[int] = None,
        traffic_limit_strategy: Optional[TrafficLimitStrategy] = None,
        expire_at: Optional[datetime] = None,
        telegram_id: Optional[int] = None,
        email: Optional[str] = None,
        hwid_device_limit: Optional[int] = None,
        description: Optional[str] = None,
        tag: Optional[str] = None,
        active_internal_squads: Optional[List[str]] = None
    ) -> RemnaWaveUser:
        data = {'uuid': uuid}
        
        if status:
            data['status'] = status.value
        if traffic_limit_bytes is not None:
            data['trafficLimitBytes'] = traffic_limit_bytes
        if traffic_limit_strategy:
            data['trafficLimitStrategy'] = traffic_limit_strategy.value
        if expire_at:
            data['expireAt'] = expire_at.isoformat()
        if telegram_id is not None:
            data['telegramId'] = telegram_id
        if email is not None:
            data['email'] = email
        if hwid_device_limit is not None:
            data['hwidDeviceLimit'] = hwid_device_limit
        if description is not None:
            data['description'] = description
        if tag is not None:
            data['tag'] = tag
        if active_internal_squads is not None:
            data['activeInternalSquads'] = active_internal_squads
            
        response = await self._make_request('PATCH', '/api/users', data)
        user = self._parse_user(response['response'])
        return user
    
    async def delete_user(self, uuid: str) -> bool:
        """Удалить пользователя из Remnawave"""
        response = await self._make_request('DELETE', f'/api/users/{uuid}')
        if isinstance(response, dict):
            resp = response.get('response', response)
            if isinstance(resp, dict):
                return bool(resp.get('isDeleted', True))
        return True

    async def reset_user_traffic(self, uuid: str) -> bool:
        """Досрочный сброс счётчика трафика пользователя"""
        response = await self._make_request('POST', f'/api/users/{uuid}/actions/reset-traffic')
        return bool(response.get('success', True)) if isinstance(response, dict) else True
    
    async def get_all_users(self, start: int = 0, size: int = 100) -> Dict[str, Any]:
        params = {'start': start, 'size': size}
        response = await self._make_request('GET', '/api/users', params=params)

        users = [self._parse_user(user) for user in response['response']['users']]

        return {
            'users': users,
            'total': response['response']['total']
        }

    # Remnawave 2.7.4 HWID management
    async def get_hwid_devices(self, user_uuid: str) -> List[Dict[str, Any]]:
        response = await self._make_request('GET', f'/api/hwid/devices/{user_uuid}')
        return self._normalize_hwid_devices_response(response)

    @staticmethod
    def _hwid_from_device(device: Dict[str, Any]) -> str:
        """Извлечь строку HWID из объекта устройства Remnawave."""
        for key in ('hwid', 'hwidHash', 'hwid_hash', 'hwidHashValue'):
            value = device.get(key)
            if value:
                return str(value)
        return ''

    @staticmethod
    def resolve_hwid_from_devices(devices: List[Dict[str, Any]], hwid_ref: str) -> Optional[str]:
        """Найти реальный hwid по значению из UI (hwid или устаревший id/uuid)."""
        ref = str(hwid_ref or '').strip()
        if not ref:
            return None
        for device in devices:
            if not isinstance(device, dict):
                continue
            hwid = RemnaWaveAPI._hwid_from_device(device)
            if hwid and hwid == ref:
                return hwid
            for alt_key in ('id', 'uuid', 'deviceId'):
                if str(device.get(alt_key) or '') == ref and hwid:
                    return hwid
        return None

    @staticmethod
    def _normalize_hwid_devices_response(response: Any) -> List[Dict[str, Any]]:
        """Привести ответ Remnawave к списку HWID-устройств."""
        if not isinstance(response, dict):
            return []
        raw = response.get('response', response.get('devices', response))
        if isinstance(raw, list):
            return [item for item in raw if isinstance(item, dict)]
        if isinstance(raw, dict):
            devices = raw.get('devices')
            if isinstance(devices, list):
                return [item for item in devices if isinstance(item, dict)]
            for key in ('items', 'hwidDevices', 'hwid_devices', 'data'):
                nested = raw.get(key)
                if isinstance(nested, list):
                    return [item for item in nested if isinstance(item, dict)]
        return []

    @staticmethod
    def format_hwid_device_for_client(device: Dict[str, Any]) -> Dict[str, Any]:
        """Гарантировать поле hwid в ответе для клиента."""
        out = dict(device)
        hwid = RemnaWaveAPI._hwid_from_device(device)
        if hwid:
            out['hwid'] = hwid
        return out

    async def delete_hwid_device(self, user_uuid: str, hwid: str) -> bool:
        hwid = str(hwid or '').strip()
        user_uuid = str(user_uuid or '').strip()
        if not hwid or not user_uuid:
            return False

        before_list = await self.get_hwid_devices(user_uuid)
        before_hwids = {self._hwid_from_device(d) for d in before_list if self._hwid_from_device(d)}
        if hwid not in before_hwids:
            logger.warning(
                "HWID %r not found for user %s (have: %s)",
                hwid[:48], user_uuid, list(before_hwids),
            )
            return False

        data = {'userUuid': user_uuid, 'hwid': hwid}
        logger.info("Remnawave HWID delete request: userUuid=%s hwid_len=%d", user_uuid, len(hwid))
        response = await self._make_request('POST', '/api/hwid/devices/delete', data)

        remaining = self._normalize_hwid_devices_response(response)
        remaining_hwids = {self._hwid_from_device(d) for d in remaining if self._hwid_from_device(d)}
        if hwid in remaining_hwids:
            after_list = await self.get_hwid_devices(user_uuid)
            after_hwids = {self._hwid_from_device(d) for d in after_list if self._hwid_from_device(d)}
            if hwid in after_hwids:
                logger.error("HWID %r still present after delete for user %s", hwid[:48], user_uuid)
                return False
        logger.info(
            "Remnawave HWID deleted: user=%s remaining=%d",
            user_uuid,
            len(remaining_hwids) if remaining_hwids else len(remaining),
        )
        return True

    async def delete_all_hwid_devices(self, user_uuid: str) -> bool:
        user_uuid = str(user_uuid or '').strip()
        if not user_uuid:
            return False
        data = {'userUuid': user_uuid}
        await self._make_request('POST', '/api/hwid/devices/delete-all', data)
        after_list = await self.get_hwid_devices(user_uuid)
        if after_list:
            logger.error("HWID devices still present after delete-all for user %s: %d", user_uuid, len(after_list))
            return False
        return True
    
    def _parse_user(self, user_data: Dict) -> RemnaWaveUser:
        status_str = user_data.get('status') or 'ACTIVE'
        try:
            status = UserStatus(status_str)
        except ValueError:
            logger.warning(f"Неизвестный статус пользователя: {status_str}, используем ACTIVE")
            status = UserStatus.ACTIVE

        strategy_str = user_data.get('trafficLimitStrategy') or 'NO_RESET'
        try:
            traffic_strategy = TrafficLimitStrategy(strategy_str)
        except ValueError:
            logger.warning(f"Неизвестная стратегия трафика: {strategy_str}, используем NO_RESET")
            traffic_strategy = TrafficLimitStrategy.NO_RESET

        return RemnaWaveUser(
            uuid=user_data['uuid'],
            short_uuid=user_data['shortUuid'],
            username=user_data['username'],
            status=status,
            traffic_limit_bytes=user_data.get('trafficLimitBytes', 0),
            traffic_limit_strategy=traffic_strategy,
            expire_at=datetime.fromisoformat(user_data['expireAt'].replace('Z', '+00:00')),
            telegram_id=user_data.get('telegramId'),
            email=user_data.get('email'),
            hwid_device_limit=user_data.get('hwidDeviceLimit'),
            description=user_data.get('description'),
            tag=user_data.get('tag'),
            subscription_url=user_data.get('subscriptionUrl', ''),
            active_internal_squads=user_data.get('activeInternalSquads', []),
            created_at=datetime.fromisoformat(user_data['createdAt'].replace('Z', '+00:00')),
            updated_at=datetime.fromisoformat(user_data['updatedAt'].replace('Z', '+00:00')),
            user_traffic=self._parse_user_traffic(user_data.get('userTraffic')),
        )
    
    def _parse_user_traffic(self, traffic_data: Optional[Dict]) -> Optional[UserTraffic]:
        """Парсит данные трафика из нового формата API"""
        if not traffic_data:
            return None

        return UserTraffic(
            used_traffic_bytes=int(traffic_data.get('usedTrafficBytes', 0)),
            lifetime_used_traffic_bytes=int(traffic_data.get('lifetimeUsedTrafficBytes', 0)),
            online_at=self._parse_optional_datetime(traffic_data.get('onlineAt')),
            first_connected_at=self._parse_optional_datetime(traffic_data.get('firstConnectedAt')),
            last_connected_node_uuid=traffic_data.get('lastConnectedNodeUuid')
        )
    
    def _parse_optional_datetime(self, date_str: Optional[str]) -> Optional[datetime]:
        if date_str:
            return datetime.fromisoformat(date_str.replace('Z', '+00:00'))
        return None
    
    def _parse_internal_squad(self, squad_data: Dict) -> RemnaWaveInternalSquad:
        info = squad_data.get('info', {})
        return RemnaWaveInternalSquad(
            uuid=squad_data['uuid'],
            name=squad_data['name'],
            members_count=info.get('membersCount', 0),
            inbounds_count=info.get('inboundsCount', 0),
            inbounds=squad_data.get('inbounds', []),
            view_position=squad_data.get('viewPosition', 0),
            created_at=self._parse_optional_datetime(squad_data.get('createdAt')),
            updated_at=self._parse_optional_datetime(squad_data.get('updatedAt'))
        )


# Синхронная обёртка для использования в синхронном коде
def get_remnawave_api():
    """Получить экземпляр Remnawave API"""
    # Поддерживаем оба названия переменной для обратной совместимости
    api_url = os.getenv('REMWAVE_PANEL_URL') or os.getenv('REMWAVE_API_URL', 'http://localhost:3000')
    
    # Автоматически добавляем протокол если его нет
    if api_url and not api_url.startswith('http://') and not api_url.startswith('https://'):
        api_url = 'https://' + api_url
    
    api_key = os.getenv('REMWAVE_API_KEY', '')
    secret_key = os.getenv('REMWAVE_SECRET_KEY')
    caddy_token = os.getenv('REMWAVE_CADDY_TOKEN')
    
    return RemnaWaveAPI(
        base_url=api_url,
        api_key=api_key,
        secret_key=secret_key,
        caddy_token=caddy_token
    )


def format_subscription_username(telegram_id: int, key_id: int) -> str:
    """Имя подписки в Remnawave: TELEGRAMID_KEYID (например 11111111_280)."""
    return f"{int(telegram_id)}_{int(key_id)}"


# Для обратной совместимости
def sanitize_remnawave_username(username: str, telegram_id: int) -> str:
    """Санитизация username для Remnawave - только буквы, цифры, _ и -"""
    import re
    if not username:
        return f"user_{telegram_id}"
    
    # Удаляем все символы кроме букв, цифр, _ и -
    sanitized = re.sub(r'[^a-zA-Z0-9_-]', '', username)
    
    # Если после санитизации пусто - используем telegram_id
    if not sanitized:
        return f"user_{telegram_id}"
    
    # Username должен начинаться с буквы или цифры
    if sanitized[0] in '_-':
        sanitized = f"u{sanitized}"
    
    return sanitized


class RemnawaveAPI:
    """Обёртка для синхронного использования из Flask и async из aiogram."""

    def create_user(self, telegram_id: int, username: str = None, email: str = None):
        """Создать пользователя (синхронная обёртка)"""
        safe_username = sanitize_remnawave_username(username, telegram_id)

        async def _create(api: RemnaWaveAPI):
            expire_at = datetime.now() + timedelta(days=30)
            return await api.create_user(
                safe_username,
                expire_at,
                telegram_id=telegram_id,
                email=email,
            )

        return run_async(with_remnawave_api(_create))

    def get_user_by_telegram_id(self, telegram_id: int):
        """Получить пользователя по Telegram ID (синхронная обёртка)"""
        async def _get(api: RemnaWaveAPI):
            return await api.get_user_by_telegram_id(telegram_id)

        return run_async(with_remnawave_api(_get))

    def create_subscription(self, user_uuid: str, days: int, traffic_limit: int = None):
        """Создать подписку (синхронная обёртка)"""
        async def _create(api: RemnaWaveAPI):
            expire_at = datetime.now() + timedelta(days=days)
            return await api.update_user(
                user_uuid,
                expire_at=expire_at,
                traffic_limit_bytes=traffic_limit,
            )

        return run_async(with_remnawave_api(_create))

    def update_user_sync(self, uuid: str, expire_at: datetime = None,
                        traffic_limit_bytes: int = None, hwid_device_limit: int = None,
                        active_internal_squads: List[str] = None, status: UserStatus = None,
                        traffic_limit_strategy: TrafficLimitStrategy = None):
        """Обновить пользователя (синхронная обёртка)"""
        async def _update(api: RemnaWaveAPI):
            return await api.update_user(
                uuid,
                expire_at=expire_at,
                traffic_limit_bytes=traffic_limit_bytes,
                traffic_limit_strategy=traffic_limit_strategy,
                hwid_device_limit=hwid_device_limit,
                active_internal_squads=active_internal_squads,
                status=status,
            )

        return run_async(with_remnawave_api(_update))

    def ensure_hwid_device_limit_sync(self, user_uuid: str, limit: int) -> bool:
        async def _ensure(api: RemnaWaveAPI):
            return await api.ensure_hwid_device_limit(user_uuid, limit)

        return run_async(with_remnawave_api(_ensure))

    def subscription_ever_connected_sync(self, user_uuid: str) -> bool:
        async def _check(api: RemnaWaveAPI):
            return await api.subscription_ever_connected(user_uuid)

        return run_async(with_remnawave_api(_check))

    def create_user_with_params(self, telegram_id: int, username: str, days: int,
                               traffic_limit_bytes: int = 0, hwid_device_limit: int = None,
                               active_internal_squads: List[str] = None,
                               traffic_limit_strategy: TrafficLimitStrategy = None):
        """Создать пользователя с полными параметрами (синхронная обёртка)"""
        if traffic_limit_strategy is None:
            traffic_limit_strategy = (
                TrafficLimitStrategy.MONTH if traffic_limit_bytes > 0
                else TrafficLimitStrategy.NO_RESET
            )
        safe_username = sanitize_remnawave_username(username, telegram_id)

        async def _create(api: RemnaWaveAPI):
            expire_at = datetime.now() + timedelta(days=days)
            return await api.create_user(
                safe_username,
                expire_at,
                telegram_id=telegram_id,
                traffic_limit_bytes=traffic_limit_bytes,
                traffic_limit_strategy=traffic_limit_strategy,
                hwid_device_limit=hwid_device_limit,
                active_internal_squads=active_internal_squads,
            )

        return run_async(with_remnawave_api(_create))

    def get_internal_squads(self):
        """Получить список внутренних сквадов (синхронная обёртка)"""
        async def _get(api: RemnaWaveAPI):
            return await api.get_internal_squads()

        return run_async(with_remnawave_api(_get))

    def get_all_squads(self):
        """Алиас для get_internal_squads (обратная совместимость)"""
        return self.get_internal_squads()

    def delete_user_sync(self, uuid: str) -> bool:
        """Удалить пользователя (синхронная обёртка)"""
        async def _delete(api: RemnaWaveAPI):
            return await api.delete_user(uuid)

        return run_async(with_remnawave_api(_delete))

    async def delete_user_async(self, uuid: str) -> bool:
        """Удалить пользователя (async — для вызова из aiogram)"""
        async def _delete(api: RemnaWaveAPI):
            return await api.delete_user(uuid)

        return await with_remnawave_api(_delete)

    def reset_user_traffic_sync(self, uuid: str) -> bool:
        async def _reset(api: RemnaWaveAPI):
            return await api.reset_user_traffic(uuid)

        return run_async(with_remnawave_api(_reset))

    def get_all_users_sync(self, start: int = 0, size: int = 100):
        """Получить всех пользователей (синхронная обёртка)"""
        async def _get(api: RemnaWaveAPI):
            return await api.get_all_users(start, size)

        return run_async(with_remnawave_api(_get))

    def get_hwid_devices_sync(self, user_uuid: str):
        async def _get(api: RemnaWaveAPI):
            return await api.get_hwid_devices(user_uuid)

        return run_async(with_remnawave_api(_get))

    def delete_hwid_device_sync(self, user_uuid: str, hwid: str) -> bool:
        async def _delete(api: RemnaWaveAPI):
            return await api.delete_hwid_device(user_uuid, hwid)

        return run_async(with_remnawave_api(_delete))

    def delete_all_hwid_devices_sync(self, user_uuid: str) -> bool:
        async def _delete(api: RemnaWaveAPI):
            return await api.delete_all_hwid_devices(user_uuid)

        return run_async(with_remnawave_api(_delete))


# Глобальный экземпляр для обратной совместимости
remnawave_api = RemnawaveAPI()
