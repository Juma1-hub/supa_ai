import pytest

from supa_ai_engine.engine import (
    DerivDigitStats,
    StrategyConfig,
    StrategyEngine,
)


def make_stats(percentages, timestamp=1000.0):
    return DerivDigitStats(
        market="R_100",
        percentages=percentages,
        timestamp=timestamp,
        source="deriv",
        source_reference="test-fixture",
    )


def qualifying_percentages():
    # Every even digit is below 10%.
    # At least three odd digits are 10.5% or higher.
    return {
        0: 9.0,
        1: 11.0,
        2: 8.0,
        3: 12.0,
        4: 9.5,
        5: 10.5,
        6: 7.0,
        7: 10.0,
        8: 9.0,
        9: 14.0,
    }


def test_stats_reject_non_deriv_source():
    stats = DerivDigitStats(
        market="R_100",
        percentages=qualifying_percentages(),
        timestamp=1000.0,
        source="local",
        source_reference="test-fixture",
    )

    engine = StrategyEngine(StrategyConfig())

    decision = engine.update_stats(stats, now=1000.0)

    assert not decision.qualifies


def test_stats_reject_even_digit_at_ten_percent():
    percentages = qualifying_percentages()
    percentages[0] = 10.0

    engine = StrategyEngine(StrategyConfig())
    decision = engine.update_stats(
        make_stats(percentages),
        now=1000.0,
    )

    assert not decision.qualifies


def test_stats_require_three_qualifying_odd_digits():
    percentages = qualifying_percentages()
    percentages[5] = 10.4
    percentages[9] = 10.4

    engine = StrategyEngine(StrategyConfig())
    decision = engine.update_stats(
        make_stats(percentages),
        now=1000.0,
    )

    assert not decision.qualifies


def test_qualifying_stats_are_accepted():
    engine = StrategyEngine(StrategyConfig())

    decision = engine.update_stats(
        make_stats(qualifying_percentages()),
        now=1000.0,
    )

    assert decision.qualifies


def test_live_trading_stays_disabled():
    engine = StrategyEngine(StrategyConfig())

    with pytest.raises(Exception):
        engine.set_live_trading(True)
