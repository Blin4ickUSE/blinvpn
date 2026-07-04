"""
API модуль для работы с PayPear (paypear.ru).
Документация: https://paypear.ru/docs/

Комиссия для российских карт (BASIC_CARD_HPP / bank_card): 6%.
"""
import base64
import hashlib
import hmac
import logging
import os
import uuid
from typing import Any, Dict, List, Optional, Tuple

import requests

logger = logging.getLogger(__name__)

PAYPEAR_API_URL = os.getenv('PAYPEAR_API_URL', 'https://api.paypear.ru/v1').rstrip('/')
PAYPEAR_SHOP_ID = os.getenv('PAYPEAR_SHOP_ID', '')
PAYPEAR_SECRET_KEY = os.getenv('PAYPEAR_SECRET_KEY', '')
PAYPEAR_RETURN_URL = os.getenv('PAYPEAR_RETURN_URL', '')
PAYPEAR_WEBHOOK_URL_OVERRIDE = os.getenv('PAYPEAR_WEBHOOK_URL', '')


def _build_webhook_url() -> str:
    if PAYPEAR_WEBHOOK_URL_OVERRIDE:
        return PAYPEAR_WEBHOOK_URL_OVERRIDE
    base = os.getenv('WEBHOOK_URL', '').rstrip('/')
    if base:
        return f'{base}/paypear'
    return ''


# Комиссия PayPear для российских карт
PAYPEAR_CARD_FEE_PERCENT = 6.0

# Hosted page (redirect) — основной тип для карт РФ в PayPear API
PAYPEAR_METHOD_BANK_CARD = 'BASIC_CARD_HPP'
PAYPEAR_METHOD_SBP = 'sbp'
PAYPEAR_METHOD_SBERPAY = 'sberpay'
PAYPEAR_METHOD_TPAY = 'tpay'

PAYPEAR_CARD_METHOD_FALLBACKS = (
    'BASIC_CARD_HPP',
    'BASIC_CARD',
    'bank_card',
)

PAYPEAR_SUCCESS_STATUSES = {'CONFIRMED', 'COMPLETED', 'success', 'paid'}
PAYPEAR_FAILED_STATUSES = {'CANCELED', 'REFUNDED', 'EXPIRED', 'failed', 'canceled', 'expired'}
PAYPEAR_PENDING_STATUSES = {'NEW', 'PROCESS', 'pending', 'processing', 'created'}


class PayPearAPI:
    """Клиент PayPear API (Basic Auth, idempotency, HMAC webhook)."""

    def __init__(self):
        self.base_url = PAYPEAR_API_URL

    @property
    def shop_id(self) -> str:
        return (os.getenv('PAYPEAR_SHOP_ID', '') or '').strip()

    @property
    def secret_key(self) -> str:
        return (os.getenv('PAYPEAR_SECRET_KEY', '') or '').strip()

    @property
    def return_url(self) -> str:
        return (os.getenv('PAYPEAR_RETURN_URL', '') or '').strip()

    @property
    def webhook_url(self) -> str:
        return _build_webhook_url()

    @property
    def is_configured(self) -> bool:
        return bool(self.shop_id and self.secret_key)

    @property
    def can_verify_webhooks(self) -> bool:
        return bool(self.secret_key)

    def _basic_auth_header(self) -> str:
        credentials = f'{self.shop_id}:{self.secret_key}'
        encoded = base64.b64encode(credentials.encode('utf-8')).decode('utf-8')
        return f'Basic {encoded}'

    def _headers(self, *, idempotence_key: str = None) -> Dict[str, str]:
        headers = {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'Authorization': self._basic_auth_header(),
        }
        if idempotence_key:
            headers['Idempotence-Key'] = idempotence_key
        return headers

    @staticmethod
    def _extract_error_message(payload: Any) -> str:
        if not isinstance(payload, dict):
            return str(payload)
        error = payload.get('error')
        if isinstance(error, dict):
            return str(error.get('message') or error.get('code') or error)
        return str(payload.get('message') or error or payload)

    @staticmethod
    def _is_method_not_found_error(message: str) -> bool:
        text = (message or '').lower()
        return 'payment method' in text and 'not found' in text

    @staticmethod
    def _extract_payment_url(result: Dict[str, Any]) -> Optional[str]:
        confirmation = result.get('confirmation') or {}
        if isinstance(confirmation, dict):
            url = confirmation.get('url')
            if url:
                return str(url)
        for key in ('redirect_url', 'redirectUrl', 'payment_url', 'pay_url'):
            value = result.get(key)
            if value:
                return str(value)
        return None

    def _card_method_candidates(self) -> List[str]:
        explicit = (os.getenv('PAYPEAR_PAYMENT_METHOD', '') or '').strip()
        candidates: List[str] = []
        if explicit:
            candidates.append(explicit)
        candidates.extend(PAYPEAR_CARD_METHOD_FALLBACKS)
        seen: set[str] = set()
        unique: List[str] = []
        for item in candidates:
            if item and item not in seen:
                seen.add(item)
                unique.append(item)
        return unique

    def _request(
        self,
        method: str,
        endpoint: str,
        data: Optional[Dict] = None,
        *,
        idempotence_key: str = None,
    ) -> Tuple[Optional[Dict[str, Any]], Optional[str]]:
        if not self.is_configured:
            logger.error('PayPear не настроен: отсутствуют PAYPEAR_SHOP_ID или PAYPEAR_SECRET_KEY')
            return None, 'PayPear не настроен'

        url = f'{self.base_url}{endpoint}'
        headers = self._headers(idempotence_key=idempotence_key)

        try:
            logger.info('PayPear request: %s %s', method, url)
            if method == 'POST':
                response = requests.post(url, headers=headers, json=data, timeout=30)
            elif method == 'GET':
                response = requests.get(url, headers=headers, params=data, timeout=30)
            else:
                raise ValueError(f'Unsupported method: {method}')

            logger.info('PayPear response: %s', response.status_code)
            payload = response.json() if response.content else {}
            if response.status_code >= 400:
                message = self._extract_error_message(payload)
                logger.error('PayPear API error: %s', payload)
                return None, message

            if isinstance(payload, dict) and payload.get('success') is False:
                message = self._extract_error_message(payload)
                logger.error('PayPear API error: %s', message)
                return None, message

            if isinstance(payload, dict) and payload.get('success') is True:
                result = payload.get('result')
                return (result if isinstance(result, dict) else payload), None

            return (payload if isinstance(payload, dict) else None), None
        except requests.exceptions.RequestException as e:
            logger.error('PayPear API error: %s', e)
            if getattr(e, 'response', None) is not None:
                logger.error('Response: %s', e.response.text)
            return None, str(e)

    def _build_payment_payload(
        self,
        *,
        amount: float,
        user_id: int,
        order_id: str,
        payment_method_type: str,
        description: str = None,
        return_url: str = None,
        webhook_url: str = None,
        metadata: Optional[Dict] = None,
    ) -> Dict[str, Any]:
        payload: Dict[str, Any] = {
            'amount': {
                'value': f'{float(amount):.2f}',
                'currency': 'RUB',
            },
            'order_id': order_id,
            'payment_method_data': {
                'type': payment_method_type,
            },
            'description': description or 'Пополнение баланса',
        }

        redirect_url = return_url or self.return_url
        if redirect_url:
            payload['confirmation'] = {
                'type': 'redirect',
                'return_url': redirect_url,
            }

        hook_url = webhook_url or self.webhook_url
        if hook_url:
            payload['webhook_url'] = hook_url

        payload['metadata'] = metadata or {'user_id': user_id, 'source': 'balance_topup'}
        return payload

    def _format_payment_result(
        self,
        result: Dict[str, Any],
        *,
        order_id: str,
        amount: float,
        payment_method_type: str,
    ) -> Dict[str, Any]:
        payment_url = self._extract_payment_url(result)
        paypear_id = result.get('id')
        status = str(result.get('status') or 'NEW').upper()
        is_card = payment_method_type in PAYPEAR_CARD_METHOD_FALLBACKS or payment_method_type == PAYPEAR_METHOD_BANK_CARD

        logger.info(
            'PayPear платёж создан: %s для order %s, метод %s, сумма %s₽',
            paypear_id,
            order_id,
            payment_method_type,
            amount,
        )

        return {
            'id': paypear_id,
            'redirect_url': payment_url,
            'status': status,
            'order_id': order_id,
            'amount': amount,
            'amount_kopeks': int(round(amount * 100)),
            'payment_method': payment_method_type,
            'fee_percent': PAYPEAR_CARD_FEE_PERCENT if is_card else None,
        }

    def create_payment(
        self,
        amount: float,
        user_id: int,
        description: str = None,
        payment_method_type: str = PAYPEAR_METHOD_BANK_CARD,
        return_url: str = None,
        webhook_url: str = None,
        metadata: Optional[Dict] = None,
    ) -> Optional[Dict[str, Any]]:
        """
        Создать платёж через PayPear.

        Args:
            amount: сумма в рублях (комиссия 6% для карт РФ)
            payment_method_type: BASIC_CARD_HPP | BASIC_CARD | sbp | sberpay | tpay
        """
        if not self.is_configured:
            return None

        order_id = f'paypear_{user_id}_{uuid.uuid4().hex[:8]}'
        payload = self._build_payment_payload(
            amount=amount,
            user_id=user_id,
            order_id=order_id,
            payment_method_type=payment_method_type,
            description=description,
            return_url=return_url,
            webhook_url=webhook_url,
            metadata=metadata,
        )

        result, error = self._request(
            'POST',
            '/payment/',
            payload,
            idempotence_key=str(uuid.uuid4()),
        )
        if not result:
            if error:
                logger.error('PayPear create_payment (%s): %s', payment_method_type, error)
            return None

        formatted = self._format_payment_result(
            result,
            order_id=order_id,
            amount=amount,
            payment_method_type=payment_method_type,
        )
        if not formatted.get('redirect_url'):
            logger.error('PayPear: нет redirect_url в ответе: %s', result)
            return None
        return formatted

    def create_card_payment(
        self,
        amount: float,
        user_id: int,
        description: str = None,
        return_url: str = None,
        webhook_url: str = None,
    ) -> Optional[Dict[str, Any]]:
        """Создать платёж российской картой (комиссия 6%)."""
        last_error = None
        for method_type in self._card_method_candidates():
            order_id = f'paypear_{user_id}_{uuid.uuid4().hex[:8]}'
            payload = self._build_payment_payload(
                amount=amount,
                user_id=user_id,
                order_id=order_id,
                payment_method_type=method_type,
                description=description,
                return_url=return_url,
                webhook_url=webhook_url,
            )
            result, error = self._request(
                'POST',
                '/payment/',
                payload,
                idempotence_key=str(uuid.uuid4()),
            )
            if result:
                formatted = self._format_payment_result(
                    result,
                    order_id=order_id,
                    amount=amount,
                    payment_method_type=method_type,
                )
                if formatted.get('redirect_url'):
                    return formatted
                logger.error('PayPear (%s): нет redirect_url в ответе: %s', method_type, result)
                return None

            last_error = error
            if error and self._is_method_not_found_error(error):
                logger.info('PayPear: метод %s недоступен для магазина, пробуем другой', method_type)
                continue
            break

        if last_error:
            logger.error('PayPear create_card_payment failed: %s', last_error)
        return None

    def create_sbp_payment(
        self,
        amount: float,
        user_id: int,
        description: str = None,
        return_url: str = None,
        webhook_url: str = None,
    ) -> Optional[Dict[str, Any]]:
        return self.create_payment(
            amount,
            user_id,
            description=description,
            payment_method_type=PAYPEAR_METHOD_SBP,
            return_url=return_url,
            webhook_url=webhook_url,
        )

    def check_payment_status(self, payment_id: str) -> Optional[Dict[str, Any]]:
        """GET /payment/{id}/"""
        result, _ = self._request('GET', f'/payment/{payment_id}/')
        return self._normalize_status(result, payment_id=payment_id)

    def check_payment_status_by_order(self, order_id: str) -> Optional[Dict[str, Any]]:
        """GET /payment/order/{order_id}/"""
        result, _ = self._request('GET', f'/payment/order/{order_id}/')
        return self._normalize_status(result, order_id=order_id)

    def _normalize_status(
        self,
        result: Optional[Dict[str, Any]],
        *,
        payment_id: str = None,
        order_id: str = None,
    ) -> Optional[Dict[str, Any]]:
        if not result:
            return None

        status = str(result.get('status') or '').upper()
        paid = status in PAYPEAR_SUCCESS_STATUSES or bool(result.get('paid'))
        amount = 0.0
        amount_data = result.get('amount')
        if isinstance(amount_data, dict):
            try:
                amount = float(str(amount_data.get('value') or '0').replace(',', '.'))
            except (TypeError, ValueError):
                amount = 0.0
        elif amount_data is not None:
            try:
                amount = float(amount_data)
            except (TypeError, ValueError):
                amount = 0.0

        return {
            'status': status,
            'is_paid': paid,
            'amount': amount,
            'payment_id': result.get('id') or payment_id,
            'order_id': result.get('order_id') or order_id,
        }

    def verify_webhook_signature(self, raw_body: bytes, signature: str) -> bool:
        """HMAC-SHA256(secret_key, raw_body) — поле signature в webhook JSON."""
        if not self.can_verify_webhooks:
            logger.warning('PayPear: PAYPEAR_SECRET_KEY не задан — проверка подписи отключена')
            return True
        if not signature:
            return False
        try:
            expected = hmac.new(
                self.secret_key.encode('utf-8'),
                raw_body,
                hashlib.sha256,
            ).hexdigest()
            return hmac.compare_digest(expected, signature.strip())
        except Exception as e:
            logger.error('PayPear webhook verify error: %s', e)
            return False


paypear_api = PayPearAPI()
