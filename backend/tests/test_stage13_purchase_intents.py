from fastapi.testclient import TestClient
from app import main
from app.user_runtime import UserRuntime
from supa_ai_engine.engine import StrategyConfig, StrategyEngine

USER_ID = "00000000-0000-0000-0000-000000000001"


def _payload(key="11111111-1111-4111-8111-111111111111"):
    return {
        "account_id": "VRTC12345", "symbol": "R_100", "contract": "ODD",
        "stake": "0.35", "currency": "USD", "idempotency_key": key,
    }


def _setup(monkeypatch, *, persistence_ready=True):
    async def balance(*args):
        return {"account_type": "demo", "balance": "100.00", "currency": "USD"}

    async def proposal(*args, **kwargs):
        return {"proposal_id": "proposal-123", "ask_price": "0.50", "duration": 1,
                "duration_unit": "ticks", "payout": "0.95"}

    async def persist(user_id, payload):
        assert user_id == USER_ID
        assert payload["proposal_id"] == "proposal-123"
        return {"intent_id": "intent-123", "status": "PREPARED_PURCHASE_DISABLED",
                "idempotent_replay": False}

    runtime = UserRuntime(USER_ID, "strategy-123", "Test strategy",
                          StrategyEngine(StrategyConfig()), persistence_ready=persistence_ready)
    monkeypatch.setattr(main, "fetch_demo_balance", balance)
    monkeypatch.setattr(main, "create_demo_proposal", proposal)
    monkeypatch.setattr(main, "create_demo_purchase_intent", persist)
    monkeypatch.setattr(main.user_runtimes, "get", lambda user_id: runtime if user_id == USER_ID else None)
    return runtime


def test_purchase_intent_persists_but_never_buys(monkeypatch):
    _setup(monkeypatch)
    response = TestClient(main.app).post(
        "/account/demo/purchase-intents",
        headers={"X-Deriv-Access-Token": "Bearer demo-token"}, json=_payload(),
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["status"] == "PREPARED_PURCHASE_DISABLED"
    assert body["purchase_enabled"] is False
    assert body["deriv_buy_sent"] is False


def test_purchase_intent_requires_deriv_token(monkeypatch):
    _setup(monkeypatch)
    response = TestClient(main.app).post("/account/demo/purchase-intents", json=_payload())
    assert response.status_code == 401


def test_purchase_intent_fails_closed_without_runtime(monkeypatch):
    async def balance(*args):
        return {"account_type": "demo", "balance": "100", "currency": "USD"}
    async def no_proposal(*args):
        raise AssertionError("proposal must not be requested without runtime")
    monkeypatch.setattr(main, "fetch_demo_balance", balance)
    monkeypatch.setattr(main, "create_demo_proposal", no_proposal)
    monkeypatch.setattr(main.user_runtimes, "get", lambda user_id: None)
    response = TestClient(main.app).post(
        "/account/demo/purchase-intents",
        headers={"X-Deriv-Access-Token": "Bearer demo-token"}, json=_payload(),
    )
    assert response.status_code == 409


def test_purchase_intent_fails_closed_when_persistence_unavailable(monkeypatch):
    _setup(monkeypatch, persistence_ready=False)
    response = TestClient(main.app).post(
        "/account/demo/purchase-intents",
        headers={"X-Deriv-Access-Token": "Bearer demo-token"}, json=_payload(),
    )
    assert response.status_code == 503


def test_purchase_endpoint_remains_locked():
    response = TestClient(main.app).post("/account/demo/buy")
    assert response.status_code == 423
