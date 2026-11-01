"""Stage 5: Demo proposal preview and contract-status inspection.

This module intentionally DOES NOT expose a purchase operation. The buy path is
hard-disabled until a separately reviewed safety gate is implemented.
"""
from __future__ import annotations

import json
import os
from decimal import Decimal, InvalidOperation
from urllib.parse import urlparse

import httpx
import websockets

from .deriv_account import REST_BASE, DerivAccountError

SUPPORTED_SYMBOLS = {
    "R_10", "R_25", "R_50", "R_75", "R_100",
    "1HZ10V", "1HZ25V", "1HZ50V", "1HZ75V", "1HZ100V",
}
APP_ID_ENV = "DERIV_APP_ID"


class DemoTradingError(RuntimeError):
    pass


def duration_for_symbol(symbol: str) -> int:
    if symbol not in SUPPORTED_SYMBOLS:
        raise DemoTradingError("Unsupported volatility market")
    return 2 if symbol.startswith("1HZ") else 1


def _validate_demo_ws_url(ws_url: str) -> None:
    parsed = urlparse(ws_url)
    if (parsed.scheme != "wss" or parsed.hostname != "api.derivws.com"
            or parsed.path != "/trading/v1/options/ws/demo" or not parsed.query):
        raise DemoTradingError("Selected account did not resolve to a Deriv Demo WebSocket")


async def _get_demo_ws_url(account_id: str, access_token: str) -> str:
    app_id = os.getenv(APP_ID_ENV)
    if not app_id:
        raise DemoTradingError("Backend is missing DERIV_APP_ID configuration")
    if not account_id or len(account_id) > 64:
        raise DemoTradingError("A valid Deriv account ID is required")
    if not access_token or len(access_token) > 8192:
        raise DemoTradingError("A valid Deriv OAuth access token is required")
    endpoint = f"{REST_BASE}/trading/v1/options/accounts/{account_id}/otp"
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            response = await client.post(endpoint, headers={
                "Authorization": f"Bearer {access_token}", "Deriv-App-ID": app_id,
            })
    except httpx.HTTPError as exc:
        raise DemoTradingError("Could not reach Deriv account service") from exc
    if response.status_code in (401, 403):
        raise DemoTradingError("Deriv rejected the access token or its permissions")
    if response.status_code >= 400:
        raise DemoTradingError(f"Deriv account service returned HTTP {response.status_code}")
    try:
        ws_url = response.json()["data"]["url"]
    except (ValueError, KeyError, TypeError) as exc:
        raise DemoTradingError("Deriv returned an invalid OTP response") from exc
    _validate_demo_ws_url(ws_url)
    return ws_url


async def _request(ws, payload: dict, expected_type: str, req_id: int) -> dict:
    await ws.send(json.dumps({**payload, "req_id": req_id}))
    for _ in range(8):
        try:
            message = json.loads(await ws.recv())
        except (json.JSONDecodeError, TypeError) as exc:
            raise DemoTradingError("Deriv returned malformed WebSocket data") from exc
        if message.get("req_id") != req_id and message.get("msg_type") != expected_type:
            continue
        if message.get("error"):
            error = message["error"]
            raise DemoTradingError(str(error.get("message", "Deriv request failed"))[:240])
        if message.get("msg_type") == expected_type or expected_type in message:
            return message
    raise DemoTradingError(f"Deriv did not return {expected_type} data")


async def create_demo_proposal(
    account_id: str, access_token: str, symbol: str, contract: str,
    stake: str, currency: str, *, include_proposal_id: bool = False,
) -> dict:
    """Request a Demo-account-specific price proposal; never buys it."""
    if contract not in {"ODD", "EVEN"}:
        raise DemoTradingError("Only ODD and EVEN digit contracts are supported")
    if symbol not in SUPPORTED_SYMBOLS:
        raise DemoTradingError("Unsupported volatility market")
    try:
        amount = Decimal(stake)
    except (InvalidOperation, TypeError) as exc:
        raise DemoTradingError("Stake must be a valid decimal amount") from exc
    if not amount.is_finite() or amount <= 0 or amount > Decimal("1000000"):
        raise DemoTradingError("Stake must be greater than zero and within the supported API range")
    if not currency or not currency.isalnum() or len(currency) > 20:
        raise DemoTradingError("A valid account currency is required")

    ws_url = await _get_demo_ws_url(account_id, access_token)
    try:
        async with websockets.connect(ws_url, open_timeout=15, close_timeout=5) as ws:
            request = {
                "proposal": 1,
                "amount": float(amount),
                "basis": "stake",
                "contract_type": "DIGITODD" if contract == "ODD" else "DIGITEVEN",
                "currency": currency,
                "duration": duration_for_symbol(symbol),
                "duration_unit": "t",
                "underlying_symbol": symbol,
            }
            message = await _request(ws, request, "proposal", 5201)
    except DemoTradingError:
        raise
    except (OSError, TimeoutError) as exc:
        raise DemoTradingError("Could not obtain a Demo contract proposal") from exc

    proposal = message.get("proposal")
    if not isinstance(proposal, dict) or not proposal.get("id"):
        raise DemoTradingError("Deriv returned an incomplete proposal")
    # Treat broker response fields as untrusted input. A successful WebSocket
    # response is not sufficient unless the monetary values are valid.
    try:
        payout = Decimal(str(proposal["payout"]))
        ask_price = Decimal(str(proposal["ask_price"]))
        spot = Decimal(str(proposal["spot"]))
    except (KeyError, InvalidOperation, TypeError) as exc:
        raise DemoTradingError("Deriv proposal is missing valid price fields") from exc
    if (not payout.is_finite() or payout <= 0 or
            not ask_price.is_finite() or ask_price <= 0 or
            not spot.is_finite() or spot < 0):
        raise DemoTradingError("Deriv proposal contains invalid monetary or spot values")
    result = {
        "account_type": "demo",
        "symbol": symbol,
        "contract": contract,
        "duration": duration_for_symbol(symbol),
        "duration_unit": "ticks",
        "stake": format(amount, "f"),
        "currency": currency,
        "payout": format(payout, "f"),
        "ask_price": format(ask_price, "f"),
        "spot": format(spot, "f"),
        "source": "Deriv Demo proposal preview",
        "purchase_enabled": False,
    }
    if include_proposal_id:
        result["proposal_id"] = str(proposal["id"])
    return result


def purchase_blocked() -> dict:
    """Hard stop: no endpoint in this stage can buy a contract."""
    raise DemoTradingError("Demo purchases are disabled in Stage 5; proposal preview only")


async def monitor_demo_contract(account_id: str, access_token: str, contract_id: str, *, timeout_seconds: int = 30) -> dict:
    """Read a Demo contract until settlement or timeout; never sends trade orders."""
    import asyncio

    if not contract_id or not contract_id.isdigit() or len(contract_id) > 32:
        raise DemoTradingError("A valid numeric Deriv contract ID is required")
    if not 1 <= timeout_seconds <= 120:
        raise DemoTradingError("Monitoring timeout must be between 1 and 120 seconds")
    ws_url = await _get_demo_ws_url(account_id, access_token)
    try:
        async with websockets.connect(ws_url, open_timeout=15, close_timeout=5) as ws:
            await ws.send(json.dumps({
                "proposal_open_contract": 1,
                "contract_id": int(contract_id),
                "subscribe": 1,
                "req_id": 6201,
            }))
            for _ in range(100):
                raw = await asyncio.wait_for(ws.recv(), timeout=timeout_seconds)
                try:
                    message = json.loads(raw)
                except (json.JSONDecodeError, TypeError) as exc:
                    raise DemoTradingError("Deriv returned malformed contract status data") from exc
                if message.get("req_id") not in (None, 6201) and message.get("msg_type") != "proposal_open_contract":
                    continue
                if message.get("error"):
                    error = message["error"]
                    raise DemoTradingError(str(error.get("message", "Deriv contract lookup failed"))[:240])
                contract = message.get("proposal_open_contract")
                if not isinstance(contract, dict):
                    continue
                returned_id = str(contract.get("contract_id", ""))
                if returned_id != contract_id:
                    raise DemoTradingError("Deriv returned a different contract ID")
                if contract.get("is_sold") == 1 or contract.get("is_sold") is True:
                    profit = Decimal(str(contract.get("profit")))
                    if not profit.is_finite():
                        raise DemoTradingError("Deriv returned an invalid settled profit")
                    return {
                        "account_type": "demo", "contract_id": contract_id,
                        "is_sold": True, "profit": format(profit, "f"),
                        "currency": str(contract.get("currency", "")),
                        "underlying": str(contract.get("underlying", "")),
                        "contract_type": str(contract.get("contract_type", "")),
                        "buy_price": str(contract.get("buy_price", "")),
                        "status": "SETTLED_CONFIRMED_BY_DERIV",
                    }
                return {
                    "account_type": "demo", "contract_id": contract_id, "is_sold": False,
                    "currency": str(contract.get("currency", "")),
                    "underlying": str(contract.get("underlying", "")),
                    "contract_type": str(contract.get("contract_type", "")),
                    "buy_price": str(contract.get("buy_price", "")),
                    "status": "OPEN_CONFIRMED_BY_DERIV",
                }
            return {"account_type": "demo", "contract_id": contract_id, "status": "MONITOR_LIMIT_REACHED", "is_sold": False}
    except DemoTradingError:
        raise
    except (OSError, TimeoutError, asyncio.TimeoutError) as exc:
        return {"account_type": "demo", "contract_id": contract_id, "status": "STILL_OPEN_OR_NO_UPDATE", "is_sold": False}
