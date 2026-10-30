"""Fail-closed strategy state engine. No broker orders are placed here."""
from __future__ import annotations
from dataclasses import dataclass
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from typing import Dict, Optional

def money(value):
    try:
        return value if isinstance(value, Decimal) else Decimal(str(value))
    except (InvalidOperation, ValueError, TypeError) as exc:
        raise ValueError("Invalid monetary value") from exc

@dataclass(frozen=True)
class StrategyConfig:
    initial_stake: Decimal = Decimal("0.50")
    contract_type: str = "ODD"
    even_digit_max_pct: Decimal = Decimal("10.0")
    odd_digit_min_pct: Decimal = Decimal("10.5")
    min_qualifying_odd_digits: int = 3
    trigger_window_ticks: int = 5
    martingale_enabled: bool = True
    martingale_multiplier: Decimal = Decimal("2")
    session_stop_loss: Decimal = Decimal("10")
    session_take_profit: Decimal = Decimal("10")
    max_open_trades: int = 1
    stats_max_age_seconds: int = 10

    def __post_init__(self):
        for key in ("initial_stake", "even_digit_max_pct", "odd_digit_min_pct",
                    "martingale_multiplier", "session_stop_loss", "session_take_profit"):
            object.__setattr__(self, key, money(getattr(self, key)))
        self.validate()

    def validate(self):
        if self.initial_stake <= 0: raise ValueError("initial_stake must be greater than zero")
        if self.contract_type != "ODD": raise ValueError("This strategy core currently supports ODD only")
        if self.trigger_window_ticks < 1: raise ValueError("trigger_window_ticks must be positive")
        if self.martingale_multiplier <= 1: raise ValueError("martingale_multiplier must be greater than 1")
        if self.session_stop_loss <= 0 or self.session_take_profit <= 0:
            raise ValueError("session stop-loss and take-profit must be positive")
        if self.max_open_trades < 1: raise ValueError("max_open_trades must be at least 1")
        if not 1 <= self.min_qualifying_odd_digits <= 5:
            raise ValueError("min_qualifying_odd_digits must be between 1 and 5")

@dataclass(frozen=True)
class DerivDigitStats:
    market: str
    percentages: dict[int, float]
    observed_at: datetime
    source: str
    source_reference: str
    def validate(self):
        if self.source.strip().lower() != "deriv": raise ValueError("Refusing percentages not explicitly sourced from Deriv")
        if not self.source_reference.strip(): raise ValueError("A Deriv source reference is required")
        if set(self.percentages) != set(range(10)): raise ValueError("Deriv stats must contain digits 0 through 9")
        if any(not isinstance(v, (int, float, Decimal)) or not 0 <= v <= 100 for v in self.percentages.values()):
            raise ValueError("Each digit percentage must be between 0 and 100")
        if self.observed_at.tzinfo is None: raise ValueError("observed_at must be timezone-aware")

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
    def __init__(self, config: StrategyConfig | None = None):
        self.config = config or StrategyConfig()
        self.markets: Dict[str, MarketState] = {}
        self.offline_trading_enabled = False
        self.live_trading_enabled = False
        self.session_pnl = Decimal("0")
        self.martingale_step = 0
        self.open_contract_ids: set[str] = set()
        self._settled_contract_ids: set[str] = set()
        self.available_balance: Optional[Decimal] = None
        self.balance_currency: Optional[str] = None
        self.balance_observed_at: Optional[datetime] = None
        self.balance_source_reference: Optional[str] = None

    def set_offline_trading(self, enabled): self.offline_trading_enabled = bool(enabled)

    def set_live_trading(self, enabled):
        if enabled: raise RuntimeError("Live execution is not implemented; live trading remains locked")
        self.live_trading_enabled = False

    def current_stake(self) -> Decimal:
        if not self.config.martingale_enabled: return self.config.initial_stake
        return self.config.initial_stake * (self.config.martingale_multiplier ** self.martingale_step)

    def update_balance(self, *, balance, currency, observed_at, source, source_reference):
        amount = money(balance)
        if amount < 0: raise ValueError("Balance cannot be negative")
        if source.strip().lower() != "deriv" or not source_reference.strip():
            raise ValueError("Balance must have a Deriv source and reference")
        if observed_at.tzinfo is None: raise ValueError("Balance timestamp must be timezone-aware")
        self.available_balance, self.balance_currency = amount, currency
        self.balance_observed_at, self.balance_source_reference = observed_at, source_reference

    def add_open_contract(self, contract_id):
        if not contract_id.strip(): raise ValueError("contract_id is required")
        self.open_contract_ids.add(contract_id)

    def on_confirmed_result(self, contract_id, profit) -> bool:
        if not contract_id.strip(): raise ValueError("A contract ID is required for settlement")
        if contract_id in self._settled_contract_ids: return False
        if contract_id not in self.open_contract_ids:
            raise ValueError("Settlement does not match a tracked open contract")
        result = money(profit)
        self.session_pnl += result
        self.open_contract_ids.remove(contract_id)
        self._settled_contract_ids.add(contract_id)
        if result < 0 and self.config.martingale_enabled: self.martingale_step += 1
        elif result > 0: self.martingale_step = 0
        return True

    def risk_allows_new_entry(self, *, now=None, broker_max_stake=None, currency=None):
        now = now or datetime.now(timezone.utc)
        if self.session_pnl <= -self.config.session_stop_loss: return False, "Session stop-loss reached; new entries paused"
        if self.session_pnl >= self.config.session_take_profit: return False, "Session take-profit reached; new entries paused"
        if len(self.open_contract_ids) >= self.config.max_open_trades: return False, "Maximum concurrent open trades reached"
        if self.available_balance is None or self.balance_observed_at is None:
            return False, "Waiting for a verified Deriv balance"
        age = (now - self.balance_observed_at.astimezone(timezone.utc)).total_seconds()
        if age < -1 or age > self.config.stats_max_age_seconds: return False, "Deriv balance is stale; refresh before entry"
        if currency and self.balance_currency != currency: return False, "Balance currency does not match selected account"
        stake = self.current_stake()
        if broker_max_stake is not None and stake > money(broker_max_stake):
            return False, "Next stake exceeds the broker's permitted maximum"
        if stake > self.available_balance: return False, "Insufficient available balance for the next stake"
        return True, "Risk checks passed"

    @staticmethod
    def _reset_trigger(state):
        state.waiting_for_trigger, state.trigger_digit = True, None
        state.ticks_after_trigger, state.previous_digit = 0, None
        state.entry_confirmed = False

    def update_stats(self, stats, now=None):
        stats.validate()
        now = now or datetime.now(timezone.utc)
        state = self.markets.setdefault(stats.market, MarketState(stats.market))
        age = (now - stats.observed_at.astimezone(timezone.utc)).total_seconds()
        state.last_stats_at, state.qualifies = stats.observed_at, False
        self._reset_trigger(state)
        if age < -1: state.reason = "Rejected: Deriv stats timestamp is in the future"
        elif age > self.config.stats_max_age_seconds: state.reason = "Waiting: Deriv percentages are stale"
        else:
            evens, odds = (0, 2, 4, 6, 8), (1, 3, 5, 7, 9)
            least_pct = min(stats.percentages[d] for d in evens)
            least = tuple(sorted(d for d in evens if stats.percentages[d] == least_pct))
            enough = sum(stats.percentages[d] >= float(self.config.odd_digit_min_pct) for d in odds) >= self.config.min_qualifying_odd_digits
            all_below = all(stats.percentages[d] < float(self.config.even_digit_max_pct) for d in evens)
            state.least_even_digits = least
            state.qualifies = all_below and enough
            state.reason = ("Qualifies using fresh Deriv-supplied percentages; waiting for entry sequence"
                            if state.qualifies else "Does not qualify: " + "; ".join(
                                msg for msg, failed in (("not every even digit is below threshold", not all_below),
                                                        ("too few odd digits meet the minimum frequency", not enough)) if failed))
        return MarketDecision(stats.market, state.qualifies, False, False, state.reason, state.least_even_digits)

    def on_tick(self, market, digit, tick_time=None, *, now=None):
        if digit not in range(10): raise ValueError("digit must be between 0 and 9")
        tick_time, now = tick_time or datetime.now(timezone.utc), now or datetime.now(timezone.utc)
        state = self.markets.setdefault(market, MarketState(market))
        state.last_tick_at, state.entry_confirmed = tick_time, False
        if not state.qualifies:
            return MarketDecision(market, False, False, False, "New entries paused: market does not qualify", state.least_even_digits)
        if state.last_stats_at is None:
            state.qualifies = False
            self._reset_trigger(state)
            return MarketDecision(market, False, False, False, "New entries paused: no verified market statistics", state.least_even_digits)
        age = (now - state.last_stats_at.astimezone(timezone.utc)).total_seconds()
        if age < -1 or age > self.config.stats_max_age_seconds:
            state.qualifies = False
            state.reason = "New entries paused: Deriv percentages are stale"
            self._reset_trigger(state)
            return MarketDecision(market, False, False, False, state.reason, state.least_even_digits)
        if state.waiting_for_trigger:
            if digit in state.least_even_digits:
                state.waiting_for_trigger, state.trigger_digit = False, digit
                state.ticks_after_trigger, state.previous_digit = 0, None
                reason = f"Trigger digit {digit} observed; checking next {self.config.trigger_window_ticks} ticks"
            else: reason = "Waiting for least-frequent even trigger digit"
            return MarketDecision(market, True, False, False, reason, state.least_even_digits)
        state.ticks_after_trigger += 1
        consecutive = state.previous_digit is not None and state.previous_digit % 2 == 1 and digit % 2 == 1
        state.previous_digit = digit
        if consecutive:
            state.entry_confirmed = True
            self._reset_trigger(state)
            allowed, reason = self.risk_allows_new_entry(now=now)
            return MarketDecision(market, True, True, allowed,
                                  "Entry sequence confirmed; execution adapter must recheck risk" if allowed else f"Entry sequence confirmed but blocked: {reason}",
                                  state.least_even_digits)
        if state.ticks_after_trigger >= self.config.trigger_window_ticks:
            self._reset_trigger(state)
            reason = "Entry window expired; waiting for a fresh trigger"
        else: reason = f"Entry window {state.ticks_after_trigger}/{self.config.trigger_window_ticks}; waiting for consecutive odd digits"
        return MarketDecision(market, True, False, False, reason, state.least_even_digits)

    def snapshot(self):
        return {"offline_trading_enabled": self.offline_trading_enabled,
                "live_trading_enabled": self.live_trading_enabled,
                "session_pnl": str(self.session_pnl),
                "martingale_step": self.martingale_step,
                "next_stake": str(self.current_stake()),
                "available_balance": None if self.available_balance is None else str(self.available_balance),
                "balance_currency": self.balance_currency,
                "markets": {k: {"qualifies": s.qualifies, "reason": s.reason,
                                "least_even_digits": list(s.least_even_digits),
                                "waiting_for_trigger": s.waiting_for_trigger,
                                "trigger_digit": s.trigger_digit,
                                "ticks_after_trigger": s.ticks_after_trigger,
                                "entry_confirmed": s.entry_confirmed}
                            for k, s in self.markets.items()},
                "open_contract_ids": sorted(self.open_contract_ids),
                "execution_status": "LOCKED_NOT_IMPLEMENTED",
                "percentage_source_requirement": "DERIV_SOURCE_ONLY",
                "balance_source_requirement": "DERIV_SOURCE_ONLY"}
