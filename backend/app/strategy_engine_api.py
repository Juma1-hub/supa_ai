"""Read-only API helpers for the Supa AI strategy engine.

This module does not connect to Deriv or place trades.
"""

from datetime import datetime, timezone

from pydantic import BaseModel, Field

from supa_ai_engine.engine import (
    DerivDigitStats,
    StrategyConfig,
    StrategyEngine,
)


# In-memory instance for development only.
# Persistent background operation will require a separate worker and storage.
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
    return {
        "trading_enabled": False,
        "offline_mode": engine.offline_trading_enabled,
        "markets": [],
        "note": (
            "Strategy engine status only. No Deriv orders are placed. "
            "Market statistics must come from a verified Deriv source."
        ),
    }


def validate_market_stats(request: MarketStatsRequest) -> dict:
    stats = DerivDigitStats(
        market=request.market,
        percentages=request.percentages,
        observed_at=request.observed_at,
        source=request.source,
        source_reference=request.source_reference,
    )

    stats.validate()

    return {
        "accepted": True,
        "market": stats.market,
        "observed_at": stats.observed_at.astimezone(timezone.utc).isoformat(),
        "source": stats.source,
        "note": (
            "The supplied statistics passed basic validation. "
            "This does not independently verify their origin or authorize trading."
        ),
    }
