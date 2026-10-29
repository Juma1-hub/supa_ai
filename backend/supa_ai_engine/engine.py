"""Deterministic strategy-state core. This module never places broker orders.

Important: percentages are accepted only as an upstream Deriv-provided payload.
This module deliberately does not derive digit percentages from tick history.
Ticks are accepted only to track the user's trigger/sequence rule.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Dict, Optional


@dataclass(frozen=True)
class StrategyConfig:
    initial_stake: float = 0.50
    contract_type: str = "ODD"
    even_digit_max_pct: float = 10.0
    odd_digit_min_pct: float = 10.5
    min_qualifying_odd_digits: int = 3
    trigger_window_ticks: int = 5
    martingale_enabled: bool = True
    martingale_multiplier: float = 2.0
    max_stake: float = 5.0
    session_stop_loss: float = 10.0
    session_take_profit: float = 10.0
    max_open_trades: int = 1
    stats_max_age_seconds: int = 10

    def validate(self) -> None:
        if self.initial_stake <= 0:
            raise ValueError("initial_stake must be greater than zero")
        if self.contract_type != "ODD":
            raise ValueError("This strategy core currently supports ODD only")
        if self.trigger_window_ticks < 1:
            raise ValueError("trigger_window_ticks must be positive")
        if self.martingale_multiplier < 1:
            raise ValueError("martingale_multiplier must be >= 1")
        if self.max_stake < self.initial_stake:
            raise ValueError("max_stake cannot be below initial_stake")
        if self.session_stop_loss <= 0 or self.session_take_profit <= 0:
            raise ValueError("session stop-loss and take-profit must be positive")
        if self.max_open_trades < 1:
            raise ValueError("max_open_trades must be at least 1")


@dataclass(frozen=True)
class DerivDigitStats:
    """Digit percentages supplied by a verified Deriv stats source."""
    market: str
    percentages: Dict[int, float]
    observed_at: datetime
    source: str
    source_reference: str

    def validate(self) -> None:
        if self.source.strip().lower() != "deriv":
            raise ValueError(
                "Refusing percentages not explicitly sourced from Deriv"
            )
        if not self.source_reference.strip():
            raise ValueError("A Deriv source reference is required")
        if set(self.percentages.keys()) != set(range(10)):
            raise ValueError(
                "Deriv stats must contain percentages for digits 0 through 9"
            )
        if any(
            not isinstance(value, (int, float))
            or value < 0
            or value > 100
            for value in self.percentages.values()
        ):
            raise ValueError("Each digit percentage must be between 0 and 100")
        if self.observed_at.tzinfo is None:
            raise ValueError("observed_at must be timezone-aware")


@dataclass
class MarketState:
    market: str
    qualifies: bool = False
    reason: str = "Waiting for verified Deriv percentages"
    least_even_digits: tuple[int, ...] = ()
    waiting_for_trigger: bool = True
    trigger_digit: Optional[int] = None
    ticks_after_trigger: int = 0
    previous_digit: Optional[int] = None
    entry_confirmed: bool = False
    last_stats_at: Optional[datetime] = None
    last_tick_at: Optional[datetime] = None


@dataclass(frozen=True)
class MarketDecision:
    market: str
    qualifies: bool
    entry_confirmed: bool
    should_enter: bool
    reason: str
    least_even_digits: tuple[int, ...]


class StrategyEngine:
    """Per-market strategy state machine; execution is outside this module."""

    def __init__(self, config: StrategyConfig | None = None):
        self.config = config or StrategyConfig()
        self.config.validate()
        self.markets: Dict[str, MarketState] = {}
        self.offline_trading_enabled = False
        self.live_trading_enabled = False
        self.session_pnl = 0.0
        self.martingale_step = 0
        self.open_contract_ids: set[str] = set()

    def set_offline_trading(self, enabled: bool) -> None:
        self.offline_trading_enabled = bool(enabled)

    def set_live_trading(self, enabled: bool) -> None:
        """Live execution is not implemented; fail closed."""
        if enabled:
            raise RuntimeError(
                "Live execution is not implemented; live trading remains locked"
            )
        self.live_trading_enabled = False

    def current_stake(self) -> float:
        if not self.config.martingale_enabled:
            return min(self.config.initial_stake, self.config.max_stake)

        proposed = self.config.initial_stake * (
            self.config.martingale_multiplier ** self.martingale_step
        )
        return round(min(proposed, self.config.max_stake), 2)

    def on_confirmed_result(self, profit: float) -> None:
        """Update session risk only from a confirmed contract result."""
        self.session_pnl = round(self.session_pnl + float(profit), 2)

        if profit < 0 and self.config.martingale_enabled:
            self.martingale_step += 1
        elif profit > 0:
            self.martingale_step = 0

    def risk_allows_new_entry(self) -> tuple[bool, str]:
        if self.session_pnl <= -abs(self.config.session_stop_loss):
            return False, "Session stop-loss reached; new entries paused"

        if self.session_pnl >= abs(self.config.session_take_profit):
            return False, "Session take-profit reached; new entries paused"

        if len(self.open_contract_ids) >= self.config.max_open_trades:
            return False, "Maximum concurrent open trades reached"

        if self.current_stake() > self.config.max_stake:
            return False, "Stake exceeds configured maximum"

        return True, "Risk checks passed"

    def update_stats(
        self,
        stats: DerivDigitStats,
        now: datetime | None = None,
    ) -> MarketDecision:
        stats.validate()
        now = now or datetime.now(timezone.utc)

        state = self.markets.setdefault(
            stats.market,
            MarketState(market=stats.market),
        )

        age = (
            now - stats.observed_at.astimezone(timezone.utc)
        ).total_seconds()

        state.last_stats_at = stats.observed_at
        state.qualifies = False
        state.entry_confirmed = False

        if age < -1:
            state.reason = "Rejected: Deriv stats timestamp is in the future"
            state.waiting_for_trigger = True
            state.trigger_digit = None
            state.ticks_after_trigger = 0
            state.previous_digit = None

        elif age > self.config.stats_max_age_seconds:
            state.reason = "Waiting: Deriv percentages are stale"
            state.waiting_for_trigger = True
            state.trigger_digit = None
            state.ticks_after_trigger = 0
            state.previous_digit = None

        else:
            even_digits = (0, 2, 4, 6, 8)
            odd_digits = (1, 3, 5, 7, 9)

            even_values = {
                digit: stats.percentages[digit]
                for digit in even_digits
            }

            least_pct = min(even_values.values())
            least_digits = tuple(
                sorted(
                    digit
                    for digit, pct in even_values.items()
                    if pct == least_pct
                )
            )

            qualifying_odds = tuple(
                digit
                for digit in odd_digits
                if stats.percentages[digit] >= self.config.odd_digit_min_pct
            )

            all_evens_below = all(
                stats.percentages[digit] < self.config.even_digit_max_pct
                for digit in even_digits
            )

            enough_odds = (
                len(qualifying_odds)
                >= self.config.min_qualifying_odd_digits
            )

            state.least_even_digits = least_digits
            state.qualifies = all_evens_below and enough_odds

            if state.qualifies:
                state.reason = (
                    "Qualifies using fresh Deriv-supplied percentages; "
                    "waiting for market-specific entry sequence"
                )
            else:
                failures = []

                if not all_evens_below:
                    failures.append("not every even digit is below 10%")

                if not enough_odds:
                    failures.append(
                        "fewer than three odd digits are at least 10.5%"
                    )

                state.reason = "Does not qualify: " + "; ".join(failures)

                # A disqualified market cannot continue an old trigger sequence.
                state.waiting_for_trigger = True
                state.trigger_digit = None
                state.ticks_after_trigger = 0
                state.previous_digit = None

        return MarketDecision(
            market=stats.market,
            qualifies=state.qualifies,
            entry_confirmed=state.entry_confirmed,
            should_enter=False,
            reason=state.reason,
            least_even_digits=state.least_even_digits,
        )

    def on_tick(
        self,
        market: str,
        digit: int,
        tick_time: datetime | None = None,
    ) -> MarketDecision:
        if digit not in range(10):
            raise ValueError("digit must be between 0 and 9")

        tick_time = tick_time or datetime.now(timezone.utc)

        state = self.markets.setdefault(
            market,
            MarketState(market=market),
        )

        state.last_tick_at = tick_time
        state.entry_confirmed = False

        if not state.qualifies:
            return MarketDecision(
                market,
                False,
                False,
                False,
                "New entries paused: market does not qualify",
                state.least_even_digits,
            )

        if state.waiting_for_trigger:
            if digit in state.least_even_digits:
                state.waiting_for_trigger = False
                state.trigger_digit = digit
                state.ticks_after_trigger = 0
                state.previous_digit = None

                return MarketDecision(
                    market,
                    True,
                    False,
                    False,
                    (
                        f"Trigger digit {digit} observed; checking the next "
                        f"{self.config.trigger_window_ticks} ticks"
                    ),
                    state.least_even_digits,
                )

            return MarketDecision(
                market,
                True,
                False,
                False,
                "Waiting for least-frequent even trigger digit",
                state.least_even_digits,
            )

        # Only ticks after the trigger count toward the five-tick window.
        state.ticks_after_trigger += 1

        consecutive_odds = (
            state.previous_digit is not None
            and state.previous_digit % 2 == 1
            and digit % 2 == 1
        )

        state.previous_digit = digit

        if consecutive_odds:
            state.entry_confirmed = True
            state.waiting_for_trigger = True
            state.trigger_digit = None
            state.ticks_after_trigger = 0
            state.previous_digit = None

            allowed, reason = self.risk_allows_new_entry()

            if not allowed:
                return MarketDecision(
                    market,
                    True,
                    True,
                    False,
                    f"Entry sequence confirmed but blocked: {reason}",
                    state.least_even_digits,
                )

            return MarketDecision(
                market,
                True,
                True,
                True,
                (
                    "Entry sequence confirmed; an execution adapter must "
                    "recheck risk before requesting a proposal"
                ),
                state.least_even_digits,
            )

        if state.ticks_after_trigger >= self.config.trigger_window_ticks:
            state.waiting_for_trigger = True
            state.trigger_digit = None
            state.ticks_after_trigger = 0
            state.previous_digit = None

            return MarketDecision(
                market,
                True,
                False,
                False,
                "Five-tick entry window expired; waiting for a fresh trigger",
                state.least_even_digits,
            )

        return MarketDecision(
            market,
            True,
            False,
            False,
            (
                f"Entry window {state.ticks_after_trigger}/"
                f"{self.config.trigger_window_ticks}; "
                "waiting for consecutive odd digits"
            ),
            state.least_even_digits,
        )

    def snapshot(self) -> dict:
        return {
            "offline_trading_enabled": self.offline_trading_enabled,
            "live_trading_enabled": self.live_trading_enabled,
            "session_pnl": self.session_pnl,
            "martingale_step": self.martingale_step,
            "next_stake": self.current_stake(),
            "markets": {
                symbol: {
                    "qualifies": state.qualifies,
                    "reason": state.reason,
                    "least_even_digits": list(state.least_even_digits),
                    "waiting_for_trigger": state.waiting_for_trigger,
                    "trigger_digit": state.trigger_digit,
                    "ticks_after_trigger": state.ticks_after_trigger,
                    "entry_confirmed": state.entry_confirmed,
                }
                for symbol, state in self.markets.items()
            },
            "open_contract_ids": sorted(self.open_contract_ids),
            "execution_status": "LOCKED_NOT_IMPLEMENTED",
            "percentage_source_requirement": "DERIV_SOURCE_ONLY",
        }
