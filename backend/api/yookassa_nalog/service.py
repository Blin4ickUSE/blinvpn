"""
Сервис для автоматической генерации чеков при оплате через YooKassa
"""

import os
import logging
import asyncio
from typing import Optional, Dict, Any

from .client import NalogClient

logger = logging.getLogger(__name__)


class NalogService:
    """
    Сервис для интеграции "Мой Налог" с YooKassa
    Автоматически создает чеки после успешных платежей
    """
    
    def __init__(self):
        self.enabled = os.getenv('NALOG_ENABLED', 'false').lower() == 'true'
        self.inn = os.getenv('NALOG_INN', '')
        self.password = os.getenv('NALOG_PASSWORD', '')
        self.token_storage_path = os.getenv('NALOG_TOKEN_PATH', 'data/nalog_token.json')
        self.service_name = os.getenv('NALOG_SERVICE_NAME', 'Приобретение услуги в RSecktor Pay')
        
        self._client: Optional[NalogClient] = None
        self._initialized = False
    
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
        
        self.enabled = new_enabled
        self.inn = new_inn
        self.password = new_password
        self.token_storage_path = new_token_path
        self.service_name = new_service_name
    
    def _get_client(self) -> NalogClient:
        """Получить или создать клиент"""
        if not self._client:
            self._client = NalogClient(
                inn=self.inn,
                password=self.password,
                token_storage_path=self.token_storage_path,
            )
        return self._client
    
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
            payment_id: ID платежа в YooKassa (для логирования)
            telegram_user_id: ID пользователя Telegram (для логирования)
            amount_kopeks: Сумма в копейках (опционально)
        
        Returns:
            UUID чека или None при ошибке
        """
        if not self.is_configured:
            logger.debug("Nalog Service: сервис отключен или не настроен")
            return None
        
        client = self._get_client()
        
        try:
            result = await client.create_income(
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
        
        client = self._get_client()
        
        try:
            result = await client.cancel_income(receipt_uuid, reason)
            return result is not None
        except Exception as e:
            logger.error(f"Nalog Service: ошибка отмены чека {receipt_uuid}: {e}")
            return False
    
    async def process_yookassa_payment(
        self,
        payment_id: str,
        amount: float,
        user_id: int,
        telegram_id: Optional[int] = None,
        description: Optional[str] = None,
    ) -> Optional[str]:
        """
        Обработать успешный платеж YooKassa и создать чек
        
        Args:
            payment_id: ID платежа в YooKassa
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
    
    def get_receipt_url(self, receipt_uuid: str) -> str:
        """Получить URL для печати чека"""
        if not self._client:
            return ""
        return self._client.get_receipt_url(receipt_uuid)


# Глобальный экземпляр сервиса
nalog_service = NalogService()
