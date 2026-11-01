"""Per-user, process-local strategy runtimes. Execution remains permanently locked here.

This is an isolation layer, not durable persistence: instances are lost on restart.
A database-backed state repository and atomic settlement transaction are a later stage.
"""
from __future__ import annotations
from dataclasses import dataclass
from threading import RLock
from typing import Any
from supa_ai_engine.engine import StrategyConfig, StrategyEngine, DerivDigitStats


@dataclass
class UserRuntime:
    user_id: str
    strategy_id: str
    strategy_name: str
    engine: StrategyEngine
    persistence_ready: bool = True


class UserRuntimeRegistry:
    def __init__(self) -> None:
        self._runtimes: dict[str, UserRuntime] = {}
        self._lock = RLock()

    @staticmethod
    def _config_from_rules(rules: dict[str, Any]) -> StrategyConfig:
        required = {
            "contract_type", "initial_stake", "even_digit_max_pct", "odd_digit_min_pct",
            "min_qualifying_odd_digits", "trigger_window_ticks", "martingale_enabled",
            "martingale_multiplier", "session_stop_loss", "session_take_profit", "max_open_trades",
        }
        if not isinstance(rules, dict) or set(rules) != required:
            raise ValueError("Approved strategy rules are incomplete or contain unsupported fields")
        # StrategyConfig performs domain validation; no rule is silently defaulted.
        return StrategyConfig(**rules)

    def activate_approved(self, user_id: str, draft: dict[str, Any]) -> UserRuntime:
        if not user_id or not draft.get("id") or draft.get("status") not in {
            "APPROVED_MONITORING_ONLY", "APPROVED_PENDING_ISOLATED_RUNTIME"
        }:
            raise ValueError("Only this user's approved strategy can be activated")
        config = self._config_from_rules(draft.get("rules"))
        runtime = UserRuntime(
            user_id=user_id,
            strategy_id=str(draft["id"]),
            strategy_name=str(draft.get("name", "Approved strategy")),
            engine=StrategyEngine(config),
        )
        runtime.engine.set_live_trading(False)
        with self._lock:
            self._runtimes[user_id] = runtime
        return runtime

    def restore_checkpoint(self, user_id: str, strategy_id: str, checkpoint: dict[str, Any] | None) -> UserRuntime:
        runtime = self.get(user_id)
        if runtime is None or runtime.strategy_id != strategy_id:
            raise LookupError("Approved strategy runtime is not active for this user")
        if checkpoint is not None:
            if checkpoint.get("strategy_id") != strategy_id:
                raise ValueError("Persisted checkpoint belongs to a different strategy")
            runtime.engine.restore_persistent_state(
                martingale_step=checkpoint.get("martingale_step"),
                session_pnl=checkpoint.get("session_pnl"),
                open_contract_ids=checkpoint.get("open_contract_ids"),
            )
        runtime.persistence_ready = True
        runtime.engine.set_live_trading(False)
        return runtime

    @staticmethod
    def checkpoint_payload(runtime: UserRuntime) -> dict[str, Any]:
        return {
            "strategy_id": runtime.strategy_id,
            "martingale_step": runtime.engine.martingale_step,
            "session_pnl": str(runtime.engine.session_pnl),
            "open_contract_ids": sorted(runtime.engine.open_contract_ids),
        }

    def mark_persistence_failed(self, user_id: str) -> None:
        runtime = self.get(user_id)
        if runtime is not None:
            runtime.persistence_ready = False

    def get(self, user_id: str) -> UserRuntime | None:
        with self._lock:
            return self._runtimes.get(user_id)

    def remove(self, user_id: str) -> None:
        with self._lock:
            self._runtimes.pop(user_id, None)

    def update_stats(self, user_id: str, stats: DerivDigitStats):
        runtime = self.get(user_id)
        if runtime is None:
            raise LookupError("No approved strategy is active for this user")
        return runtime.engine.update_stats(stats)

    def snapshot(self, user_id: str) -> dict[str, Any]:
        runtime = self.get(user_id)
        if runtime is None:
            return {
                "runtime_status": "NO_APPROVED_STRATEGY",
                "trading_enabled": False,
                "execution_status": "LOCKED",
            }
        snapshot = runtime.engine.snapshot()
        return {
            "runtime_status": "MONITORING_ENGINE_READY",
            "strategy_id": runtime.strategy_id,
            "strategy_name": runtime.strategy_name,
            "trading_enabled": False,
            "execution_status": "LOCKED",
            "state_persistence": "SUPABASE_CHECKPOINTED_FAIL_CLOSED",
            "persistence_ready": runtime.persistence_ready,
            **snapshot,
        }


user_runtimes = UserRuntimeRegistry()
