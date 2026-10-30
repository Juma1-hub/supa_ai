"""Read-only API helpers for the Supa AI strategy engine.

This module does not connect to Deriv or place trades.
Incoming market statistics are passed to the in-memory strategy engine
for analysis only. Live execution remains locked.
"""

from datetime import datetime, timezone

from pydantic import BaseModel, Field

from supa_ai_engine.engine import (
    DerivDigitStats,
    StrategyConfig,
    StrategyEngine,
)


# In-memory instance for development only.
# Persistent background operation requires a separate worker and storage.
engine = StrategyEngine(StrategyConfig())


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
