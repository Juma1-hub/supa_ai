import pytest
from fastapi.testclient import TestClient
import app.deriv_account as deriv
import app.main as api
from app.main import app


class FakeResponse:
    def __init__(self, status, payload):
        self.status_code, self._payload = status, payload
    def json(self):
        return self._payload


class FakeClient:
    def __init__(self, response, captured):
        self.response, self.captured = response, captured
    async def __aenter__(self): return self
    async def __aexit__(self, *args): return False
    async def get(self, url, headers):
        self.captured.update(url=url, headers=headers)
        return self.response


@pytest.mark.asyncio
async def test_real_account_metadata_matches_authenticated_account(monkeypatch):
    captured = {}
    monkeypatch.setenv("DERIV_APP_ID", "test-app")
    monkeypatch.setattr(deriv.httpx, "AsyncClient", lambda **kw: FakeClient(
        FakeResponse(200, {"data": [
            {"account_id": "VRTC123", "account_type": "demo", "currency": "USD"},
            {"account_id": "CR123", "account_type": "real", "currency": "USD", "status": "active"},
        ]}), captured))
    result = await deriv.fetch_real_account_metadata("CR123", "oauth-secret")
    assert result["account_type"] == "real"
    assert result["currency"] == "USD"
    assert captured["url"].endswith("/trading/v1/options/accounts")
    assert captured["headers"] == {"Authorization": "Bearer oauth-secret", "Deriv-App-ID": "test-app"}


@pytest.mark.asyncio
async def test_real_verification_rejects_demo_account(monkeypatch):
    monkeypatch.setattr(deriv.httpx, "AsyncClient", lambda **kw: FakeClient(
        FakeResponse(200, {"data": [{"account_id": "VRTC123", "account_type": "demo", "currency": "USD"}]}), {}))
    with pytest.raises(deriv.DerivAccountError, match="not a Real"):
        await deriv.fetch_real_account_metadata("VRTC123", "token")


def test_real_verify_route_is_read_only_and_does_not_link(monkeypatch):
    async def verified(account, token):
        assert token == "deriv-token"
        return {"account_id": account, "account_type": "real", "currency": "USD", "status": "active"}
    linked = []
    async def save_link(user_id, account_id, account_type, currency):
        linked.append((user_id, account_id, account_type, currency))
        return {"deriv_account_id": account_id, "account_type": account_type,
                "currency": currency, "verified_at": "2026-11-01T00:00:00+00:00"}
    monkeypatch.setattr(api, "fetch_real_account_metadata", verified)
    monkeypatch.setattr(api, "link_verified_deriv_account", save_link)
    response = TestClient(app).post("/account/real/verify", json={"account_id": "CR123"},
        headers={"Authorization": "Bearer supa-session", "X-Deriv-Access-Token": "Bearer deriv-token"})
    assert response.status_code == 200
    body = response.json()
    assert body["verified"] is True
    assert body["account_type"] == "real"
    assert body["account_link_persisted"] is True
    assert body["trading_enabled"] is False
    assert linked == [("00000000-0000-0000-0000-000000000001", "CR123", "real", "USD")]
    assert "deriv-token" not in response.text


def test_real_verify_requires_deriv_token():
    response = TestClient(app).post("/account/real/verify", json={"account_id": "CR123"},
        headers={"Authorization": "Bearer supa-session"})
    assert response.status_code == 401


def test_real_verify_conflict_does_not_claim_account_for_second_user(monkeypatch):
    async def verified(account, token):
        return {"account_id": account, "account_type": "real", "currency": "USD", "status": "active"}
    async def conflict(*args):
        from app.supa_store import SupaStoreError
        raise SupaStoreError("Deriv account is already linked to another Supa AI user")
    monkeypatch.setattr(api, "fetch_real_account_metadata", verified)
    monkeypatch.setattr(api, "link_verified_deriv_account", conflict)
    response = TestClient(app).post("/account/real/verify", json={"account_id": "CR123"},
        headers={"Authorization": "Bearer supa-session", "X-Deriv-Access-Token": "Bearer deriv-token"})
    assert response.status_code == 409
