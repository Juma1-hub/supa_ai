from fastapi.testclient import TestClient
import app.main as api
from app.main import app


def _async(value):
    async def run():
        return value
    return run()


def test_verified_demo_endpoint_persists_metadata_not_token(monkeypatch):
    saved = []
    async def link(user_id, account_id, currency):
        saved.append((user_id, account_id, currency))
        return {"deriv_account_id": account_id, "account_type": "demo", "currency": currency,
                "verified_at": "2026-11-01T00:00:00+00:00"}
    monkeypatch.setattr(api, "fetch_demo_balance", lambda account, token: _async({
        "account_id": account, "account_type": "demo", "balance": "25.00", "currency": "USD"
    }))
    monkeypatch.setattr(api, "link_verified_demo_account", link)
    response = TestClient(app).post("/account/demo/verify", json={"account_id": "VRTC123"},
        headers={"Authorization": "Bearer supa-session", "X-Deriv-Access-Token": "Bearer deriv-secret-token"})
    assert response.status_code == 200
    body = response.json()
    assert body["account_link_persisted"] is True
    assert body["trading_enabled"] is False
    assert saved == [("00000000-0000-0000-0000-000000000001", "VRTC123", "USD")]
    assert "deriv-secret-token" not in str(saved)
    assert "access_token" not in str(body).lower()


def test_demo_account_links_require_supa_auth(monkeypatch):
    from app.main import require_supa_user
    app.dependency_overrides.pop(require_supa_user, None)
    response = TestClient(app).get("/account/demo/links")
    assert response.status_code == 401


def test_demo_account_links_are_scoped_to_authenticated_user(monkeypatch):
    seen = []
    async def listing(user_id):
        seen.append(user_id)
        return [{"deriv_account_id": "VRTC999", "account_type": "demo", "currency": "KES"}]
    monkeypatch.setattr(api, "list_linked_demo_accounts", listing)
    response = TestClient(app).get("/account/demo/links", headers={"Authorization": "Bearer supa-session"})
    assert response.status_code == 200
    assert seen == ["00000000-0000-0000-0000-000000000001"]
    assert response.json()["accounts"][0]["deriv_account_id"] == "VRTC999"
    assert response.json()["trading_enabled"] is False


def test_verify_rejects_real_account_without_linking(monkeypatch):
    monkeypatch.setattr(api, "fetch_demo_balance", lambda account, token: _async({
        "account_id": account, "account_type": "real", "balance": "25.00", "currency": "USD"
    }))
    linked = []
    monkeypatch.setattr(api, "link_verified_demo_account", lambda *a: _async(linked.append(a)))
    response = TestClient(app).post("/account/demo/verify", json={"account_id": "CR123"},
        headers={"Authorization": "Bearer supa-session", "X-Deriv-Access-Token": "Bearer deriv-token"})
    assert response.status_code == 403
    assert linked == []


def test_unified_account_list_returns_demo_and_real_for_current_user(monkeypatch):
    seen = []
    async def listing(user_id):
        seen.append(user_id)
        return [
            {"deriv_account_id": "VRTC123", "account_type": "demo", "currency": "USD"},
            {"deriv_account_id": "CR123", "account_type": "real", "currency": "KES"},
        ]
    monkeypatch.setattr(api, "list_linked_deriv_accounts", listing)
    response = TestClient(app).get("/account/links", headers={"Authorization": "Bearer supa-session"})
    assert response.status_code == 200
    assert seen == ["00000000-0000-0000-0000-000000000001"]
    assert {x["account_type"] for x in response.json()["accounts"]} == {"demo", "real"}
    assert response.json()["trading_enabled"] is False


def test_unified_account_list_requires_supa_auth():
    from app.main import require_supa_user
    app.dependency_overrides.pop(require_supa_user, None)
    response = TestClient(app).get("/account/links")
    assert response.status_code == 401
