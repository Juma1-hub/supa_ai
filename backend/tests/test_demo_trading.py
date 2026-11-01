import asyncio
import json
import pytest
from fastapi.testclient import TestClient

from app import main
from app import deriv_demo_trading as trading


def test_standard_and_one_hz_durations():
    assert trading.duration_for_symbol("R_100") == 1
    assert trading.duration_for_symbol("1HZ100V") == 2
    with pytest.raises(trading.DemoTradingError):
        trading.duration_for_symbol("UNKNOWN")


def test_demo_proposal_uses_digit_contract_and_never_buys(monkeypatch):
    captured = {}

    class FakeWS:
        async def __aenter__(self): return self
        async def __aexit__(self, *args): pass
        async def send(self, raw): captured["request"] = json.loads(raw)
        async def recv(self):
            return json.dumps({"msg_type": "proposal", "req_id": 5201,
                "proposal": {"id": "proposal-secret-id", "payout": 1.9,
                    "ask_price": 1.0, "spot": 123.45}})

    async def fake_url(account_id, token):
        assert account_id == "VRTC12345"
        assert token == "temporary-token"
        return "wss://api.derivws.com/trading/v1/options/ws/demo?otp=one-time"

    monkeypatch.setattr(trading, "_get_demo_ws_url", fake_url)
    monkeypatch.setattr(trading.websockets, "connect", lambda *a, **k: FakeWS())
    result = asyncio.run(trading.create_demo_proposal(
        "VRTC12345", "temporary-token", "1HZ100V", "ODD", "1.25", "USD"))
    assert captured["request"]["contract_type"] == "DIGITODD"
    assert captured["request"]["duration"] == 2
    assert captured["request"]["duration_unit"] == "t"
    assert result["purchase_enabled"] is False
    assert "proposal-secret-id" not in str(result)


def test_proposal_rejects_unsupported_market_and_contract():
    with pytest.raises(trading.DemoTradingError):
        asyncio.run(trading.create_demo_proposal("VRTC1", "x", "UNKNOWN", "ODD", "1", "USD"))
    with pytest.raises(trading.DemoTradingError):
        asyncio.run(trading.create_demo_proposal("VRTC1", "x", "R_100", "HIGHER", "1", "USD"))


def test_buy_endpoint_is_hard_locked():
    client = TestClient(main.app)
    response = client.post("/account/demo/buy", json={})
    assert response.status_code == 423
    assert "disabled" in response.json()["detail"].lower()


def test_proposal_endpoint_requires_bearer_token():
    client = TestClient(main.app)
    response = client.post("/account/demo/proposal", json={
        "account_id": "VRTC12345", "symbol": "R_100", "contract": "ODD",
        "stake": "1", "currency": "USD"})
    assert response.status_code == 401


def test_demo_preflight_passes_read_only_without_buy(monkeypatch):
    from decimal import Decimal
    from datetime import datetime, timezone

    async def fake_balance(account_id, token):
        return {"account_id": account_id, "account_type": "demo", "balance": "100.00", "currency": "USD"}

    async def fake_proposal(account_id, token, symbol, contract, stake, currency):
        return {"account_type": "demo", "symbol": symbol, "contract": contract,
                "duration": 1, "duration_unit": "ticks", "stake": stake,
                "currency": currency, "ask_price": "0.50", "payout": "0.95"}

    monkeypatch.setattr(main, "fetch_demo_balance", fake_balance)
    monkeypatch.setattr(main, "create_demo_proposal", fake_proposal)
    from supa_ai_engine.engine import StrategyConfig, StrategyEngine
    from app.user_runtime import UserRuntime
    user_engine = StrategyEngine(StrategyConfig(initial_stake=Decimal("0.50")))
    runtime = UserRuntime(
        user_id="00000000-0000-0000-0000-000000000001",
        strategy_id="00000000-0000-0000-0000-000000000099",
        strategy_name="Test strategy", engine=user_engine, persistence_ready=True,
    )
    monkeypatch.setattr(main.user_runtimes, "get", lambda user_id: runtime if user_id == runtime.user_id else None)
    # The legacy global engine is deliberately set to an incompatible stake;
    # preflight must use only the authenticated user's isolated runtime.
    main.engine.config = StrategyConfig(initial_stake=Decimal("9.99"))
    client = TestClient(main.app)
    response = client.post("/account/demo/preflight", headers={"X-Deriv-Access-Token": "Bearer demo-token"}, json={
        "account_id": "VRTC12345", "symbol": "R_100", "contract": "ODD", "stake": "0.50", "currency": "USD"})
    assert response.status_code == 200
    assert response.json()["preflight_passed"] is True
    assert response.json()["purchase_enabled"] is False


def test_demo_preflight_rejects_stake_not_matching_progression(monkeypatch):
    from decimal import Decimal
    async def fake_balance(account_id, token):
        return {"account_id": account_id, "account_type": "demo", "balance": "100.00", "currency": "USD"}
    monkeypatch.setattr(main, "fetch_demo_balance", fake_balance)
    from supa_ai_engine.engine import StrategyConfig, StrategyEngine
    from app.user_runtime import UserRuntime
    runtime = UserRuntime("00000000-0000-0000-0000-000000000001", "strategy-1", "Test",
                          StrategyEngine(StrategyConfig(initial_stake=Decimal("0.50"))), True)
    monkeypatch.setattr(main.user_runtimes, "get", lambda user_id: runtime)
    client = TestClient(main.app)
    response = client.post("/account/demo/preflight", headers={"X-Deriv-Access-Token": "Bearer demo-token"}, json={
        "account_id": "VRTC12345", "symbol": "R_100", "contract": "ODD", "stake": "1.00", "currency": "USD"})
    assert response.status_code == 409


def test_monitor_returns_only_deriv_confirmed_settlement(monkeypatch):
    class FakeWS:
        async def __aenter__(self): return self
        async def __aexit__(self, *args): pass
        async def send(self, raw):
            request = json.loads(raw)
            assert request["proposal_open_contract"] == 1
            assert request["contract_id"] == 123456
        async def recv(self):
            return json.dumps({"msg_type": "proposal_open_contract", "req_id": 6201,
                "proposal_open_contract": {"contract_id": 123456, "is_sold": 1,
                    "profit": "-0.50", "currency": "USD"}})

    async def fake_url(account_id, token):
        return "wss://api.derivws.com/trading/v1/options/ws/demo?otp=one-time"
    monkeypatch.setattr(trading, "_get_demo_ws_url", fake_url)
    monkeypatch.setattr(trading.websockets, "connect", lambda *a, **k: FakeWS())
    result = asyncio.run(trading.monitor_demo_contract("VRTC12345", "token", "123456"))
    assert result["status"] == "SETTLED_CONFIRMED_BY_DERIV"
    assert result["profit"] == "-0.50"


def test_monitor_rejects_non_numeric_contract_id():
    with pytest.raises(trading.DemoTradingError):
        asyncio.run(trading.monitor_demo_contract("VRTC12345", "token", "abc"))


def test_proposal_rejects_invalid_broker_money_fields(monkeypatch):
    class FakeWS:
        async def __aenter__(self): return self
        async def __aexit__(self, *args): pass
        async def send(self, raw): pass
        async def recv(self):
            return json.dumps({'msg_type': 'proposal', 'req_id': 5201,
                'proposal': {'id': 'p1', 'payout': 'NaN', 'ask_price': '1.00', 'spot': '2.0'}})
    async def fake_url(account_id, token):
        return 'wss://api.derivws.com/trading/v1/options/ws/demo?otp=one-time'
    monkeypatch.setattr(trading, '_get_demo_ws_url', fake_url)
    monkeypatch.setattr(trading.websockets, 'connect', lambda *a, **k: FakeWS())
    with pytest.raises(trading.DemoTradingError, match='invalid monetary'):
        asyncio.run(trading.create_demo_proposal('VRTC12345', 'token', 'R_100', 'ODD', '1', 'USD'))
