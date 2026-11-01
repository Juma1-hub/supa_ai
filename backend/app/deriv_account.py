"""Read-only Deriv Demo account balance lookup.

OAuth access tokens are accepted per request and are never persisted or logged.
This module deliberately exposes no trading operations.
"""
from __future__ import annotations

import json
import os
from decimal import Decimal, InvalidOperation
from typing import Any
from urllib.parse import urlparse

import httpx
import websockets

REST_BASE = "https://api.derivws.com"
APP_ID_ENV = "DERIV_APP_ID"


class DerivAccountError(RuntimeError):
    pass


def _safe_error(payload: dict[str, Any]) -> str:
    error = payload.get("error") or {}
    # Never include request headers, URLs containing OTPs, or credentials.
    return str(error.get("message") or "Deriv returned an account error")[:240]


async def fetch_demo_balance(account_id: str, access_token: str) -> dict[str, Any]:
    """Obtain a short-lived Demo WS URL and read one balance response."""
    app_id = os.getenv(APP_ID_ENV)
    if not app_id:
        raise DerivAccountError("Backend is missing DERIV_APP_ID configuration")
    if not account_id or len(account_id) > 64:
        raise DerivAccountError("A valid Deriv account ID is required")
    if not access_token or len(access_token) > 8192:
        raise DerivAccountError("A valid Deriv OAuth access token is required")

    endpoint = f"{REST_BASE}/trading/v1/options/accounts/{account_id}/otp"
    headers = {"Authorization": f"Bearer {access_token}", "Deriv-App-ID": app_id}
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            response = await client.post(endpoint, headers=headers)
    except httpx.HTTPError as exc:
        raise DerivAccountError("Could not reach Deriv account service") from exc

    if response.status_code in (401, 403):
        raise DerivAccountError("Deriv rejected the access token or its permissions")
    if response.status_code >= 400:
        raise DerivAccountError(f"Deriv account service returned HTTP {response.status_code}")
    try:
        payload = response.json()
        ws_url = payload["data"]["url"]
    except (ValueError, KeyError, TypeError) as exc:
        raise DerivAccountError("Deriv returned an invalid OTP response") from exc

    parsed = urlparse(ws_url)
    if parsed.scheme != "wss" or parsed.hostname != "api.derivws.com" or "/ws/demo" not in parsed.path:
        raise DerivAccountError("Selected account did not resolve to a Deriv Demo WebSocket")

    try:
        async with websockets.connect(ws_url, open_timeout=15, close_timeout=5) as ws:
            await ws.send(json.dumps({"balance": 1, "subscribe": 0, "req_id": 4101}))
            # Ignore unrelated messages, but cap reads to avoid hanging forever.
            for _ in range(5):
                raw = await ws.recv()
                message = json.loads(raw)
                if message.get("req_id") != 4101 and message.get("msg_type") != "balance":
                    continue
                if message.get("error"):
                    raise DerivAccountError(_safe_error(message))
                balance = message.get("balance")
                if not isinstance(balance, dict):
                    raise DerivAccountError("Deriv balance response was incomplete")
                amount = Decimal(str(balance["balance"]))
                currency = str(balance["currency"])
                if not amount.is_finite() or not currency or len(currency) > 12:
                    raise DerivAccountError("Deriv returned invalid balance details")
                return {
                    "account_id": account_id,
                    "account_type": "demo",
                    "balance": format(amount, "f"),
                    "currency": currency,
                    "source": "Deriv authenticated account balance",
                    "trading_enabled": False,
                }
    except DerivAccountError:
        raise
    except (OSError, TimeoutError, json.JSONDecodeError, KeyError, InvalidOperation) as exc:
        raise DerivAccountError("Could not read a valid balance from the Demo account") from exc
    raise DerivAccountError("Deriv did not return a balance response")


async def fetch_real_account_metadata(account_id: str, access_token: str) -> dict[str, Any]:
    """Verify a Real Options account through Deriv's authenticated account list.

    This is metadata-only: it deliberately does not request a Real OTP or open a
    Real WebSocket connection. The caller's OAuth token is never persisted.
    """
    if not account_id or len(account_id) > 64:
        raise DerivAccountError("A valid Deriv account ID is required")
    if not access_token or len(access_token) > 8192:
        raise DerivAccountError("A valid Deriv OAuth access token is required")
    headers = {"Authorization": f"Bearer {access_token}"}
    app_id = os.getenv(APP_ID_ENV)
    if app_id:
        headers["Deriv-App-ID"] = app_id
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            response = await client.get(f"{REST_BASE}/trading/v1/options/accounts", headers=headers)
    except httpx.HTTPError as exc:
        raise DerivAccountError("Could not reach Deriv account service") from exc
    if response.status_code in (401, 403):
        raise DerivAccountError("Deriv rejected the access token or its permissions")
    if response.status_code >= 400:
        raise DerivAccountError(f"Deriv account service returned HTTP {response.status_code}")
    try:
        payload = response.json()
        raw_accounts = payload["data"]
        if isinstance(raw_accounts, dict):
            raw_accounts = raw_accounts.get("accounts", [raw_accounts])
        if not isinstance(raw_accounts, list):
            raise TypeError
    except (ValueError, KeyError, TypeError) as exc:
        raise DerivAccountError("Deriv returned an invalid account-list response") from exc
    for account in raw_accounts:
        if not isinstance(account, dict) or str(account.get("account_id", "")) != account_id:
            continue
        if str(account.get("account_type", "")).lower() != "real":
            raise DerivAccountError("Selected Deriv account is not a Real account")
        currency = str(account.get("currency", ""))
        if not currency or len(currency) > 12:
            raise DerivAccountError("Deriv returned invalid account currency")
        return {"account_id": account_id, "account_type": "real", "currency": currency,
                "status": str(account.get("status", "unknown")),
                "source": "Deriv authenticated account list", "trading_enabled": False}
    raise DerivAccountError("Selected account was not found in the authenticated Deriv account list")
