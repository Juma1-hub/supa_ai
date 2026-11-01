from fastapi.testclient import TestClient
from app import main
from app.user_runtime import UserRuntime
from supa_ai_engine.engine import StrategyConfig, StrategyEngine

USER_ID = "00000000-0000-0000-0000-000000000001"


def _request(client):
    return client.post(
        "/account/demo/preflight",
        headers={"X-Deriv-Access-Token": "Bearer demo-token"},
        json={"account_id": "VRTC12345", "symbol": "R_100", "contract": "ODD",
              "stake": "0.50", "currency": "USD"},
    )


def test_preflight_fails_closed_without_user_runtime(monkeypatch):
    async def balance(*args):
        return {"account_type": "demo", "balance": "100", "currency": "USD"}
    async def proposal(*args):
        raise AssertionError("proposal must not be requested without an approved runtime")
    monkeypatch.setattr(main, "fetch_demo_balance", balance)
    monkeypatch.setattr(main, "create_demo_proposal", proposal)
    monkeypatch.setattr(main.user_runtimes, "get", lambda user_id: None)
    response = _request(TestClient(main.app))
    assert response.status_code == 409
    assert "approved strategy runtime" in response.json()["detail"]


def test_preflight_fails_closed_when_user_runtime_persistence_is_unavailable(monkeypatch):
    async def balance(*args):
        return {"account_type": "demo", "balance": "100", "currency": "USD"}
    async def proposal(*args):
        raise AssertionError("proposal must not be requested while persistence is unavailable")
    runtime = UserRuntime(USER_ID, "strategy-1", "Test",
                          StrategyEngine(StrategyConfig()), persistence_ready=False)
    monkeypatch.setattr(main, "fetch_demo_balance", balance)
    monkeypatch.setattr(main, "create_demo_proposal", proposal)
    monkeypatch.setattr(main.user_runtimes, "get", lambda user_id: runtime if user_id == USER_ID else None)
    response = _request(TestClient(main.app))
    assert response.status_code == 503
    assert "durably available" in response.json()["detail"]
