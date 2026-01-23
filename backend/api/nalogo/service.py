"""
Сервис для автоматической генерации чеков при оплате
Использует библиотеку nalogo для взаимодействия с API "Мой Налог"
"""

import os
import logging
import asyncio
from typing import Optional, Dict, Any

from .client import Client

logger = logging.getLogger(__name__)


class NalogService:
    """
    Сервис для интеграции "Мой Налог" с платежными системами
    Автоматически создает чеки после успешных платежей
    """
    
    def __init__(self):
        self.enabled = os.getenv('NALOG_ENABLED', 'false').lower() == 'true'
        self.inn = os.getenv('NALOG_INN', '')
        self.password = os.getenv('NALOG_PASSWORD', '')
        self.token_storage_path = os.getenv('NALOG_TOKEN_PATH', 'data/nalog_token.json')
        self.service_name = os.getenv('NALOG_SERVICE_NAME', 'Приобретение услуги в RSecktor Pay')
        
        self._client: Optional[Client] = None
        self._authenticated = False
    
    @property
    def is_configured(self) -> bool:
        """Проверка настройки сервиса"""
        # Перечитываем настройки из окружения при каждой проверке
        self._reload_config()
        return self.enabled and bool(self.inn and self.password)
    
    def _reload_config(self) -> None:
        """Перезагрузить настройки из переменных окружения"""
        new_enabled = os.getenv('NALOG_ENABLED', 'false').lower() == 'true'
        new_inn = os.getenv('NALOG_INN', '')
        new_password = os.getenv('NALOG_PASSWORD', '')
        new_token_path = os.getenv('NALOG_TOKEN_PATH', 'data/nalog_token.json')
        new_service_name = os.getenv('NALOG_SERVICE_NAME', 'Приобретение услуги в RSecktor Pay')
        
        # Если настройки изменились, сбрасываем клиент
        if (self.inn != new_inn or self.password != new_password or 
            self.token_storage_path != new_token_path):
            self._client = None
            self._authenticated = False
        
        self.enabled = new_enabled
        self.inn = new_inn
        self.password = new_password
        self.token_storage_path = new_token_path
        self.service_name = new_service_name
    
    def _get_client(self) -> Client:
        """Получить или создать клиент"""
        if not self._client:
            self._client = Client(
                storage_path=self.token_storage_path,
            )
        return self._client
    
    async def _ensure_authenticated(self) -> bool:
        """Проверить аутентификацию и выполнить при необходимости"""
        client = self._get_client()
        
        # Проверяем, есть ли уже токен
        current_token = await client.get_access_token()
        if current_token:
            # Токен уже есть (загружен из файла)
            try:
                await client.authenticate(current_token)
                self._authenticated = True
                return True
            except Exception:
                # Токен устарел, нужно получить новый
                pass
        
        # Получаем новый токен по ИНН и паролю
        try:
            token = await client.create_new_access_token(self.inn, self.password)
            await client.authenticate(token)
            self._authenticated = True
            logger.info("Nalog Service: успешная аутентификация")
            return True
        except Exception as e:
            logger.error(f"Nalog Service: ошибка аутентификации: {e}")
            self._authenticated = False
            return False
    
    async def create_receipt(
        self,
        name: str,
        amount: float,
        quantity: float = 1.0,
        payment_id: Optional[str] = None,
        telegram_user_id: Optional[int] = None,
        amount_kopeks: Optional[int] = None,
    ) -> Optional[str]:
        """
        Создать чек для платежа
        
        Args:
            name: Название услуги
            amount: Сумма в рублях
            quantity: Количество
            payment_id: ID платежа (для логирования)
            telegram_user_id: ID пользователя Telegram (для логирования)
            amount_kopeks: Сумма в копейках (опционально)
        
        Returns:
            UUID чека или None при ошибке
        """
        if not self.is_configured:
            logger.debug("Nalog Service: сервис отключен или не настроен")
            return None
        
        if not await self._ensure_authenticated():
            return None
        
        client = self._get_client()
        
        try:
            income_api = client.income()
            result = await income_api.create(
                name=name,
                amount=amount,
                quantity=quantity,
            )
            
            if result:
                receipt_uuid = result.get("approvedReceiptUuid")
                logger.info(
                    f"Nalog Service: создан чек {receipt_uuid} | "
                    f"Сумма: {amount}₽ | Payment: {payment_id} | User: {telegram_user_id}"
                )
                return receipt_uuid
            else:
                logger.error(f"Nalog Service: не удалось создать чек для платежа {payment_id}")
                return None
                
        except Exception as e:
            logger.error(f"Nalog Service: ошибка создания чека: {e}")
            return None
    
    async def cancel_receipt(
        self,
        receipt_uuid: str,
        reason: str = "Возврат средств",
    ) -> bool:
        """
        Отменить чек
        
        Args:
            receipt_uuid: UUID чека
            reason: Причина отмены
        
        Returns:
            True при успехе
        """
        if not self.is_configured:
            return False
        
        if not await self._ensure_authenticated():
            return False
        
        client = self._get_client()
        
        try:
            income_api = client.income()
            result = await income_api.cancel(receipt_uuid, reason)
            return result is not None
        except Exception as e:
            logger.error(f"Nalog Service: ошибка отмены чека {receipt_uuid}: {e}")
            return False
    
    async def process_payment(
        self,
        payment_id: str,
        amount: float,
        user_id: int,
        telegram_id: Optional[int] = None,
        description: Optional[str] = None,
    ) -> Optional[str]:
        """
        Обработать успешный платеж и создать чек
        
        Args:
            payment_id: ID платежки
            amount: Сумма платежа в рублях
            user_id: ID пользователя в системе
            telegram_id: Telegram ID пользователя
            description: Описание услуги
        
        Returns:
            UUID чека или None
        """
        if not self.is_configured:
            return None
        
        service_description = description or self.service_name
        
        return await self.create_receipt(
            name=service_description,
            amount=amount,
            quantity=1.0,
            payment_id=payment_id,
            telegram_user_id=telegram_id,
        )
    
    # Алиас для обратной совместимости
    async def process_yookassa_payment(
        self,
        payment_id: str,
        amount: float,
        user_id: int,
        telegram_id: Optional[int] = None,
        description: Optional[str] = None,
    ) -> Optional[str]:
        """Обратная совместимость с yookassa_nalog"""
        return await self.process_payment(payment_id, amount, user_id, telegram_id, description)
    
    def get_receipt_url(self, receipt_uuid: str) -> str:
        """Получить URL для печати чека"""
        return f"https://lknpd.nalog.ru/api/v1/receipt/{self.inn}/{receipt_uuid}/print"


# Глобальный экземпляр сервиса
nalog_service = NalogService()
