from decimal import Decimal
import pytest
from pydantic import ValidationError

from app.strategy_engine_api import (
    StrategyDraftRequest, create_strategy_draft, approve_strategy_draft, engine,
)


def valid_payload():
    return StrategyDraftRequest(
        name="Reviewed ODD setup", contract_type="ODD", initial_stake=Decimal("1.00"),
        even_digit_max_pct=Decimal("10"), odd_digit_min_pct=Decimal("10.5"),
        min_qualifying_odd_digits=3, trigger_window_ticks=5,
        martingale_enabled=True, martingale_multiplier=Decimal("2"),
        session_stop_loss=Decimal("10"), session_take_profit=Decimal("10"),
        max_open_trades=1,
    )


def test_draft_waits_for_review_and_does_not_change_active_config():
    original = engine.config
    draft = create_strategy_draft(valid_payload())
    assert draft["status"] == "AWAITING_REVIEW"
    assert draft["execution_enabled"] is False
    assert engine.config is original


def test_approval_applies_config_but_preserves_martingale_and_locks_execution():
    engine.martingale_step = 2
    draft = create_strategy_draft(valid_payload())
    approved = approve_strategy_draft(draft["id"])
    assert approved["status"] == "APPROVED_MONITORING_ONLY"
    assert approved["execution_enabled"] is False
    assert engine.config.initial_stake == Decimal("1.00")
    assert engine.martingale_step == 2
    assert engine.live_trading_enabled is False


def test_unknown_draft_cannot_be_approved():
    with pytest.raises(ValueError):
        approve_strategy_draft("missing")


def test_even_contract_is_explicitly_rejected_until_supported():
    values = valid_payload().model_dump()
    values["contract_type"] = "EVEN"
    with pytest.raises(ValidationError):
        StrategyDraftRequest(**values)


def test_contradictory_frequency_thresholds_are_rejected():
    values = valid_payload().model_dump()
    values["even_digit_max_pct"] = Decimal("11")
    with pytest.raises(ValidationError):
        StrategyDraftRequest(**values)
