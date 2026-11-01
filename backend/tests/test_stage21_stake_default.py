from decimal import Decimal

from supa_ai_engine.engine import StrategyConfig


def test_backend_default_starting_stake_is_035_usd():
    assert StrategyConfig().initial_stake == Decimal("0.35")
