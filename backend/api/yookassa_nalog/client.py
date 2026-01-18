"""
HTTP клиент для API "Мой Налог" (lknpd.nalog.ru)
Адаптировано из example/nalog/
"""

import json
import uuid
import logging
import asyncio
from datetime import datetime, timezone, timedelta
from decimal import Decimal
from typing import Any, Dict, Optional
from pathlib import Path

import httpx

from .exceptions import raise_for_status, NalogException

logger = logging.getLogger(__name__)

# Московская таймзона UTC+3
MOSCOW_TZ = timezone(timedelta(hours=3))


def generate_device_id() -> str:
    """Генерация ID устройства"""
    return str(uuid.uuid4()).replace("-", "")[:21].lower()


class NalogClient:
    """
    Клиент для API "Мой Налог"
    Поддерживает авторизацию через ИНН+пароль и создание чеков
    """
    
    def __init__(
        self,
        inn: str = "",
        password: str = "",
        base_url: str = "https://lknpd.nalog.ru/api",
        token_storage_path: Optional[str] = None,
        device_id: Optional[str] = None,
        timeout: float = 30.0,
    ):
        self.inn = inn
        self.password = password
        self.base_url = base_url
        self.timeout = timeout
        self.device_id = device_id or generate_device_id()
        self.token_storage_path = token_storage_path
        
        self._token_data: Optional[Dict[str, Any]] = None
        self._user_profile: Optional[Dict[str, Any]] = None
        
        # Загружаем токен из файла, если есть
        if token_storage_path:
            self._load_token_from_storage()
        
        self.default_headers = {
            "Content-Type": "application/json",
            "Accept": "application/json, text/plain, */*",
            "Accept-Language": "ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7",
            "Referrer": "https://lknpd.nalog.ru/auth/login",
        }
        
        self.device_info = {
            "sourceDeviceId": self.device_id,
            "sourceType": "WEB",
            "appVersion": "1.0.0",
            "metaDetails": {}
        }
    
    def _load_token_from_storage(self) -> None:
        """Загрузка токена из файла"""
        if not self.token_storage_path:
            return
        storage_path = Path(self.token_storage_path)
        if not storage_path.exists():
            return
        
        try:
            with storage_path.open(encoding="utf-8") as f:
                self._token_data = json.load(f)
                if "profile" in self._token_data:
                    self._user_profile = self._token_data["profile"]
        except (json.JSONDecodeError, OSError) as e:
            logger.warning(f"Не удалось загрузить токен: {e}")
    
    def _save_token_to_storage(self) -> None:
        """Сохранение токена в файл"""
        if not self.token_storage_path or not self._token_data:
            return
        
        storage_path = Path(self.token_storage_path)
        try:
            storage_path.parent.mkdir(parents=True, exist_ok=True)
            with storage_path.open("w", encoding="utf-8") as f:
                json.dump(self._token_data, f, ensure_ascii=False, indent=2)
        except OSError as e:
            logger.warning(f"Не удалось сохранить токен: {e}")
    
    @property
    def is_configured(self) -> bool:
        """Проверка настройки клиента"""
        return bool(self.inn and self.password)
    
    @property
    def is_authenticated(self) -> bool:
        """Проверка авторизации"""
        return bool(self._token_data and self._token_data.get("token"))
    
    async def authenticate(self) -> bool:
        """
        Авторизация через ИНН и пароль
        """
        if not self.is_configured:
            logger.error("Nalog API не настроен: отсутствуют INN или пароль")
            return False
        
        request_data = {
            "username": self.inn,
            "password": self.password,
            "deviceInfo": self.device_info,
        }
        
        try:
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    f"{self.base_url}/v1/auth/lkfl",
                    json=request_data,
                    headers=self.default_headers,
                    timeout=self.timeout,
                )
                
                raise_for_status(response)
                
                self._token_data = response.json()
                if "profile" in self._token_data:
                    self._user_profile = self._token_data["profile"]
                
                self._save_token_to_storage()
                logger.info(f"Nalog API: успешная авторизация для ИНН {self.inn}")
                return True
                
        except Exception as e:
            logger.error(f"Nalog API: ошибка авторизации: {e}")
            return False
    
    async def refresh_token(self) -> bool:
        """Обновление токена"""
        if not self._token_data or "refreshToken" not in self._token_data:
            return False
        
        request_data = {
            "deviceInfo": self.device_info,
            "refreshToken": self._token_data["refreshToken"],
        }
        
        try:
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    f"{self.base_url}/v1/auth/token",
                    json=request_data,
                    headers=self.default_headers,
                    timeout=self.timeout,
                )
                
                if response.status_code != 200:
                    return False
                
                self._token_data = response.json()
                if "profile" in self._token_data:
                    self._user_profile = self._token_data["profile"]
                
                self._save_token_to_storage()
                logger.info("Nalog API: токен успешно обновлен")
                return True
                
        except Exception as e:
            logger.warning(f"Nalog API: ошибка обновления токена: {e}")
            return False
    
    async def _ensure_authenticated(self) -> bool:
        """Проверка и обновление авторизации"""
        if self.is_authenticated:
            return True
        
        # Пробуем обновить токен
        if await self.refresh_token():
            return True
        
        # Авторизуемся заново
        return await self.authenticate()
    
    async def _request(
        self,
        method: str,
        path: str,
        json_data: Optional[Dict[str, Any]] = None,
    ) -> Optional[Dict[str, Any]]:
        """Выполнение запроса с авторизацией"""
        if not await self._ensure_authenticated():
            logger.error("Nalog API: не удалось авторизоваться")
            return None
        
        headers = self.default_headers.copy()
        if self._token_data and "token" in self._token_data:
            headers["Authorization"] = f"Bearer {self._token_data['token']}"
        
        url = f"{self.base_url}/v1{path}"
        
        try:
            async with httpx.AsyncClient() as client:
                if method == "POST":
                    response = await client.post(
                        url,
                        json=json_data,
                        headers=headers,
                        timeout=self.timeout,
                    )
                else:
                    response = await client.get(
                        url,
                        headers=headers,
                        timeout=self.timeout,
                    )
                
                # При 401 пробуем обновить токен и повторить
                if response.status_code == 401:
                    if await self.refresh_token():
                        headers["Authorization"] = f"Bearer {self._token_data['token']}"
                        if method == "POST":
                            response = await client.post(
                                url,
                                json=json_data,
                                headers=headers,
                                timeout=self.timeout,
                            )
                        else:
                            response = await client.get(
                                url,
                                headers=headers,
                                timeout=self.timeout,
                            )
                
                raise_for_status(response)
                return response.json()
                
        except NalogException:
            raise
        except Exception as e:
            logger.error(f"Nalog API request error: {e}")
            return None
    
    def _get_moscow_time(self) -> str:
        """Получить текущее московское время в формате ISO"""
        now = datetime.now(MOSCOW_TZ)
        return now.isoformat()
    
    async def create_income(
        self,
        name: str,
        amount: float,
        quantity: float = 1.0,
        client_name: Optional[str] = None,
        client_inn: Optional[str] = None,
    ) -> Optional[Dict[str, Any]]:
        """
        Создание чека (дохода)
        
        Args:
            name: Название услуги
            amount: Сумма
            quantity: Количество
            client_name: Имя клиента (для юр. лиц)
            client_inn: ИНН клиента (для юр. лиц)
        
        Returns:
            Словарь с approvedReceiptUuid при успехе
        """
        total_amount = Decimal(str(amount)) * Decimal(str(quantity))
        
        # Формируем клиента
        client_data = {
            "contactPhone": None,
            "displayName": client_name,
            "incomeType": "FROM_LEGAL_ENTITY" if client_inn else "FROM_INDIVIDUAL",
            "inn": client_inn,
        }
        
        request_data = {
            "operationTime": self._get_moscow_time(),
            "requestTime": self._get_moscow_time(),
            "services": [
                {
                    "name": name,
                    "amount": str(amount),
                    "quantity": str(quantity),
                }
            ],
            "totalAmount": str(total_amount),
            "client": client_data,
            "paymentType": "CASH",
            "ignoreMaxTotalIncomeRestriction": False,
        }
        
        result = await self._request("POST", "/income", request_data)
        
        if result:
            receipt_uuid = result.get("approvedReceiptUuid")
            logger.info(f"Nalog API: создан чек {receipt_uuid} на сумму {amount}₽")
        
        return result
    
    async def cancel_income(
        self,
        receipt_uuid: str,
        comment: str = "Чек сформирован ошибочно",
    ) -> Optional[Dict[str, Any]]:
        """
        Отмена чека
        
        Args:
            receipt_uuid: UUID чека
            comment: Причина отмены
        """
        request_data = {
            "operationTime": self._get_moscow_time(),
            "requestTime": self._get_moscow_time(),
            "comment": comment,
            "receiptUuid": receipt_uuid,
            "partnerCode": None,
        }
        
        result = await self._request("POST", "/cancel", request_data)
        
        if result:
            logger.info(f"Nalog API: чек {receipt_uuid} отменен")
        
        return result
    
    def get_receipt_url(self, receipt_uuid: str) -> str:
        """Получить URL для печати чека"""
        if not self._user_profile or "inn" not in self._user_profile:
            return ""
        
        user_inn = self._user_profile["inn"]
        return f"{self.base_url}/receipt/{user_inn}/{receipt_uuid}/print"
