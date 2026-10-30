"""Read-only Deriv public market-data collector.

Connects to Deriv's unauthenticated public WebSocket. It never sends
proposal, buy, sell, or other account-scoped trading requests.
"""
from __future__ import annotations

import asyncio
import json
import re
import time
from collections import Counter, deque
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from typing import Any

import websockets

PUBLIC_WS_URL = "wss://api.derivws.com/trading/v1/options/ws/public"

# Standard and 1-second volatility indices requested for the first rollout.
TARGET_SYMBOLS = {
    "R_10", "R_25", "R_50", "R_75", "R_100",
    "1HZ10V", "1HZ25V", "1HZ50V", "1HZ75V", "1HZ100V",
}


def last_digit_from_tick(quote: Any, pip_size: int) -> int:
    """Extract the last displayed decimal digit using Deriv pip_size."""
    if not isinstance(pip_size, int) or not 0 <= pip_size <= 10:
        raise ValueError("Invalid Deriv pip_size")
    try:
        value = Decimal(str(quote))
    except (InvalidOperation, ValueError, TypeError) as exc:
        raise ValueError("Invalid tick quote") from exc
    if not value.is_finite():
        raise ValueError("Tick quote must be finite")
    rendered = f"{value:.{pip_size}f}"
    digits = re.sub(r"\D", "", rendered)
    if not digits:
        raise ValueError("Tick quote contains no digits")
    return int(digits[-1])


class DerivMarketDataCollector:
    """One-process collector. Start/stop it through the API endpoints."""

    def __init__(self, engine, window_size: int = 100):
        if window_size < 10 or window_size > 10000:
            raise ValueError("window_size must be between 10 and 10000")
        self.engine = engine
        self.window_size = window_size
        self.task: asyncio.Task | None = None
        self.stop_event = asyncio.Event()
        self.status = "stopped"
        self.last_error: str | None = None
        self.connected_at: str | None = None
        self.last_tick_at: str | None = None
        self.symbols: dict[str, dict[str, Any]] = {}
        self.buffers: dict[str, deque[int]] = {}
        self.tick_counts: Counter[str] = Counter()
        self._req_id = 1

    def snapshot(self) -> dict:
        return {
            "status": self.status,
            "connected_at": self.connected_at,
            "last_tick_at": self.last_tick_at,
            "last_error": self.last_error,
            "window_size": self.window_size,
            "symbols": {
                symbol: {
                    "display_name": info.get("display_name", symbol),
                    "pip_size": info.get("pip_size"),
                    "ticks_received": self.tick_counts[symbol],
                    "window_filled": len(self.buffers.get(symbol, ())) == self.window_size,
                }
                for symbol, info in self.symbols.items()
            },
            "trading_enabled": False,
        }

    async def start(self):
        if self.task and not self.task.done():
            return self.snapshot()
        self.stop_event = asyncio.Event()
        self.task = asyncio.create_task(self._run())
        return self.snapshot()

    async def stop(self):
        self.stop_event.set()
        if self.task:
            self.task.cancel()
            try:
                await self.task
            except asyncio.CancelledError:
                pass
        self.status = "stopped"
        return self.snapshot()

    async def _run(self):
        self.status = "connecting"
        self.last_error = None
        while not self.stop_event.is_set():
            try:
                async with websockets.connect(
                    PUBLIC_WS_URL, ping_interval=20, ping_timeout=20,
                    close_timeout=5, max_size=2**20
                ) as ws:
                    self.status = "connected"
                    self.connected_at = datetime.now(timezone.utc).isoformat()
                    await ws.send(json.dumps({"active_symbols": "brief", "req_id": self._next_id()}))
                    async for raw in ws:
                        if self.stop_event.is_set():
                            break
                        message = json.loads(raw)
                        if message.get("error"):
                            self.last_error = message["error"].get("message", "Deriv WebSocket error")
                            continue
                        msg_type = message.get("msg_type")
                        if msg_type == "active_symbols":
                            self._handle_symbols(message.get("active_symbols", []), ws)
                        elif msg_type == "tick":
                            self._handle_tick(message.get("tick", {}))
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                self.last_error = str(exc)[:500]
                self.status = "reconnecting"
                await asyncio.sleep(3)
        self.status = "stopped"

    def _next_id(self):
        value = self._req_id
        self._req_id += 1
        return value

    def _handle_symbols(self, rows, ws):
        for row in rows:
            symbol = row.get("symbol")
            if symbol not in TARGET_SYMBOLS:
                continue
            self.symbols[symbol] = {
                "display_name": row.get("display_name") or symbol,
                "pip_size": row.get("pip"),
            }
            self.buffers.setdefault(symbol, deque(maxlen=self.window_size))
            # Deriv public market-data subscription only.
            asyncio.create_task(ws.send(json.dumps({
                "ticks": symbol, "subscribe": 1, "req_id": self._next_id()
            })))

    def _handle_tick(self, tick):
        symbol = tick.get("symbol")
        if symbol not in self.symbols:
            return
        pip_size = tick.get("pip_size")
        if pip_size is None:
            pip_size = self.symbols[symbol].get("pip_size")
        try:
            digit = last_digit_from_tick(tick.get("quote"), int(pip_size))
        except (ValueError, TypeError):
            return

        buffer = self.buffers.setdefault(symbol, deque(maxlen=self.window_size))
        buffer.append(digit)
        self.tick_counts[symbol] += 1
        self.last_tick_at = datetime.now(timezone.utc).isoformat()

        # Only publish complete rolling windows; partial samples cannot qualify.
        if len(buffer) == self.window_size:
            counts = Counter(buffer)
            percentages = {
                d: (counts.get(d, 0) / self.window_size) * 100.0
                for d in range(10)
            }
            observed = datetime.now(timezone.utc)
            from supa_ai_engine.engine import DerivDigitStats
            stats = DerivDigitStats(
                market=symbol,
                percentages=percentages,
                observed_at=observed,
                source="deriv",
                source_reference=f"public-ws:{symbol}:{tick.get('epoch', int(time.time()))}",
            )
            # This is market analysis only. No execution adapter exists.
            self.engine.update_stats(stats, now=observed)
            self.engine.on_tick(
                symbol, digit,
                tick_time=datetime.fromtimestamp(
                    int(tick.get("epoch", time.time())), tz=timezone.utc
                ),
                now=observed,
            )
