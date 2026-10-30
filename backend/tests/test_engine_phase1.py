from datetime import datetime, timezone, timedelta
from decimal import Decimal
import pytest
from supa_ai_engine.engine import DerivDigitStats, StrategyConfig, StrategyEngine

NOW = datetime.now(timezone.utc)

def make_engine(**kwargs):
    return StrategyEngine(StrategyConfig(**kwargs))

def fund(e, amount="100", at=NOW):
    e.update_balance(balance=amount, currency="USD", observed_at=at,
                     source="deriv", source_reference="server-balance-1")

def test_win_always_resets_martingale_and_next_loss_starts_fresh():
    e = make_engine(initial_stake="0.50", martingale_multiplier="2")
    fund(e)
    for cid, result, expected in [
        ("a", "-0.50", "1.00"), ("b", "-1.00", "2.00"),
        ("c", "0.20", "0.50"), ("d", "-0.50", "1.00")]:
        e.add_open_contract(cid)
        e.on_confirmed_result(cid, result)
        assert e.current_stake() == Decimal(expected)

def test_no_configured_step_or_stake_cap():
    e = make_engine(initial_stake="0.50", martingale_multiplier="2")
    fund(e, "100000")
    for n in range(8):
        cid = str(n); e.add_open_contract(cid); e.on_confirmed_result(cid, "-0.50")
    assert e.martingale_step == 8
    assert e.current_stake() == Decimal("128.00")

def test_balance_required_and_staleness_blocks_entry():
    e = make_engine()
    assert not e.risk_allows_new_entry(now=NOW)[0]
    fund(e)
    assert not e.risk_allows_new_entry(now=NOW + timedelta(seconds=20))[0]

def test_insufficient_balance_and_broker_limit_block():
    e = make_engine(initial_stake="0.50", martingale_multiplier="2")
    fund(e, "0.75"); e.add_open_contract("loss"); e.on_confirmed_result("loss", "-0.5")
    ok, reason = e.risk_allows_new_entry(now=NOW)
    assert not ok and "Insufficient" in reason
    fund(e, "100")
    ok, reason = e.risk_allows_new_entry(now=NOW, broker_max_stake="0.5")
    assert not ok and "broker" in reason.lower()

def test_settlement_requires_open_contract_and_is_idempotent():
    e = make_engine()
    with pytest.raises(ValueError): e.on_confirmed_result("unknown", "-1")
    e.add_open_contract("c1")
    assert e.on_confirmed_result("c1", "-1") is True
    assert e.on_confirmed_result("c1", "-1") is False
    assert e.session_pnl == Decimal("-1") and e.martingale_step == 1

def test_live_trading_stays_locked():
    e = make_engine()
    with pytest.raises(RuntimeError): e.set_live_trading(True)
    assert not e.live_trading_enabled

def test_stale_stats_clear_eligibility():
    e = make_engine()
    pct = {0:1, 2:2, 4:3, 6:4, 8:5, 1:11, 3:12, 5:13, 7:5, 9:4}
    assert e.update_stats(DerivDigitStats("R_100", pct, NOW, "deriv", "fresh"), NOW).qualifies
    old = DerivDigitStats("R_100", pct, NOW-timedelta(seconds=30), "deriv", "old")
    assert not e.update_stats(old, NOW).qualifies
    assert e.markets["R_100"].waiting_for_trigger
