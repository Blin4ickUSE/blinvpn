"""
Crypto Pay API (CryptoBot) integration.
Docs: https://help.send.tg/en/articles/10279948-crypto-pay-api

We use invoices for balance topups and verify webhooks using
`crypto-pay-api-signature`:
HMAC_SHA256( SHA256(api_token), raw_request_body ).
"""

from __future__ import annotations

import hashlib
import hmac
import json
import logging
import os
import secrets
import time
from dataclasses import dataclass
from typing import Any, Dict, Optional

import requests

logger = logging.getLogger(__name__)

CRYPTOPAY_API_URL = os.getenv("CRYPTOPAY_API_URL", "https://pay.crypt.bot/api").rstrip("/")
CRYPTOPAY_API_TOKEN = os.getenv("CRYPTOPAY_API_TOKEN", os.getenv("CRYPTOBOT_API_TOKEN", ""))


@dataclass
class CryptoPayInvoice:
    invoice_id: int
    status: str
    pay_url: str
    amount: str
    asset: str
    payload: str


class CryptoPayAPI:
    def __init__(self) -> None:
        self.base_url = CRYPTOPAY_API_URL
        self.api_token = CRYPTOPAY_API_TOKEN

    @property
    def is_configured(self) -> bool:
        return bool(self.api_token)

    def _headers(self) -> Dict[str, str]:
        return {
            "Content-Type": "application/json",
            "Crypto-Pay-API-Token": self.api_token,
        }

    def _post(self, method: str, payload: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        if not self.is_configured:
            logger.error("CryptoPay is not configured: missing CRYPTOPAY_API_TOKEN")
            return None
        url = f"{self.base_url}/{method.lstrip('/')}"
        try:
            resp = requests.post(url, headers=self._headers(), json=payload, timeout=30)
            resp.raise_for_status()
            data = resp.json()
            if not isinstance(data, dict) or not data.get("ok"):
                logger.error("CryptoPay API error response: %s", str(data)[:500])
                return None
            return data
        except Exception as e:
            logger.error("CryptoPay API request failed: %s", e)
            return None

    def create_invoice(
        self,
        *,
        user_id: int,
        amount_rub: float,
        description: str = "Пополнение баланса",
        asset: str = "USDT",
    ) -> Optional[CryptoPayInvoice]:
        """
        Create invoice for topup.
        We set payload with user_id to map webhook to user.
        Invoice is created in RUB (fiat) — CryptoBot converts to crypto automatically.
        """
        payload = f"cryptopay_{user_id}_{int(time.time())}_{secrets.token_hex(3)}"
        req = {
            "currency_type": "fiat",
            "fiat": "RUB",
            "accepted_assets": asset,
            "amount": f"{float(amount_rub):.2f}",
            "description": description,
            "hidden_message": "",
            "paid_btn_name": "openBot",
            "paid_btn_url": os.getenv("MINIAPP_URL", ""),
            "payload": payload,
            "allow_comments": False,
            "allow_anonymous": False,
        }
        res = self._post("createInvoice", req)
        if not res:
            return None
        inv = (res.get("result") or {}) if isinstance(res, dict) else {}
        try:
            return CryptoPayInvoice(
                invoice_id=int(inv.get("invoice_id")),
                status=str(inv.get("status", "")),
                pay_url=str(inv.get("pay_url", "")),
                amount=str(inv.get("amount", "")),
                asset=str(inv.get("asset", asset)),
                payload=str(inv.get("payload", payload)),
            )
        except Exception as e:
            logger.error("CryptoPay createInvoice parse failed: %s, raw=%s", e, str(inv)[:500])
            return None

    def get_invoice(self, invoice_id: int) -> Optional[Dict[str, Any]]:
        """Fetch single invoice by id via `getInvoices`."""
        try:
            iid = int(invoice_id)
        except Exception:
            return None
        res = self._post("getInvoices", {"invoice_ids": str(iid)})
        if not res:
            return None
        result = res.get("result") if isinstance(res, dict) else None
        items = []
        if isinstance(result, dict):
            items = result.get("items") or []
        elif isinstance(result, list):
            items = result
        if isinstance(items, list):
            for item in items:
                if isinstance(item, dict) and int(item.get("invoice_id") or 0) == iid:
                    return item
        return None

    def verify_webhook_signature(self, raw_body: bytes, signature_header: str) -> bool:
        """
        Validate `crypto-pay-api-signature`.
        """
        if not self.is_configured:
            logger.warning("CryptoPay not configured; skipping webhook signature verification")
            return True
        if not signature_header:
            return False
        signature_header = str(signature_header).strip().lower()
        token_hash_hex = hashlib.sha256(self.api_token.encode("utf-8")).hexdigest()
        token_hash_bytes = hashlib.sha256(self.api_token.encode("utf-8")).digest()

        # CryptoPay ecosystem has integrations using both variants of "sha256(token)"
        # as HMAC key (hex string and raw bytes). Accept both to avoid false negatives.
        expected_hex_key = hmac.new(token_hash_hex.encode("utf-8"), raw_body, hashlib.sha256).hexdigest()
        expected_bytes_key = hmac.new(token_hash_bytes, raw_body, hashlib.sha256).hexdigest()
        # Extra fallback: some integrations use raw token as HMAC key.
        expected_raw_key = hmac.new(self.api_token.encode("utf-8"), raw_body, hashlib.sha256).hexdigest()
        return (
            hmac.compare_digest(expected_hex_key, signature_header)
            or hmac.compare_digest(expected_bytes_key, signature_header)
            or hmac.compare_digest(expected_raw_key, signature_header)
        )

    def check_payment_status(self, payment_id: str) -> Optional[Dict[str, Any]]:
        """
        Ручная проверка статуса платежа по payment_id (формат 'cryptopay:{invoice_id}').
        Возвращает dict с полями: status ('paid'|'active'|'expired'|...), amount, paid_at.
        """
        try:
            raw_invoice_id = payment_id.split(":", 1)[1] if ":" in payment_id else payment_id
            invoice = self.get_invoice(int(raw_invoice_id))
            if not isinstance(invoice, dict):
                return None
            status = str(invoice.get("status") or "").strip().lower()
            fiat_amount = (
                invoice.get("paid_fiat_amount")
                or invoice.get("fiat_amount")
                or invoice.get("amount")
                or 0
            )
            try:
                amount = float(str(fiat_amount).replace(",", "."))
            except Exception:
                amount = 0.0
            return {
                "status": status,
                "is_paid": status == "paid",
                "amount": amount,
                "invoice_id": invoice.get("invoice_id"),
                "paid_at": invoice.get("paid_at"),
                "payload": invoice.get("payload"),
            }
        except Exception as e:
            logger.error("CryptoPay check_payment_status error: %s", e)
            return None

    @staticmethod
    def extract_user_id_from_payload(payload: str) -> Optional[int]:
        try:
            parts = str(payload or "").split("_")
            if len(parts) >= 2 and parts[0] == "cryptopay":
                return int(parts[1])
        except Exception:
            return None
        return None

    @staticmethod
    def safe_json_dumps(obj: Any) -> str:
        try:
            return json.dumps(obj, ensure_ascii=False)[:2000]
        except Exception:
            return str(obj)[:2000]


cryptopay_api = CryptoPayAPI()
