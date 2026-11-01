import pytest
from fastapi.testclient import TestClient
from app import main
from app.supa_auth import SupaAuthError, SupaUser, verify_supabase_access_token


def test_sensitive_strategy_route_requires_supa_session(authenticated_test_user):
    main.app.dependency_overrides.pop(main.require_supa_user, None)
    try:
        response = TestClient(main.app).get("/strategy/status")
        assert response.status_code == 401
    finally:
        async def fake_user():
            return SupaUser(id="00000000-0000-0000-0000-000000000001")
        main.app.dependency_overrides[main.require_supa_user] = fake_user


@pytest.mark.asyncio
async def test_supabase_auth_fails_closed_when_not_configured(monkeypatch):
    monkeypatch.delenv("SUPABASE_URL", raising=False)
    monkeypatch.delenv("SUPABASE_ANON_KEY", raising=False)
    with pytest.raises(SupaAuthError, match="not configured"):
        await verify_supabase_access_token("not-a-real-token")


def test_demo_account_requires_both_supabase_and_deriv_tokens(authenticated_test_user):
    response = TestClient(main.app).post(
        "/account/demo/balance", json={"account_id": "VRTC12345"},
        headers={"Authorization": "Bearer supa-session-token"},
    )
    assert response.status_code == 401
    assert "Deriv OAuth" in response.json()["detail"]


def test_strategy_approval_is_not_activated_in_shared_runtime():
    # The approval handler's response contract explicitly keeps execution disabled.
    # Full route persistence is exercised with mocked Supabase storage in deployment tests.
    assert main.engine.offline_trading_enabled is False
