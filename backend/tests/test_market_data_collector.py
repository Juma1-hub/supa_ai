import asyncio
import json
from collections import deque

from app.deriv_market_data import (
    DerivMarketDataCollector,
    last_digit_from_tick,
)


class FakeWebSocket:
    def __init__(self):
        self.sent = []

    async def send(self, payload):
        self.sent.append(json.loads(payload))


def test_last_digit_uses_display_precision():
    assert last_digit_from_tick("123.40", 2) == 0
    assert last_digit_from_tick("123.47", 2) == 7


def test_last_digit_rejects_invalid_values():
    import pytest
    with pytest.raises(ValueError):
        last_digit_from_tick("NaN", 2)
    with pytest.raises(ValueError):
        last_digit_from_tick("12.3", 11)


def test_only_target_symbols_with_valid_precision_are_subscribed():
    collector = DerivMarketDataCollector(engine=None)
    ws = FakeWebSocket()

    asyncio.run(collector._handle_symbols([
        {"symbol": "R_100", "display_name": "Volatility 100 Index", "pip": 2},
        {"symbol": "NOT_A_TARGET", "pip": 2},
        {"symbol": "R_50", "pip": "2"},
        None,
    ], ws))

    assert [message["ticks"] for message in ws.sent] == ["R_100"]
    assert collector.symbols["R_100"]["pip_size"] == 2
    assert "R__50" not in collector.symbols
    assert "R_50" not in collector.symbols


def test_tick_buffers_are_separate_and_invalid_ticks_are_ignored():
    collector = DerivMarketDataCollector(engine=None, window_size=10)
    collector.symbols = {
        "R_100": {"display_name": "Volatility 100 Index", "pip_size": 2},
        "R_50": {"display_name": "Volatility 50 Index", "pip_size": 2},
    }
    collector.buffers = {
        "R_100": deque(maxlen=10),
        "R_50": deque(maxlen=10),
    }

    collector._handle_tick({"symbol": "R_100", "quote": "123.47", "epoch": 1})
    collector._handle_tick({"symbol": "R_50", "quote": "bad", "epoch": 1})
    collector._handle_tick({"symbol": "UNKNOWN", "quote": "123.45", "epoch": 1})

    assert list(collector.buffers["R_100"]) == [7]
    assert list(collector.buffers["R_50"]) == []
    assert collector.tick_counts["R_100"] == 1
    assert collector.tick_counts["R_50"] == 0
