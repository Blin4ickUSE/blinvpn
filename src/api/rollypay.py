"""
API модуль для работы с RollyPay.
Документация: https://docs.rollypay.io
"""
import os
import hmac
import hashlib
import uuid
import requests
import logging
from typing import Optional, Dict, Any

logger = logging.getLogger(__name__)

ROLLYPAY_API_URL = os.getenv("ROLLYPAY_API_URL", "https://rollypay.io/api/v1").rstrip("/")
ROLLYPAY_API_KEY = os.getenv("ROLLYPAY_API_KEY", "")
ROLLYPAY_SIGNING_SECRET = os.getenv("ROLLYPAY_SIGNING_SECRET", "")
ROLLYPAY_TERMINAL_ID = os.getenv("ROLLYPAY_TERMINAL_ID", "")


class RollyPayAPI:
    """Клиент RollyPay API (СБП и другие методы)."""

    def __init__(self):
        self.base_url = ROLLYPAY_API_URL
        self.api_key = ROLLYPAY_API_KEY
        self.signing_secret = ROLLYPAY_SIGNING_SECRET
        self.terminal_id = (ROLLYPAY_TERMINAL_ID or "").strip()

    @property
    def is_configured(self) -> bool:
        """Достаточно API-ключа для создания платежей."""
        return bool(self.api_key)

    @property
    def can_verify_webhooks(self) -> bool:
        return bool(self.signing_secret)

    def _headers(self) -> Dict[str, str]:
        return {
            "Content-Type": "application/json",
            "Accept": "application/json",
            "X-API-Key": self.api_key,
            "X-Nonce": str(uuid.uuid4()),
        }

    def _request(self, method: str, endpoint: str, data: Optional[Dict] = None) -> Optional[Dict]:
        if not self.is_configured:
            logger.error("RollyPay не настроен: отсутствует ROLLYPAY_API_KEY")
            return None

        url = f"{self.base_url}{endpoint}"
        headers = self._headers()

        try:
            logger.info("RollyPay request: %s %s", method, url)
            if method == "POST":
                response = requests.post(url, headers=headers, json=data, timeout=30)
            elif method == "GET":
                response = requests.get(url, headers=headers, params=data, timeout=30)
            else:
                raise ValueError(f"Unsupported method: {method}")

            logger.info("RollyPay response: %s", response.status_code)
            response.raise_for_status()
            return response.json() if response.content else None
        except requests.exceptions.RequestException as e:
            logger.error("RollyPay API error: %s", e)
            if getattr(e, "response", None) is not None:
                logger.error("Response: %s", e.response.text)
            return None

    def create_payment(
        self,
        amount: float,
        user_id: int,
        payment_method: str = "sbp",
        description: str = None,
        success_redirect_url: str = None,
        fail_redirect_url: str = None,
    ) -> Optional[Dict]:
        """
        Создать платёж. Для СБП: payment_method='sbp'.
        Документация: POST /api/v1/payments
        """
        order_id = f"rollypay_{user_id}_{uuid.uuid4().hex[:8]}"
        payload: Dict[str, Any] = {
            "amount": f"{float(amount):.2f}",
            "payment_currency": "RUB",
            "payment_method": payment_method,
            "order_id": order_id,
            "description": description or "Пополнение баланса BlinVPN",
            "customer_id": str(user_id),
            "metadata": {"user_id": user_id, "source": "blinvpn"},
        }
        if self.terminal_id:
            payload["terminal_id"] = self.terminal_id
        if success_redirect_url:
            payload["success_redirect_url"] = success_redirect_url
        if fail_redirect_url:
            payload["fail_redirect_url"] = fail_redirect_url

        result = self._request("POST", "/payments", payload)
        if not result:
            return None

        payment_id = result.get("payment_id")
        pay_url = result.get("pay_url")
        logger.info(
            "RollyPay платёж создан: %s для user %s, сумма %s₽",
            payment_id,
            user_id,
            amount,
        )
        return {
            "id": payment_id,
            "redirect_url": pay_url,
            "status": result.get("status", "created"),
            "order_id": order_id,
            "token": result.get("token"),
            "amount": amount,
        }

    def create_sbp_payment(
        self,
        amount: float,
        user_id: int,
        description: str = None,
        success_redirect_url: str = None,
        fail_redirect_url: str = None,
    ) -> Optional[Dict]:
        """Создать платёж через СБП (QR на странице pay_url)."""
        return self.create_payment(
            amount,
            user_id,
            payment_method="sbp",
            description=description,
            success_redirect_url=success_redirect_url,
            fail_redirect_url=fail_redirect_url,
        )

    def verify_webhook_signature(
        self, raw_body: bytes, timestamp: str, signature: str
    ) -> bool:
        """
        Проверка X-Signature: HMAC-SHA256(timestamp + '.' + body, signing_secret).
        https://docs.rollypay.io/api/callbacks/
        """
        if not self.can_verify_webhooks:
            logger.warning("RollyPay: ROLLYPAY_SIGNING_SECRET не задан — проверка подписи отключена")
            return True
        if not timestamp or not signature:
            return False
        try:
            body_text = raw_body.decode("utf-8")
        except Exception:
            return False
        message = f"{timestamp}.{body_text}".encode("utf-8")
        expected = hmac.new(
            self.signing_secret.encode("utf-8"),
            message,
            hashlib.sha256,
        ).hexdigest()
        return hmac.compare_digest(expected, signature.strip().lower())


rollypay_api = RollyPayAPI()
