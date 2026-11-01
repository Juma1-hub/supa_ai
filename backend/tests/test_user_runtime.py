from app.user_runtime import UserRuntimeRegistry


def approved_draft(draft_id, stake="0.50"):
    return {
        "id": draft_id,
        "name": "ODD strategy",
        "status": "APPROVED_MONITORING_ONLY",
        "rules": {
            "contract_type": "ODD",
            "initial_stake": stake,
            "even_digit_max_pct": "10.0",
            "odd_digit_min_pct": "10.5",
            "min_qualifying_odd_digits": 3,
            "trigger_window_ticks": 5,
            "martingale_enabled": True,
            "martingale_multiplier": "2",
            "session_stop_loss": "10",
            "session_take_profit": "10",
            "max_open_trades": 1,
        },
    }


def test_user_runtimes_are_isolated():
    registry = UserRuntimeRegistry()
    a = registry.activate_approved("user-a", approved_draft("draft-a", "0.50"))
    b = registry.activate_approved("user-b", approved_draft("draft-b", "1.00"))

    assert a.engine is not b.engine
    assert str(a.engine.current_stake()) != str(b.engine.current_stake())
    a.engine.martingale_step = 2
    assert b.engine.martingale_step == 0
    assert registry.snapshot("user-a")["strategy_id"] == "draft-a"
    assert registry.snapshot("user-b")["strategy_id"] == "draft-b"


def test_runtime_is_not_created_without_approved_status():
    registry = UserRuntimeRegistry()
    draft = approved_draft("draft-x")
    draft["status"] = "AWAITING_REVIEW"
    try:
        registry.activate_approved("user-x", draft)
    except ValueError as exc:
        assert "approved" in str(exc).lower()
    else:
        raise AssertionError("unapproved strategy was activated")


def test_runtime_rejects_incomplete_or_extra_rules():
    registry = UserRuntimeRegistry()
    draft = approved_draft("draft-x")
    draft["rules"].pop("initial_stake")
    try:
        registry.activate_approved("user-x", draft)
    except ValueError as exc:
        assert "incomplete" in str(exc).lower()
    else:
        raise AssertionError("incomplete strategy rules were accepted")


def test_unknown_user_gets_empty_locked_snapshot():
    snapshot = UserRuntimeRegistry().snapshot("not-active")
    assert snapshot["runtime_status"] == "NO_APPROVED_STRATEGY"
    assert snapshot["trading_enabled"] is False
    assert snapshot["execution_status"] == "LOCKED"
