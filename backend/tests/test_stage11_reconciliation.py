from fastapi.testclient import TestClient
from app import main

client = TestClient(main.app)


def test_reconciliation_persists_only_deriv_confirmed_sold_contract(monkeypatch):
    async def rows(user_id, account_id, limit):
        assert user_id == "00000000-0000-0000-0000-000000000001"
        assert account_id == "VRTC123"
        return [{"contract_id": "123456", "deriv_account_id": "VRTC123",
                 "currency": "USD", "martingale_enabled": True}]

    async def monitor(account_id, token, contract_id, *, timeout_seconds):
        assert account_id == "VRTC123" and token == "deriv-demo-token"
        return {"account_type": "demo", "contract_id": contract_id,
                "status": "SETTLED_CONFIRMED_BY_DERIV", "is_sold": True,
                "profit": "-1.00", "currency": "USD"}

    calls = []
    async def apply(user_id, payload):
        calls.append((user_id, payload))
        return True

    monkeypatch.setattr(main, "list_reconcilable_open_contracts", rows)
    monkeypatch.setattr(main, "monitor_demo_contract", monitor)
    monkeypatch.setattr(main, "apply_persisted_settlement", apply)

    response = client.post("/account/demo/contracts/reconcile",
        headers={"X-Deriv-Access-Token": "Bearer deriv-demo-token"},
        json={"account_id": "VRTC123"})
    assert response.status_code == 200
    body = response.json()
    assert body["checked"] == 1
    assert body["results"][0]["persistence_applied"] is True
    assert len(calls) == 1
    assert calls[0][1]["contract_id"] == "123456"
    assert calls[0][1]["profit"] == "-1.00"


def test_reconciliation_does_not_apply_unsettled_contract(monkeypatch):
    async def rows(*args):
        return [{"contract_id": "123456", "deriv_account_id": "VRTC123",
                 "currency": "USD", "martingale_enabled": True}]
    async def monitor(*args, **kwargs):
        return {"account_type": "demo", "contract_id": "123456",
                "status": "STILL_OPEN_OR_NO_UPDATE", "is_sold": False}
    async def apply(*args):
        raise AssertionError("Unsettled contract must not be persisted")
    monkeypatch.setattr(main, "list_reconcilable_open_contracts", rows)
    monkeypatch.setattr(main, "monitor_demo_contract", monitor)
    monkeypatch.setattr(main, "apply_persisted_settlement", apply)
    response = client.post("/account/demo/contracts/reconcile",
        headers={"X-Deriv-Access-Token": "Bearer deriv-demo-token"},
        json={"account_id": "VRTC123"})
    assert response.status_code == 200
    assert response.json()["results"][0]["is_sold"] is False


def test_reconciliation_rejects_missing_deriv_token():
    response = client.post("/account/demo/contracts/reconcile",
        json={"account_id": "VRTC123"})
    assert response.status_code == 401
