"""
API модуль для работы с PayPear (paypear.ru).
Документация: https://paypear.ru/docs/

Комиссия для российских карт (bank_card): 6%.
"""
import base64
import hashlib
import hmac
import logging
import os
import uuid
from typing import Any, Dict, Optional

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

PAYPEAR_METHOD_BANK_CARD = 'bank_card'
PAYPEAR_METHOD_SBP = 'sbp'
PAYPEAR_METHOD_SBERPAY = 'sberpay'
PAYPEAR_METHOD_TPAY = 'tpay'

PAYPEAR_SUCCESS_STATUSES = {'CONFIRMED', 'success', 'paid'}
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

    def _request(
        self,
        method: str,
        endpoint: str,
        data: Optional[Dict] = None,
        *,
        idempotence_key: str = None,
    ) -> Optional[Dict[str, Any]]:
        if not self.is_configured:
            logger.error('PayPear не настроен: отсутствуют PAYPEAR_SHOP_ID или PAYPEAR_SECRET_KEY')
            return None

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
                logger.error('PayPear API error: %s', payload)
                return None

            if isinstance(payload, dict) and payload.get('success') is False:
                logger.error('PayPear API error: %s', payload.get('message') or payload)
                return None

            if isinstance(payload, dict) and payload.get('success') is True:
                result = payload.get('result')
                return result if isinstance(result, dict) else payload

            return payload if isinstance(payload, dict) else None
        except requests.exceptions.RequestException as e:
            logger.error('PayPear API error: %s', e)
            if getattr(e, 'response', None) is not None:
                logger.error('Response: %s', e.response.text)
            return None

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
            amount: сумма в рублях (комиссия 6% для bank_card)
            payment_method_type: bank_card | sbp | sberpay | tpay
        """
        if not self.is_configured:
            return None

        order_id = f'paypear_{user_id}_{uuid.uuid4().hex[:8]}'
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

        if metadata:
            payload['metadata'] = metadata
        else:
            payload['metadata'] = {'user_id': user_id, 'source': 'balance_topup'}

        result = self._request(
            'POST',
            '/payment/',
            payload,
            idempotence_key=str(uuid.uuid4()),
        )
        if not result:
            return None

        confirmation = result.get('confirmation') or {}
        payment_url = confirmation.get('url') if isinstance(confirmation, dict) else None
        paypear_id = result.get('id')
        status = str(result.get('status') or 'NEW').upper()

        logger.info(
            'PayPear платёж создан: %s для user %s, сумма %s₽',
            paypear_id,
            user_id,
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
            'fee_percent': PAYPEAR_CARD_FEE_PERCENT if payment_method_type == PAYPEAR_METHOD_BANK_CARD else None,
        }

    def create_card_payment(
        self,
        amount: float,
        user_id: int,
        description: str = None,
        return_url: str = None,
        webhook_url: str = None,
    ) -> Optional[Dict[str, Any]]:
        """Создать платёж российской картой (комиссия 6%)."""
        return self.create_payment(
            amount,
            user_id,
            description=description,
            payment_method_type=PAYPEAR_METHOD_BANK_CARD,
            return_url=return_url,
            webhook_url=webhook_url,
        )

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
        result = self._request('GET', f'/payment/{payment_id}/')
        return self._normalize_status(result, payment_id=payment_id)

    def check_payment_status_by_order(self, order_id: str) -> Optional[Dict[str, Any]]:
        """GET /payment/order/{order_id}/"""
        result = self._request('GET', f'/payment/order/{order_id}/')
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
