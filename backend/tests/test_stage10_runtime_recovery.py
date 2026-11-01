from decimal import Decimal
import pytest
from app.user_runtime import UserRuntimeRegistry

RULES = {
    "contract_type": "ODD",
    "initial_stake": "0.50",
    "even_digit_max_pct": "10.0",
    "odd_digit_min_pct": "10.5",
    "min_qualifying_odd_digits": 3,
    "trigger_window_ticks": 5,
    "martingale_enabled": True,
    "martingale_multiplier": "2",
    "session_stop_loss": "10",
    "session_take_profit": "10",
    "max_open_trades": 1,
}


def make_registry_runtime():
    registry = UserRuntimeRegistry()
    runtime = registry.activate_approved("user-a", {
        "id": "strategy-a", "name": "Recovery test", "status": "APPROVED_MONITORING_ONLY",
        "rules": RULES,
    })
    return registry, runtime


def test_runtime_restores_progression_pnl_and_open_contracts():
    registry, runtime = make_registry_runtime()
    restored = registry.restore_checkpoint("user-a", "strategy-a", {
        "strategy_id": "strategy-a", "martingale_step": 2,
        "session_pnl": "-1.25", "open_contract_ids": ["contract-123"],
    })
    assert restored.engine.martingale_step == 2
    assert restored.engine.session_pnl == Decimal("-1.25")
    assert restored.engine.open_contract_ids == {"contract-123"}
    assert restored.engine.current_stake() == Decimal("2.00")
    assert restored.engine.live_trading_enabled is False


def test_checkpoint_payload_contains_only_restart_safe_fields():
    registry, runtime = make_registry_runtime()
    runtime.engine.restore_persistent_state(
        martingale_step=1, session_pnl="0.75", open_contract_ids=["c-1"]
    )
    assert registry.checkpoint_payload(runtime) == {
        "strategy_id": "strategy-a", "martingale_step": 1,
        "session_pnl": "0.75", "open_contract_ids": ["c-1"],
    }


def test_checkpoint_from_another_strategy_is_rejected():
    registry, _ = make_registry_runtime()
    with pytest.raises(ValueError, match="different strategy"):
        registry.restore_checkpoint("user-a", "strategy-a", {
            "strategy_id": "strategy-b", "martingale_step": 0,
            "session_pnl": "0", "open_contract_ids": [],
        })


def test_invalid_persisted_state_is_rejected():
    registry, _ = make_registry_runtime()
    with pytest.raises(ValueError, match="Martingale step"):
        registry.restore_checkpoint("user-a", "strategy-a", {
            "strategy_id": "strategy-a", "martingale_step": -1,
            "session_pnl": "0", "open_contract_ids": [],
        })


def test_failed_persistence_marks_runtime_unready():
    registry, runtime = make_registry_runtime()
    registry.mark_persistence_failed("user-a")
    assert runtime.persistence_ready is False
    assert registry.snapshot("user-a")["persistence_ready"] is False
