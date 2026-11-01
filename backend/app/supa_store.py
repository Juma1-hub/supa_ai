"""Small Supabase PostgREST persistence adapter. Service key stays server-side."""
from __future__ import annotations
import os
from typing import Any
import httpx

class SupaStoreError(RuntimeError):
    pass

def _config() -> tuple[str, str]:
    base = os.getenv("SUPABASE_URL", "").rstrip("/")
    key = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
    if not base or not key:
        raise SupaStoreError("Supabase persistence is not configured")
    return base, key

async def save_strategy_draft(user_id: str, payload: dict[str, Any]) -> None:
    base, key = _config()
    row = {"id": payload["id"], "user_id": user_id, "name": payload["name"],
           "status": payload["status"], "rules": payload["rules"], "execution_enabled": False}
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.post(
                f"{base}/rest/v1/strategy_drafts", json=row,
                headers={"apikey": key, "Authorization": f"Bearer {key}",
                         "Content-Type": "application/json", "Prefer": "return=minimal"},
            )
    except httpx.HTTPError as exc:
        raise SupaStoreError("Could not save strategy draft") from exc
    if response.status_code not in (200, 201, 204):
        raise SupaStoreError("Supabase rejected strategy draft storage")

async def get_strategy_draft(user_id: str, draft_id: str) -> dict[str, Any] | None:
    base, key = _config()
    params = {"id": f"eq.{draft_id}", "user_id": f"eq.{user_id}", "select": "id,name,status,rules,execution_enabled"}
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(f"{base}/rest/v1/strategy_drafts", params=params,
                headers={"apikey": key, "Authorization": f"Bearer {key}"})
    except httpx.HTTPError as exc:
        raise SupaStoreError("Could not load strategy draft") from exc
    if response.status_code != 200:
        raise SupaStoreError("Supabase rejected strategy draft lookup")
    rows = response.json()
    return rows[0] if rows else None

async def mark_strategy_approved(user_id: str, draft_id: str) -> None:
    base, key = _config()
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.patch(
                f"{base}/rest/v1/strategy_drafts",
                params={"id": f"eq.{draft_id}", "user_id": f"eq.{user_id}", "status": "eq.AWAITING_REVIEW"},
                json={"status": "APPROVED_MONITORING_ONLY", "execution_enabled": False},
                headers={"apikey": key, "Authorization": f"Bearer {key}", "Prefer": "return=minimal"},
            )
    except httpx.HTTPError as exc:
        raise SupaStoreError("Could not update strategy draft") from exc
    if response.status_code not in (200, 204):
        raise SupaStoreError("Supabase rejected strategy approval update")

async def save_runtime_checkpoint(user_id: str, payload: dict[str, Any]) -> None:
    """Persist only restart-safe financial/runtime fields; never persist Deriv OAuth tokens."""
    base, key = _config()
    required = {"strategy_id", "martingale_step", "session_pnl", "open_contract_ids"}
    if set(payload) != required:
        raise SupaStoreError("Runtime checkpoint fields are invalid")
    if not isinstance(payload["martingale_step"], int) or payload["martingale_step"] < 0:
        raise SupaStoreError("Martingale step is invalid")
    if not isinstance(payload["open_contract_ids"], list) or any(not isinstance(x, str) or not x for x in payload["open_contract_ids"]):
        raise SupaStoreError("Open contract identifiers are invalid")
    row = {"user_id": user_id, **payload, "checkpoint_version": 1}
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.post(
                f"{base}/rest/v1/runtime_checkpoints", json=row,
                headers={"apikey": key, "Authorization": f"Bearer {key}",
                         "Content-Type": "application/json", "Prefer": "resolution=merge-duplicates,return=minimal"},
            )
    except httpx.HTTPError as exc:
        raise SupaStoreError("Could not persist runtime checkpoint") from exc
    if response.status_code not in (200, 201, 204):
        raise SupaStoreError("Supabase rejected runtime checkpoint")

async def load_runtime_checkpoint(user_id: str, strategy_id: str) -> dict[str, Any] | None:
    base, key = _config()
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(
                f"{base}/rest/v1/runtime_checkpoints",
                params={"user_id": f"eq.{user_id}", "strategy_id": f"eq.{strategy_id}",
                        "select": "strategy_id,martingale_step,session_pnl,open_contract_ids,checkpoint_version"},
                headers={"apikey": key, "Authorization": f"Bearer {key}"},
            )
    except httpx.HTTPError as exc:
        raise SupaStoreError("Could not load runtime checkpoint") from exc
    if response.status_code != 200:
        raise SupaStoreError("Supabase rejected runtime checkpoint lookup")
    rows = response.json()
    return rows[0] if rows else None

async def register_persisted_open_contract(user_id: str, payload: dict[str, Any]) -> None:
    """Atomically record a Deriv-confirmed purchase and matching checkpoint."""
    allowed = {"strategy_id", "contract_id", "deriv_account_id", "symbol", "contract_type",
               "stake", "martingale_step", "session_pnl"}
    if set(payload) != allowed:
        raise SupaStoreError("Open contract registration fields are invalid")
    base, key = _config()
    args = {"p_user_id": user_id, **{f"p_{k}": v for k, v in payload.items()}}
    await _call_rpc(base, key, "register_open_contract", args, "Could not register open contract")

async def apply_persisted_settlement(user_id: str, payload: dict[str, Any]) -> bool:
    """Apply a Deriv-confirmed settlement exactly once via a database transaction."""
    allowed = {"contract_id", "profit", "currency", "settled_at", "martingale_enabled"}
    if set(payload) != allowed:
        raise SupaStoreError("Settlement fields are invalid")
    base, key = _config()
    args = {"p_user_id": user_id, **{f"p_{k}": v for k, v in payload.items()}}
    result = await _call_rpc(base, key, "apply_confirmed_settlement", args,
                             "Could not apply confirmed settlement")
    if isinstance(result, list) and result:
        result = result[0]
    return result is True

async def _call_rpc(base: str, key: str, function: str, args: dict[str, Any], error: str) -> Any:
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.post(
                f"{base}/rest/v1/rpc/{function}", json=args,
                headers={"apikey": key, "Authorization": f"Bearer {key}",
                         "Content-Type": "application/json"},
            )
    except httpx.HTTPError as exc:
        raise SupaStoreError(error) from exc
    if response.status_code not in (200, 201, 204):
        raise SupaStoreError(error)
    if response.status_code == 204 or not response.content:
        return None
    try:
        return response.json()
    except ValueError as exc:
        raise SupaStoreError(error) from exc

async def list_reconcilable_open_contracts(user_id: str, deriv_account_id: str, limit: int = 20) -> list[dict[str, Any]]:
    """Return only this user's open contracts for the specified linked Demo account."""
    if not deriv_account_id or not 1 <= limit <= 50:
        raise SupaStoreError("Reconciliation request is invalid")
    base, key = _config()
    result = await _call_rpc(
        base, key, "list_reconcilable_open_contracts",
        {"p_user_id": user_id, "p_deriv_account_id": deriv_account_id, "p_limit": limit},
        "Could not load open contracts for reconciliation",
    )
    if not isinstance(result, list):
        raise SupaStoreError("Supabase returned an invalid reconciliation response")
    return result


async def create_demo_purchase_intent(user_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    """Persist an idempotent PREPARED intent; this function never calls Deriv buy."""
    allowed = {"idempotency_key", "strategy_id", "deriv_account_id", "symbol", "contract_type",
               "stake", "currency", "proposal_id", "ask_price"}
    if set(payload) != allowed:
        raise SupaStoreError("Demo purchase intent fields are invalid")
    base, key = _config()
    result = await _call_rpc(
        base, key, "create_demo_purchase_intent",
        {"p_user_id": user_id, **{f"p_{k}": v for k, v in payload.items()}},
        "Could not create Demo purchase intent",
    )
    if isinstance(result, list) and result:
        result = result[0]
    if not isinstance(result, dict) or not result.get("intent_id"):
        raise SupaStoreError("Supabase returned an invalid purchase-intent response")
    return result


async def confirm_demo_purchase_and_register_contract(user_id: str, payload: dict[str, Any]) -> bool:
    """Atomically bind a Deriv-confirmed contract to its purchase intent and runtime."""
    allowed = {"intent_id", "contract_id", "martingale_step", "session_pnl"}
    if set(payload) != allowed:
        raise SupaStoreError("Confirmed purchase fields are invalid")
    if not str(payload["contract_id"]).isdigit() or len(str(payload["contract_id"])) > 32:
        raise SupaStoreError("Deriv contract ID is invalid")
    base, key = _config()
    result = await _call_rpc(
        base, key, "confirm_demo_purchase_and_register_contract",
        {"p_user_id": user_id, **{f"p_{k}": v for k, v in payload.items()}},
        "Could not atomically register Deriv-confirmed purchase",
    )
    if isinstance(result, list) and result:
        result = result[0]
    return result is True

async def get_demo_purchase_intent(user_id: str, intent_id: str) -> dict[str, Any] | None:
    """Fetch only a user's own intent; service role is never exposed to clients."""
    base, key = _config()
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(
                f"{base}/rest/v1/demo_purchase_intents",
                params={"id": f"eq.{intent_id}", "user_id": f"eq.{user_id}",
                        "select": "id,strategy_id,deriv_account_id,symbol,contract_type,stake,currency,proposal_id,ask_price,status"},
                headers={"apikey": key, "Authorization": f"Bearer {key}"},
            )
    except httpx.HTTPError as exc:
        raise SupaStoreError("Could not load Demo purchase intent") from exc
    if response.status_code != 200:
        raise SupaStoreError("Supabase rejected Demo purchase intent lookup")
    rows = response.json()
    return rows[0] if rows else None


async def link_verified_demo_account(user_id: str, account_id: str, currency: str) -> dict[str, Any]:
    """Persist verified account metadata only; never stores the Deriv access token."""
    if not user_id or not account_id or len(account_id) > 64 or not currency or len(currency) > 12:
        raise SupaStoreError("Verified Demo account details are invalid")
    base, key = _config()
    result = await _call_rpc(base, key, "link_verified_demo_account", {
        "p_user_id": user_id, "p_deriv_account_id": account_id, "p_currency": currency,
    }, "Could not securely link the verified Demo account")
    if isinstance(result, list) and result:
        result = result[0]
    if not isinstance(result, dict) or result.get("account_type") != "demo":
        raise SupaStoreError("Supabase returned an invalid account-link response")
    return result


async def list_linked_demo_accounts(user_id: str) -> list[dict[str, Any]]:
    """Return only account metadata belonging to the authenticated Supa AI user."""
    base, key = _config()
    result = await _call_rpc(base, key, "list_my_demo_accounts", {"p_user_id": user_id},
                             "Could not load linked Demo accounts")
    if not isinstance(result, list):
        raise SupaStoreError("Supabase returned an invalid account list")
    return result


async def link_verified_deriv_account(user_id: str, account_id: str, account_type: str, currency: str) -> dict[str, Any]:
    """Persist verified Deriv account metadata only; OAuth tokens are never stored."""
    if (not user_id or not account_id or len(account_id) > 64
            or account_type not in {"demo", "real"} or not currency or len(currency) > 12):
        raise SupaStoreError("Verified Deriv account details are invalid")
    base, key = _config()
    result = await _call_rpc(base, key, "link_verified_deriv_account", {
        "p_user_id": user_id, "p_deriv_account_id": account_id,
        "p_account_type": account_type, "p_currency": currency,
    }, "Could not securely link the verified Deriv account")
    if isinstance(result, list) and result:
        result = result[0]
    if not isinstance(result, dict) or result.get("account_type") != account_type:
        raise SupaStoreError("Supabase returned an invalid account-link response")
    return result


async def list_linked_deriv_accounts(user_id: str) -> list[dict[str, Any]]:
    """List both account types, scoped to the authenticated Supa AI user."""
    base, key = _config()
    result = await _call_rpc(base, key, "list_my_deriv_accounts", {"p_user_id": user_id},
                             "Could not load linked Deriv accounts")
    if not isinstance(result, list):
        raise SupaStoreError("Supabase returned an invalid account list")
    return result
