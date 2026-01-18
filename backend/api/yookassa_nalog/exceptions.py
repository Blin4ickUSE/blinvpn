"""
Исключения для API "Мой Налог"
"""

import logging
import re
from http import HTTPStatus
from typing import Optional, Dict, Any

import httpx

logger = logging.getLogger(__name__)


class NalogException(Exception):
    """Базовое исключение для API "Мой Налог" """
    
    def __init__(self, message: str, response: Optional[httpx.Response] = None):
        super().__init__(message)
        self.response = response
        self.message = message
        
        if response:
            self._log_error_details(message, response)
    
    def _log_error_details(self, message: str, response: httpx.Response) -> None:
        """Логирование деталей ошибки"""
        try:
            body = response.text[:500]
        except Exception:
            body = "[Failed to read response body]"
        
        logger.error(
            "Nalog API Error: %s | Status: %d | URL: %s | Body: %s",
            message,
            response.status_code,
            str(response.url),
            body,
        )


class ValidationException(NalogException):
    """HTTP 400 - Ошибка валидации"""


class UnauthorizedException(NalogException):
    """HTTP 401 - Требуется авторизация"""


class ForbiddenException(NalogException):
    """HTTP 403 - Доступ запрещен"""


class NotFoundException(NalogException):
    """HTTP 404 - Ресурс не найден"""


class ServerException(NalogException):
    """HTTP 500 - Внутренняя ошибка сервера"""


def raise_for_status(response: httpx.Response) -> None:
    """
    Преобразует HTTP статус в соответствующее исключение
    """
    if response.status_code < HTTPStatus.BAD_REQUEST:
        return
    
    body = response.text
    
    if response.status_code == HTTPStatus.BAD_REQUEST:
        raise ValidationException(body, response)
    if response.status_code == HTTPStatus.UNAUTHORIZED:
        raise UnauthorizedException(body, response)
    if response.status_code == HTTPStatus.FORBIDDEN:
        raise ForbiddenException(body, response)
    if response.status_code == HTTPStatus.NOT_FOUND:
        raise NotFoundException(body, response)
    if response.status_code >= HTTPStatus.INTERNAL_SERVER_ERROR:
        raise ServerException(body, response)
    
    raise NalogException(body, response)
