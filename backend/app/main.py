from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, model_validator
from fastapi import Header, Depends
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from .supa_auth import verify_supabase_access_token, SupaAuthError, SupaUser
from .supa_store import (save_strategy_draft, get_strategy_draft, mark_strategy_approved,
                         save_runtime_checkpoint, load_runtime_checkpoint, SupaStoreError,
                         list_reconcilable_open_contracts, apply_persisted_settlement,
                         create_demo_purchase_intent, get_demo_purchase_intent,
                         confirm_demo_purchase_and_register_contract,
                         link_verified_demo_account, list_linked_demo_accounts,
                         link_verified_deriv_account, list_linked_deriv_accounts)
from .user_runtime import user_runtimes

from .strategy_rules import digit_frequency, last_digit_from_quote
from .strategy_engine_api import (
    get_engine_status,
    get_engine_snapshot,
    validate_market_stats,
    MarketStatsRequest,
    engine,
    StrategyDraftRequest,
    create_strategy_draft,
    approve_strategy_draft,
)
from .deriv_market_data import DerivMarketDataCollector
from .deriv_account import fetch_demo_balance, fetch_real_account_metadata, DerivAccountError
from .deriv_demo_trading import create_demo_proposal, DemoTradingError, purchase_blocked, monitor_demo_contract
from .purchase_reconciliation import verify_contract_matches_intent
from decimal import Decimal, InvalidOperation
from datetime import datetime, timezone
from uuid import UUID


collector = DerivMarketDataCollector(engine, window_size=100)
_supa_bearer = HTTPBearer(auto_error=False)


async def require_supa_user(credentials: HTTPAuthorizationCredentials | None = Depends(_supa_bearer)) -> SupaUser:
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise HTTPException(status_code=401, detail="Supa AI Supabase access token is required")
    try:
        return await verify_supabase_access_token(credentials.credentials)
    except SupaAuthError as exc:
        status = 503 if "not configured" in str(exc).lower() else 401
        raise HTTPException(status_code=status, detail=str(exc)) from exc


app = FastAPI(
    title="Supa AI API",
    description="Development API for a Deriv-focused digit strategy platform.",
    version="0.2.0",
)


app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


class DemoBalanceRequest(BaseModel):
    account_id: str = Field(min_length=3, max_length=64)


class DemoProposalRequest(BaseModel):
    account_id: str = Field(min_length=3, max_length=64)
    symbol: str = Field(min_length=2, max_length=30)
    contract: str = Field(pattern="^(ODD|EVEN)$")
    stake: str = Field(min_length=1, max_length=32)
    currency: str = Field(min_length=2, max_length=20)


class DemoContractMonitorRequest(BaseModel):
    account_id: str = Field(min_length=3, max_length=64)
    contract_id: str = Field(min_length=1, max_length=32)
    timeout_seconds: int = Field(default=30, ge=1, le=120)


class DemoReconcileRequest(BaseModel):
    account_id: str = Field(min_length=3, max_length=64)
    limit: int = Field(default=20, ge=1, le=50)
    timeout_seconds: int = Field(default=10, ge=1, le=30)


class DemoPreflightRequest(DemoProposalRequest):
    """Read-only final check; deliberately cannot purchase a contract."""
    pass


class DemoPurchaseIntentRequest(DemoProposalRequest):
    """Idempotent purchase-intent preparation; never sends a Deriv buy request."""
    idempotency_key: UUID


class DemoPurchaseReconcileRequest(BaseModel):
    account_id: str = Field(min_length=3, max_length=64)
    intent_id: UUID
    contract_id: str = Field(min_length=1, max_length=32, pattern=r"^[0-9]+$")
    timeout_seconds: int = Field(default=10, ge=1, le=30)


class FrequencyRequest(BaseModel):
    digits: list[int] = Field(min_length=1, max_length=10000)

    @model_validator(mode="after")
    def digits_must_be_decimal_digits(self):
        if any(d < 0 or d > 9 for d in self.digits):
            raise ValueError("Every item must be a digit from 0 to 9.")
        return self


class QuoteDigitRequest(BaseModel):
    quote: str = Field(min_length=1, max_length=100)


@app.get("/")
def root():
    return {
        "name": "Supa AI API",
        "status": "development",
        "trading_enabled": False,
        "message": "Read-only Deriv market-data integration. No orders are placed.",
    }


@app.get("/health")
def health():
    return {"status": "ok", "environment": "development", "trading_enabled": False}


@app.post("/tools/digit-frequency")
def calculate_frequency(request: FrequencyRequest):
    return {
        "sample_size": len(request.digits),
        "frequencies": digit_frequency(request.digits),
        "note": "Historical frequencies are observations, not predictions.",
    }


@app.post("/tools/last-digit")
def extract_last_digit(request: QuoteDigitRequest):
    try:
        digit = last_digit_from_quote(request.quote)
    except ValueError as exc:
        return {"valid": False, "error": str(exc)}
    return {"valid": True, "quote": request.quote, "last_digit": digit}


@app.post("/account/demo/balance")
async def demo_account_balance(
    request: DemoBalanceRequest,
    authorization: str | None = Header(default=None, alias="X-Deriv-Access-Token"),
    supa_user: SupaUser = Depends(require_supa_user),
):
    """Read one authenticated Demo balance; never stores tokens or places trades."""
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Deriv OAuth Bearer token is required")
    token = authorization[7:].strip()
    if not token:
        raise HTTPException(status_code=401, detail="Deriv OAuth Bearer token is required")
    try:
        return await fetch_demo_balance(request.account_id, token)
    except DerivAccountError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@app.post("/account/demo/verify")
async def verify_selected_demo_account(
    request: DemoBalanceRequest,
    authorization: str | None = Header(default=None, alias="X-Deriv-Access-Token"),
    supa_user: SupaUser = Depends(require_supa_user),
):
    """Independently verify the selected account is Demo for this authenticated request.

    This is a read-only diagnostic. It does not create a durable account link and
    does not authorize purchases. A future account-linking flow must persist and
    verify ownership before allowing any execution operation.
    """
    if not authorization or not authorization.startswith("Bearer ") or not authorization[7:].strip():
        raise HTTPException(status_code=401, detail="Deriv OAuth Bearer token is required")
    try:
        balance = await fetch_demo_balance(request.account_id, authorization[7:].strip())
    except DerivAccountError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    if balance.get("account_type") != "demo" or balance.get("account_id") != request.account_id:
        raise HTTPException(status_code=403, detail="Deriv did not verify the selected account as Demo")
    try:
        linked = await link_verified_demo_account(supa_user.id, request.account_id, balance["currency"])
    except SupaStoreError as exc:
        message = str(exc)
        status = 409 if "already linked" in message.lower() or "claimed" in message.lower() else 503
        raise HTTPException(status_code=status, detail=message) from exc
    return {
        "verified": True,
        "supa_user_id": supa_user.id,
        "deriv_account_id": request.account_id,
        "account_type": "demo",
        "balance": balance["balance"],
        "currency": balance["currency"],
        "account_link_persisted": True,
        "linked_account": linked,
        "trading_enabled": False,
        "note": "Verified Demo account metadata is linked to this Supa AI user. OAuth tokens are not stored; purchases remain disabled.",
    }


@app.post("/account/real/verify")
async def verify_selected_real_account(
    request: DemoBalanceRequest,
    authorization: str | None = Header(default=None, alias="X-Deriv-Access-Token"),
    supa_user: SupaUser = Depends(require_supa_user),
):
    """Read-only Real account identity check; no persistence or trading authority."""
    if not authorization or not authorization.startswith("Bearer ") or not authorization[7:].strip():
        raise HTTPException(status_code=401, detail="Deriv OAuth Bearer token is required")
    try:
        account = await fetch_real_account_metadata(request.account_id, authorization[7:].strip())
    except DerivAccountError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    try:
        linked = await link_verified_deriv_account(
            supa_user.id, account["account_id"], "real", account["currency"]
        )
    except SupaStoreError as exc:
        message = str(exc)
        status_code = 409 if "already linked" in message.lower() or "claimed" in message.lower() else 503
        raise HTTPException(status_code=status_code, detail=message) from exc
    return {
        "verified": True,
        "supa_user_id": supa_user.id,
        "deriv_account_id": account["account_id"],
        "account_type": "real",
        "currency": account["currency"],
        "status": account["status"],
        "account_link_persisted": True,
        "linked_account": linked,
        "trading_enabled": False,
        "note": "Verified Real account metadata is linked to this Supa AI user. OAuth tokens are not stored; trading remains disabled.",
    }


@app.get("/account/demo/links")
async def get_linked_demo_accounts(supa_user: SupaUser = Depends(require_supa_user)):
    try:
        accounts = await list_linked_demo_accounts(supa_user.id)
    except SupaStoreError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    return {"accounts": accounts, "trading_enabled": False}


@app.get("/account/links")
async def get_linked_deriv_accounts(supa_user: SupaUser = Depends(require_supa_user)):
    """Return this user's verified Demo and Real account metadata only."""
    try:
        accounts = await list_linked_deriv_accounts(supa_user.id)
    except SupaStoreError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    return {"accounts": accounts, "trading_enabled": False}


@app.post("/account/demo/proposal")
async def demo_contract_proposal(
    request: DemoProposalRequest,
    authorization: str | None = Header(default=None, alias="X-Deriv-Access-Token"),
    supa_user: SupaUser = Depends(require_supa_user),
):
    """Get a Demo contract price only; this endpoint never purchases."""
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Deriv OAuth Bearer token is required")
    token = authorization[7:].strip()
    if not token:
        raise HTTPException(status_code=401, detail="Deriv OAuth Bearer token is required")
    try:
        return await create_demo_proposal(
            request.account_id, token, request.symbol, request.contract,
            request.stake, request.currency,
        )
    except DemoTradingError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@app.post("/account/demo/preflight")
async def demo_purchase_preflight(
    request: DemoPreflightRequest,
    authorization: str | None = Header(default=None, alias="X-Deriv-Access-Token"),
    supa_user: SupaUser = Depends(require_supa_user),
):
    """Run read-only account, stake, session and proposal checks; never buys."""
    if not authorization or not authorization.startswith("Bearer ") or not authorization[7:].strip():
        raise HTTPException(status_code=401, detail="Deriv OAuth Bearer token is required")
    token = authorization[7:].strip()
    try:
        stake = Decimal(request.stake)
        balance = await fetch_demo_balance(request.account_id, token)
        if balance.get("account_type") != "demo":
            raise HTTPException(status_code=403, detail="Only Deriv Demo accounts are permitted")
        if balance.get("currency") != request.currency:
            raise HTTPException(status_code=422, detail="Requested currency does not match the Demo account")
        available = Decimal(balance["balance"])
        if not stake.is_finite() or stake <= 0:
            raise HTTPException(status_code=422, detail="Stake must be a positive decimal amount")

        # Stage 12: all preflight risk checks must use the authenticated user's
        # isolated runtime, never the legacy process-global engine.
        runtime = user_runtimes.get(supa_user.id)
        if runtime is None:
            raise HTTPException(status_code=409, detail="No approved strategy runtime exists for this user")
        if not runtime.persistence_ready:
            raise HTTPException(status_code=503, detail="User trading state is not durably available; preflight is paused")
        user_engine = runtime.engine
        if stake != user_engine.current_stake():
            raise HTTPException(status_code=409, detail="Requested stake does not match this user's strategy progression stake")
        if user_engine.session_pnl <= -user_engine.config.session_stop_loss:
            raise HTTPException(status_code=423, detail="Session stop-loss reached")
        if user_engine.session_pnl >= user_engine.config.session_take_profit:
            raise HTTPException(status_code=423, detail="Session take-profit reached")
        if len(user_engine.open_contract_ids) >= user_engine.config.max_open_trades:
            raise HTTPException(status_code=423, detail="Maximum concurrent open trades reached")
        if stake > available:
            raise HTTPException(status_code=422, detail="Insufficient Demo balance for requested stake")
        proposal = await create_demo_proposal(
            request.account_id, token, request.symbol, request.contract,
            request.stake, request.currency,
        )
        ask_price = Decimal(proposal["ask_price"])
        if not ask_price.is_finite() or ask_price <= 0 or ask_price > available:
            raise HTTPException(status_code=422, detail="Deriv proposal price is invalid or exceeds available balance")
        return {
            "preflight_passed": True,
            "account_type": "demo",
            "account_id": request.account_id,
            "symbol": request.symbol,
            "contract": request.contract,
            "duration": proposal["duration"],
            "duration_unit": proposal["duration_unit"],
            "stake": proposal["stake"],
            "ask_price": proposal["ask_price"],
            "payout": proposal["payout"],
            "balance": balance["balance"],
            "currency": request.currency,
            "purchase_enabled": False,
            "strategy_id": runtime.strategy_id,
            "martingale_step": user_engine.martingale_step,
            "session_pnl": format(user_engine.session_pnl, "f"),
            "open_contract_count": len(user_engine.open_contract_ids),
            "note": "All read-only checks passed against this user's isolated runtime. No purchase was sent to Deriv.",
        }
    except (DerivAccountError, DemoTradingError) as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    except (InvalidOperation, ValueError, KeyError, TypeError) as exc:
        raise HTTPException(status_code=422, detail="Could not validate Demo purchase parameters") from exc


@app.post("/account/demo/purchase-intents")
async def prepare_demo_purchase_intent(
    request: DemoPurchaseIntentRequest,
    authorization: str | None = Header(default=None, alias="X-Deriv-Access-Token"),
    supa_user: SupaUser = Depends(require_supa_user),
):
    """Persist a user-owned, idempotent Demo purchase intent without purchasing.

    This deliberately stops before Deriv's buy operation. It is a durable journal
    entry used to test account ownership, proposal binding and retry semantics.
    """
    if not authorization or not authorization.startswith("Bearer ") or not authorization[7:].strip():
        raise HTTPException(status_code=401, detail="Deriv OAuth Bearer token is required")
    token = authorization[7:].strip()
    try:
        stake = Decimal(request.stake)
        if not stake.is_finite() or stake <= 0:
            raise HTTPException(status_code=422, detail="Stake must be a positive decimal amount")
        balance = await fetch_demo_balance(request.account_id, token)
        if balance.get("account_type") != "demo":
            raise HTTPException(status_code=403, detail="Only Deriv Demo accounts are permitted")
        if balance.get("currency") != request.currency:
            raise HTTPException(status_code=422, detail="Requested currency does not match the Demo account")
        available = Decimal(str(balance["balance"]))
        runtime = user_runtimes.get(supa_user.id)
        if runtime is None:
            raise HTTPException(status_code=409, detail="No approved strategy runtime exists for this user")
        if not runtime.persistence_ready:
            raise HTTPException(status_code=503, detail="User trading state is not durably available")
        user_engine = runtime.engine
        if stake != user_engine.current_stake():
            raise HTTPException(status_code=409, detail="Stake does not match this user's current progression stake")
        if user_engine.session_pnl <= -user_engine.config.session_stop_loss or user_engine.session_pnl >= user_engine.config.session_take_profit:
            raise HTTPException(status_code=423, detail="A session risk limit has been reached")
        if len(user_engine.open_contract_ids) >= user_engine.config.max_open_trades:
            raise HTTPException(status_code=423, detail="Maximum concurrent open contracts reached")
        if stake > available:
            raise HTTPException(status_code=422, detail="Insufficient Demo balance")
        proposal_preview = await create_demo_proposal(
            request.account_id, token, request.symbol, request.contract,
            request.stake, request.currency, include_proposal_id=True,
        )
        ask_price = Decimal(proposal_preview["ask_price"])
        if not ask_price.is_finite() or ask_price <= 0 or ask_price > available:
            raise HTTPException(status_code=422, detail="Deriv proposal ask price is invalid or exceeds balance")
        intent = await create_demo_purchase_intent(str(supa_user.id), {
            "idempotency_key": str(request.idempotency_key),
            "strategy_id": runtime.strategy_id,
            "deriv_account_id": request.account_id,
            "symbol": request.symbol,
            "contract_type": request.contract,
            "stake": format(stake, "f"),
            "currency": request.currency,
            "proposal_id": proposal_preview["proposal_id"],
            "ask_price": format(ask_price, "f"),
        })
        return {
            **intent,
            "account_type": "demo",
            "symbol": request.symbol,
            "contract": request.contract,
            "stake": format(stake, "f"),
            "currency": request.currency,
            "proposal_id": proposal_preview["proposal_id"],
            "ask_price": format(ask_price, "f"),
            "purchase_enabled": False,
            "deriv_buy_sent": False,
            "note": "Intent persisted for idempotency testing. No Deriv purchase request was sent.",
        }
    except SupaStoreError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except (DerivAccountError, DemoTradingError) as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    except (InvalidOperation, ValueError, KeyError, TypeError) as exc:
        raise HTTPException(status_code=422, detail="Could not validate Demo purchase intent") from exc


@app.post("/account/demo/purchase-intents/reconcile")
async def reconcile_demo_purchase_intent(
    request: DemoPurchaseReconcileRequest,
    authorization: str | None = Header(default=None, alias="X-Deriv-Access-Token"),
    supa_user: SupaUser = Depends(require_supa_user),
):
    """Read-only recovery: match an already-existing Deriv contract to its intent.

    This endpoint never sends a purchase. It only registers a contract that Deriv
    independently confirms and whose market/type/currency/price match the journal.
    """
    if not authorization or not authorization.startswith("Bearer ") or not authorization[7:].strip():
        raise HTTPException(status_code=401, detail="Deriv OAuth Bearer token is required")
    token = authorization[7:].strip()
    try:
        intent = await get_demo_purchase_intent(str(supa_user.id), str(request.intent_id))
        if intent is None:
            raise HTTPException(status_code=404, detail="Purchase intent was not found for this user")
        if intent.get("deriv_account_id") != request.account_id:
            raise HTTPException(status_code=403, detail="Purchase intent belongs to a different Deriv account")
        if intent.get("status") not in {"PREPARED_PURCHASE_DISABLED", "PURCHASE_UNKNOWN"}:
            raise HTTPException(status_code=409, detail="Purchase intent is not eligible for reconciliation")
        contract = await monitor_demo_contract(
            request.account_id, token, request.contract_id, timeout_seconds=request.timeout_seconds
        )
        if contract.get("status") not in {"OPEN_CONFIRMED_BY_DERIV", "SETTLED_CONFIRMED_BY_DERIV"}:
            raise HTTPException(status_code=409, detail="Deriv has not confirmed this contract")
        verify_contract_matches_intent(intent, contract)
        runtime = user_runtimes.get(supa_user.id)
        if runtime is None or runtime.strategy_id != intent.get("strategy_id") or not runtime.persistence_ready:
            raise HTTPException(status_code=409, detail="Matching durable strategy runtime is unavailable")
        registered = await confirm_demo_purchase_and_register_contract(str(supa_user.id), {
            "intent_id": str(request.intent_id), "contract_id": request.contract_id,
            "martingale_step": runtime.engine.martingale_step,
            "session_pnl": format(runtime.engine.session_pnl, "f"),
        })
        return {"intent_id": str(request.intent_id), "contract_id": request.contract_id,
                "registration_applied": registered, "deriv_status": contract["status"],
                "settlement_reconciliation_required": contract.get("is_sold") is True,
                "purchase_enabled": False, "deriv_buy_sent": False,
                "note": "Contract was matched and durably registered. If already sold, run normal contract reconciliation to apply its confirmed settlement."}
    except SupaStoreError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except DemoTradingError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@app.post("/account/demo/contract/monitor")
async def demo_contract_monitor(
    request: DemoContractMonitorRequest,
    authorization: str | None = Header(default=None, alias="X-Deriv-Access-Token"),
    supa_user: SupaUser = Depends(require_supa_user),
):
    """Read authenticated Demo contract status; apply P/L only after Deriv settlement."""
    if not authorization or not authorization.startswith("Bearer ") or not authorization[7:].strip():
        raise HTTPException(status_code=401, detail="Deriv OAuth Bearer token is required")
    token = authorization[7:].strip()
    try:
        result = await monitor_demo_contract(
            request.account_id, token, request.contract_id, timeout_seconds=request.timeout_seconds
        )
        # This single-contract endpoint is intentionally read-only. Durable,
        # user-scoped settlement application is handled only by the reconciliation
        # endpoint below through the idempotent Supabase transaction.
        return result
    except DemoTradingError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@app.post("/account/demo/contracts/reconcile")
async def reconcile_demo_contracts(
    request: DemoReconcileRequest,
    authorization: str | None = Header(default=None, alias="X-Deriv-Access-Token"),
    supa_user: SupaUser = Depends(require_supa_user),
):
    """Reconcile this user's persisted open contracts against Deriv Demo.

    This endpoint only reads contract status. It applies a settlement through the
    database's idempotent RPC after Deriv reports the contract as sold. It never buys.
    """
    if not authorization or not authorization.startswith("Bearer ") or not authorization[7:].strip():
        raise HTTPException(status_code=401, detail="Deriv OAuth Bearer token is required")
    token = authorization[7:].strip()
    try:
        rows = await list_reconcilable_open_contracts(
            str(supa_user.id), request.account_id, request.limit
        )
        results = []
        for row in rows:
            # Defence in depth: never trust a database response for a different account.
            if row.get("deriv_account_id") != request.account_id:
                continue
            result = await monitor_demo_contract(
                request.account_id, token, str(row["contract_id"]),
                timeout_seconds=request.timeout_seconds,
            )
            if result.get("status") == "SETTLED_CONFIRMED_BY_DERIV":
                if not result.get("currency") or not result.get("profit"):
                    raise DemoTradingError("Deriv settlement is missing profit or currency")
                applied = await apply_persisted_settlement(str(supa_user.id), {
                    "contract_id": str(row["contract_id"]),
                    "profit": result["profit"],
                    "currency": result["currency"],
                    # This is the time Supa AI observed Deriv's confirmed sold state,
                    # not a claim about Deriv's exact internal settlement timestamp.
                    "settled_at": datetime.now(timezone.utc).isoformat(),
                    "martingale_enabled": bool(row.get("martingale_enabled", False)),
                })
                result["persistence_applied"] = applied
                result["duplicate_or_already_processed"] = not applied
            results.append(result)
        return {
            "account_type": "demo",
            "account_id": request.account_id,
            "checked": len(results),
            "results": results,
            "purchase_enabled": False,
            "note": "Read-only Deriv reconciliation; only confirmed sold contracts are persisted.",
        }
    except SupaStoreError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except DemoTradingError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@app.post("/account/demo/buy")
def demo_purchase_disabled():
    """Explicitly blocked until a separately reviewed execution stage."""
    try:
        purchase_blocked()
    except DemoTradingError as exc:
        raise HTTPException(status_code=423, detail=str(exc)) from exc


@app.get("/strategy/status")
def strategy_status(supa_user: SupaUser = Depends(require_supa_user)):
    snapshot = user_runtimes.snapshot(supa_user.id)
    return {"trading_enabled": False, "runtime_status": snapshot["runtime_status"],
            "strategy_id": snapshot.get("strategy_id"), "execution_status": "LOCKED"}


@app.get("/strategy/snapshot")
def strategy_snapshot(supa_user: SupaUser = Depends(require_supa_user)):
    return user_runtimes.snapshot(supa_user.id)


@app.post("/strategy/draft")
async def strategy_create_draft(request: StrategyDraftRequest, supa_user: SupaUser = Depends(require_supa_user)):
    """Validate explicit trader rules and return them for review."""
    try:
        payload = create_strategy_draft(request)
        await save_strategy_draft(supa_user.id, payload)
        return payload
    except SupaStoreError as exc:
        raise HTTPException(status_code=503, detail="Strategy storage is unavailable; draft was not accepted") from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@app.post("/strategy/approve/{draft_id}")
async def strategy_approve_draft(draft_id: str, supa_user: SupaUser = Depends(require_supa_user)):
    """Mark a user's stored draft approved. Does not activate shared process state."""
    try:
        draft = await get_strategy_draft(supa_user.id, draft_id)
        if draft is None:
            raise HTTPException(status_code=404, detail="Strategy draft not found")
        if draft.get("status") != "AWAITING_REVIEW":
            raise HTTPException(status_code=409, detail="Strategy draft is not awaiting review")
        await mark_strategy_approved(supa_user.id, draft_id)
        approved = {**draft, "status": "APPROVED_MONITORING_ONLY"}
        runtime = user_runtimes.activate_approved(supa_user.id, approved)
        checkpoint = await load_runtime_checkpoint(supa_user.id, draft_id)
        runtime = user_runtimes.restore_checkpoint(supa_user.id, draft_id, checkpoint)
        await save_runtime_checkpoint(supa_user.id, user_runtimes.checkpoint_payload(runtime))
        return {"id": draft_id, "status": "APPROVED_MONITORING_ONLY", "execution_enabled": False,
                "runtime_status": "MONITORING_ENGINE_READY", "martingale_step": runtime.engine.martingale_step,
                "restored_open_contract_count": len(runtime.engine.open_contract_ids),
                "state_persistence": "SUPABASE_CHECKPOINTED", "trading_enabled": False,
                "note": "Persistent analysis state was loaded and checkpointed. No orders can be placed."}
    except SupaStoreError as exc:
        raise HTTPException(status_code=503, detail="Strategy storage is unavailable") from exc


@app.post("/strategy/validate-stats")
async def strategy_validate_stats(request: MarketStatsRequest, supa_user: SupaUser = Depends(require_supa_user)):
    from .strategy_engine_api import DerivDigitStats
    try:
        stats = DerivDigitStats(
            market=request.market, percentages=request.percentages, observed_at=request.observed_at,
            source=request.source, source_reference=request.source_reference,
        )
        stats.validate()
        runtime = user_runtimes.get(supa_user.id)
        if runtime is None:
            raise LookupError("No approved strategy is active for this user")
        if not runtime.persistence_ready:
            raise HTTPException(status_code=503, detail="Persistent state is unavailable; analysis is paused")
        decision = user_runtimes.update_stats(supa_user.id, stats)
        try:
            await save_runtime_checkpoint(supa_user.id, user_runtimes.checkpoint_payload(runtime))
        except SupaStoreError as exc:
            user_runtimes.mark_persistence_failed(supa_user.id)
            raise HTTPException(status_code=503, detail="Could not checkpoint strategy state; analysis is paused") from exc
        return {
            "accepted": True, "market": decision.market, "qualifies": decision.qualifies,
            "entry_confirmed": decision.entry_confirmed, "should_enter": False,
            "least_even_digits": list(decision.least_even_digits), "reason": decision.reason,
            "trading_enabled": False,
            "note": "Statistics were evaluated only in this user's isolated analysis engine. No order was placed.",
        }
    except LookupError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@app.post("/market-data/start")
async def start_market_data():
    """Disabled until public feed data can be safely routed to isolated user engines."""
    raise HTTPException(status_code=423, detail="Market-data engine is paused until per-user runtime isolation is complete")
    try:
        return await collector.start()
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/market-data/stop")
async def stop_market_data():
    return await collector.stop()


@app.get("/market-data/status")
def market_data_status():
    return collector.snapshot()
