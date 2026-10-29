from datetime import datetime, timezone

import pytest

from supa_ai_engine.engine import (
    DerivDigitStats,
    StrategyConfig,
    StrategyEngine,
)


def qualifying_percentages():
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


def make_stats(percentages=None, source="deriv"):
    return DerivDigitStats(
        market="R_100",
        percentages=(
            qualifying_percentages()
            if percentages is None
            else percentages
        ),
        observed_at=datetime.now(timezone.utc),
        source=source,
        source_reference="test-fixture",
    )


def test_stats_reject_non_deriv_source():
    stats = make_stats(source="local")

    with pytest.raises(ValueError, match="not explicitly sourced from Deriv"):
        stats.validate()


def test_stats_reject_even_digit_at_ten_percent():
    percentages = qualifying_percentages()
    percentages[0] = 10.0

    engine = StrategyEngine(StrategyConfig())
    decision = engine.update_stats(
        make_stats(percentages),
        now=datetime.now(timezone.utc),
    )

    assert not decision.qualifies


def test_stats_require_three_qualifying_odd_digits():
    percentages = qualifying_percentages()
    percentages[1] = 10.4
    percentages[3] = 10.4

    engine = StrategyEngine(StrategyConfig())
    decision = engine.update_stats(
        make_stats(percentages),
        now=datetime.now(timezone.utc),
    )

    assert not decision.qualifies


def test_qualifying_stats_are_accepted():
    engine = StrategyEngine(StrategyConfig())
    decision = engine.update_stats(
        make_stats(),
        now=datetime.now(timezone.utc),
    )

    assert decision.qualifies


def test_live_trading_stays_disabled():
    engine = StrategyEngine(StrategyConfig())

    with pytest.raises(Exception):
        engine.set_live_trading(True)
