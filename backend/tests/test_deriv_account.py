import json
import pytest
from fastapi.testclient import TestClient

from app import main
from app import deriv_account


def test_demo_balance_route_requires_bearer_token():
    client = TestClient(main.app)
    response = client.post('/account/demo/balance', json={'account_id': 'VRTC12345'})
    assert response.status_code == 401


def test_demo_balance_route_is_read_only_and_returns_mocked_result(monkeypatch):
    async def fake_fetch(account_id, token):
        assert account_id == 'VRTC12345'
        assert token == 'temporary-test-token'
        return {
            'account_id': account_id, 'account_type': 'demo',
            'balance': '125.50', 'currency': 'USD',
            'source': 'Deriv authenticated account balance',
            'trading_enabled': False,
        }
    monkeypatch.setattr(main, 'fetch_demo_balance', fake_fetch)
    client = TestClient(main.app)
    response = client.post(
        '/account/demo/balance',
        json={'account_id': 'VRTC12345'},
        headers={'X-Deriv-Access-Token': 'Bearer temporary-test-token'},
    )
    assert response.status_code == 200
    assert response.json()['balance'] == '125.50'
    assert response.json()['trading_enabled'] is False


def test_only_demo_websocket_url_is_accepted(monkeypatch):
    class FakeResponse:
        status_code = 200
        def json(self):
            return {'data': {'url': 'wss://api.derivws.com/trading/v1/options/ws/real?otp=secret'}}
    class FakeClient:
        def __init__(self, **kwargs): pass
        async def __aenter__(self): return self
        async def __aexit__(self, *args): pass
        async def post(self, *args, **kwargs): return FakeResponse()
    monkeypatch.setenv('DERIV_APP_ID', 'test-app-id')
    monkeypatch.setattr(deriv_account.httpx, 'AsyncClient', FakeClient)
    with pytest.raises(deriv_account.DerivAccountError, match='Demo WebSocket'):
        import asyncio
        asyncio.run(deriv_account.fetch_demo_balance('VRTC12345', 'test-token'))


def test_demo_verify_route_requires_deriv_token():
    client = TestClient(main.app)
    response = client.post('/account/demo/verify', json={'account_id': 'VRTC12345'})
    assert response.status_code == 401


def test_demo_verify_route_returns_read_only_identity(monkeypatch):
    async def fake_fetch(account_id, token):
        return {'account_id': account_id, 'account_type': 'demo', 'balance': '88.25',
                'currency': 'USD', 'trading_enabled': False}
    monkeypatch.setattr(main, 'fetch_demo_balance', fake_fetch)
    async def fake_link(user_id, account_id, currency):
        return {'deriv_account_id': account_id, 'account_type': 'demo', 'currency': currency,
                'verified_at': '2026-11-01T00:00:00+00:00'}
    monkeypatch.setattr(main, 'link_verified_demo_account', fake_link)
    client = TestClient(main.app)
    response = client.post('/account/demo/verify',
        headers={'X-Deriv-Access-Token': 'Bearer short-lived-token'},
        json={'account_id': 'VRTC12345'})
    assert response.status_code == 200
    body = response.json()
    assert body['verified'] is True
    assert body['account_type'] == 'demo'
    assert body['account_link_persisted'] is True
    assert body['trading_enabled'] is False


def test_demo_verify_route_rejects_mismatched_deriv_identity(monkeypatch):
    async def fake_fetch(account_id, token):
        return {'account_id': 'VRTC99999', 'account_type': 'demo', 'balance': '88.25',
                'currency': 'USD'}
    monkeypatch.setattr(main, 'fetch_demo_balance', fake_fetch)
    client = TestClient(main.app)
    response = client.post('/account/demo/verify',
        headers={'X-Deriv-Access-Token': 'Bearer short-lived-token'},
        json={'account_id': 'VRTC12345'})
    assert response.status_code == 403
