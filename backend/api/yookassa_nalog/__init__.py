"""
Модуль для автоматической оплаты налога (самозанятость) через API "Мой Налог"
Интегрируется с YooKassa для создания чеков после успешных платежей
"""

from .client import NalogClient
from .service import NalogService

__all__ = ['NalogClient', 'NalogService']
