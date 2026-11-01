"""Read-only API helpers for the Supa AI strategy engine.

This module does not connect to Deriv or place trades.
Incoming market statistics are passed to the in-memory strategy engine
for analysis only. Live execution remains locked.
"""

from datetime import datetime, timezone
from dataclasses import replace
from decimal import Decimal
from uuid import uuid4

from pydantic import BaseModel, Field, model_validator

from supa_ai_engine.engine import (
    DerivDigitStats,
    StrategyConfig,
    StrategyEngine,
)


# In-memory instance for development only.
# Persistent background operation requires a separate worker and storage.
engine = StrategyEngine(StrategyConfig())
_strategy_drafts: dict[str, dict] = {}


class EngineStatusResponse(BaseModel):
    trading_enabled: bool = False
    offline_mode: bool
    markets: list[str]
    note: str


class MarketStatsRequest(BaseModel):
    market: str = Field(min_length=1, max_length=50)
    percentages: dict[int, float]
    observed_at: datetime
    source: str
    source_reference: str = Field(min_length=1, max_length=500)


class StrategyDraftRequest(BaseModel):
    """Explicit, reviewable strategy rules; no free-form guessing occurs here."""
    name: str = Field(min_length=1, max_length=80)
    contract_type: str = Field(pattern="^(ODD|EVEN)$")
    initial_stake: Decimal = Field(gt=0, max_digits=12, decimal_places=2)
    even_digit_max_pct: Decimal = Field(gt=0, le=100)
    odd_digit_min_pct: Decimal = Field(gt=0, le=100)
    min_qualifying_odd_digits: int = Field(ge=1, le=5)
    trigger_window_ticks: int = Field(ge=2, le=100)
    martingale_enabled: bool = True
    martingale_multiplier: Decimal = Field(gt=1, le=100)
    session_stop_loss: Decimal = Field(gt=0)
    session_take_profit: Decimal = Field(gt=0)
    max_open_trades: int = Field(ge=1, le=10)

    @model_validator(mode="after")
    def validate_supported_rules(self):
        if self.contract_type != "ODD":
            raise ValueError("The current strategy engine supports ODD contracts only; EVEN strategies are not yet implemented")
        if self.even_digit_max_pct >= self.odd_digit_min_pct:
            raise ValueError("The even-digit maximum must be lower than the odd-digit minimum")
        return self


def get_engine_status() -> dict:
    """Return the current engine status without enabling execution."""

    snapshot = engine.snapshot()

    return {
        "trading_enabled": False,
        "offline_mode": engine.offline_trading_enabled,
        "markets": list(snapshot["markets"].keys()),
        "note": (
            "Strategy engine analysis only. No Deriv orders are placed. "
            "Market statistics must be independently verified before "
            "being treated as authentic Deriv data."
        ),
    }


def get_engine_snapshot() -> dict:
    """Return the current strategy-engine state for monitoring."""

    snapshot = engine.snapshot()

    # Explicitly report that execution is unavailable.
    snapshot["trading_enabled"] = False
    snapshot["execution_status"] = "LOCKED_NOT_IMPLEMENTED"

    return snapshot


def validate_market_stats(request: MarketStatsRequest) -> dict:
    """Validate market statistics and pass them to the engine for analysis.

    Important:
    The source field is a claim supplied with the request.
    This function does not independently authenticate Deriv.
    """

    stats = DerivDigitStats(
        market=request.market,
        percentages=request.percentages,
        observed_at=request.observed_at,
        source=request.source,
        source_reference=request.source_reference,
    )

    # Reject invalid or non-Deriv-labelled statistics.
    stats.validate()

    # Pass validated statistics into the engine.
    # This updates analysis state only; it does not place an order.
    decision = engine.update_stats(stats)

    return {
        "accepted": True,
        "market": stats.market,
        "observed_at": stats.observed_at.astimezone(
            timezone.utc
        ).isoformat(),
        "source": stats.source,
        "qualifies": decision.qualifies,
        "entry_confirmed": decision.entry_confirmed,
        "should_enter": decision.should_enter,
        "least_even_digits": list(decision.least_even_digits),
        "reason": decision.reason,
        "trading_enabled": False,
        "note": (
            "Statistics passed basic validation and were supplied "
            "to the strategy engine for analysis. Their origin has "
            "not been independently authenticated. No trade was placed."
        ),
    }


def create_strategy_draft(request: StrategyDraftRequest) -> dict:
    """Store a validated draft for user review; does not alter active strategy."""
    config = StrategyConfig(
        initial_stake=request.initial_stake,
        contract_type=request.contract_type,
        even_digit_max_pct=request.even_digit_max_pct,
        odd_digit_min_pct=request.odd_digit_min_pct,
        min_qualifying_odd_digits=request.min_qualifying_odd_digits,
        trigger_window_ticks=request.trigger_window_ticks,
        martingale_enabled=request.martingale_enabled,
        martingale_multiplier=request.martingale_multiplier,
        session_stop_loss=request.session_stop_loss,
        session_take_profit=request.session_take_profit,
        max_open_trades=request.max_open_trades,
    )
    draft_id = str(uuid4())
    payload = {
        "id": draft_id, "name": request.name, "status": "AWAITING_REVIEW",
        "rules": {
            "contract_type": config.contract_type,
            "initial_stake": str(config.initial_stake),
            "even_digit_max_pct": str(config.even_digit_max_pct),
            "odd_digit_min_pct": str(config.odd_digit_min_pct),
            "min_qualifying_odd_digits": config.min_qualifying_odd_digits,
            "trigger_window_ticks": config.trigger_window_ticks,
            "martingale_enabled": config.martingale_enabled,
            "martingale_multiplier": str(config.martingale_multiplier),
            "session_stop_loss": str(config.session_stop_loss),
            "session_take_profit": str(config.session_take_profit),
            "max_open_trades": config.max_open_trades,
        },
        "execution_enabled": False,
    }
    _strategy_drafts[draft_id] = {"payload": payload, "config": config}
    return payload


def approve_strategy_draft(draft_id: str) -> dict:
    """Apply a reviewed strategy configuration to analysis only."""
    draft = _strategy_drafts.get(draft_id)
    if draft is None:
        raise ValueError("Strategy draft not found")
    engine.config = draft["config"]
    # Strategy changes invalidate partial digit sequences, but do not erase
    # confirmed-loss progression or session P/L.
    for state in engine.markets.values():
        engine._reset_trigger(state)
        state.qualifies = False
        state.reason = "Waiting for fresh market statistics under the approved strategy"
    engine.active_market = None
    payload = dict(draft["payload"])
    payload["status"] = "APPROVED_MONITORING_ONLY"
    payload["execution_enabled"] = False
    payload["martingale_step_preserved"] = engine.martingale_step
    return payload
