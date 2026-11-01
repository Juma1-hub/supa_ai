from datetime import datetime, timezone, timedelta

from supa_ai_engine.engine import DerivDigitStats, StrategyConfig, StrategyEngine


def stats(market, percentages, at):
    return DerivDigitStats(
        market=market,
        percentages=percentages,
        observed_at=at,
        source="deriv",
        source_reference=f"test:{market}",
    )


QUALIFIES = {0: 7, 1: 12, 2: 8, 3: 12, 4: 8, 5: 12, 6: 8, 7: 12, 8: 9, 9: 12}
FAILS = {0: 10, 1: 12, 2: 8, 3: 12, 4: 8, 5: 12, 6: 8, 7: 12, 8: 9, 9: 12}


def test_selects_eligible_market_and_keeps_it_while_qualifying():
    now = datetime.now(timezone.utc)
    engine = StrategyEngine(StrategyConfig())
    engine.update_stats(stats("R_50", QUALIFIES, now), now=now)
    assert engine.select_active_market(now=now) == "R_50"

    engine.update_stats(stats("R_10", QUALIFIES, now), now=now)
    assert engine.select_active_market(now=now) == "R_50"


def test_switches_when_active_market_fails_and_preserves_martingale():
    now = datetime.now(timezone.utc)
    engine = StrategyEngine(StrategyConfig())
    engine.martingale_step = 3

    engine.update_stats(stats("R_50", QUALIFIES, now), now=now)
    engine.select_active_market(now=now)
    engine.update_stats(stats("R_10", QUALIFIES, now), now=now)
    assert engine.select_active_market(now=now) == "R_50"

    engine.update_stats(stats("R_50", FAILS, now + timedelta(seconds=1)),
                        now=now + timedelta(seconds=1))
    selected = engine.select_active_market(now=now + timedelta(seconds=1))

    assert selected == "R_10"
    assert engine.martingale_step == 3
    assert engine.markets["R_50"].waiting_for_trigger


def test_inactive_market_ticks_do_not_advance_its_trigger_sequence():
    now = datetime.now(timezone.utc)
    engine = StrategyEngine(StrategyConfig())
    engine.update_stats(stats("R_50", QUALIFIES, now), now=now)
    engine.select_active_market(now=now)
    engine.update_stats(stats("R_10", QUALIFIES, now), now=now)

    decision = engine.on_tick("R_10", 0, now, now=now)
    assert not decision.entry_confirmed
    assert "active trading-analysis market is R_50" in decision.reason
    assert engine.markets["R_10"].waiting_for_trigger


def test_stale_active_market_is_replaced_by_fresh_eligible_market():
    now = datetime.now(timezone.utc)
    engine = StrategyEngine(StrategyConfig(stats_max_age_seconds=10))
    engine.update_stats(stats("R_50", QUALIFIES, now), now=now)
    engine.select_active_market(now=now)
    later = now + timedelta(seconds=8)
    engine.update_stats(stats("R_10", QUALIFIES, later), now=later)

    assert engine.select_active_market(now=now + timedelta(seconds=11)) == "R_10"
