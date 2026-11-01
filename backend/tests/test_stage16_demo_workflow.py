"""Stage 16 simulated API workflow. No real Deriv or Supabase calls are made."""
from types import SimpleNamespace
from uuid import uuid4

from fastapi.testclient import TestClient

from app.main import app
import app.main as api


def _runtime():
    engine = SimpleNamespace(
        current_stake=lambda: __import__('decimal').Decimal('0.50'),
        session_pnl=__import__('decimal').Decimal('0'),
        martingale_step=0,
        open_contract_ids=set(),
        config=SimpleNamespace(session_stop_loss=10, session_take_profit=10, max_open_trades=1),
    )
    return SimpleNamespace(strategy_id='strategy-1', persistence_ready=True, engine=engine)


def test_demo_read_only_workflow_preflight_intent_register_settle(monkeypatch):
    """Exercise API boundaries in order with simulated Deriv/Supabase adapters."""
    runtime = _runtime()
    monkeypatch.setattr(api.user_runtimes, 'get', lambda user_id: runtime)
    monkeypatch.setattr(api, 'fetch_demo_balance', lambda *a: _async({
        'account_type': 'demo', 'account_id': 'VRTC123', 'balance': '100.00', 'currency': 'USD'
    }))
    proposal = {
        'account_type': 'demo', 'symbol': 'R_100', 'contract': 'ODD', 'duration': 1,
        'duration_unit': 'ticks', 'stake': '0.50', 'currency': 'USD',
        'payout': '0.95', 'ask_price': '0.50', 'proposal_id': 'proposal-1',
    }
    monkeypatch.setattr(api, 'create_demo_proposal', lambda *a, **k: _async(proposal))

    intent_id = str(uuid4())
    saved_intent = {
        'intent_id': intent_id, 'strategy_id': 'strategy-1', 'deriv_account_id': 'VRTC123',
        'symbol': 'R_100', 'contract_type': 'ODD', 'stake': '0.50', 'currency': 'USD',
        'proposal_id': 'proposal-1', 'ask_price': '0.50', 'status': 'PREPARED_PURCHASE_DISABLED',
    }
    monkeypatch.setattr(api, 'create_demo_purchase_intent', lambda *a: _async(saved_intent))
    monkeypatch.setattr(api, 'get_demo_purchase_intent', lambda *a: _async(saved_intent))

    open_contract = {
        'account_type': 'demo', 'contract_id': '123456789', 'is_sold': False,
        'currency': 'USD', 'underlying': 'R_100', 'contract_type': 'DIGITODD',
        'buy_price': '0.50', 'status': 'OPEN_CONFIRMED_BY_DERIV',
    }
    monkeypatch.setattr(api, 'monitor_demo_contract', lambda *a, **k: _async(open_contract))
    registered = []
    async def fake_register(user_id, payload):
        registered.append((user_id, payload))
        return True
    monkeypatch.setattr(api, 'confirm_demo_purchase_and_register_contract', fake_register)

    monkeypatch.setattr(api, 'list_reconcilable_open_contracts', lambda *a: _async([{
        'contract_id': '123456789', 'deriv_account_id': 'VRTC123', 'martingale_enabled': True
    }]))
    sold_contract = {**open_contract, 'is_sold': True, 'profit': '-0.50',
                     'status': 'SETTLED_CONFIRMED_BY_DERIV'}
    async def monitor_sequence(*a, **k):
        return sold_contract
    monkeypatch.setattr(api, 'monitor_demo_contract', monitor_sequence)
    applied = []
    async def fake_apply(user_id, payload):
        applied.append((user_id, payload))
        return True
    monkeypatch.setattr(api, 'apply_persisted_settlement', fake_apply)

    client = TestClient(app)
    headers = {'Authorization': 'Bearer test-supa-token', 'X-Deriv-Access-Token': 'Bearer test-deriv-token'}
    common = {'account_id': 'VRTC123', 'symbol': 'R_100', 'contract': 'ODD',
              'stake': '0.50', 'currency': 'USD'}

    preflight = client.post('/account/demo/preflight', json=common, headers=headers)
    assert preflight.status_code == 200
    assert preflight.json()['purchase_enabled'] is False

    intent = client.post('/account/demo/purchase-intents',
                         json={**common, 'idempotency_key': str(uuid4())}, headers=headers)
    assert intent.status_code == 200
    assert intent.json()['deriv_buy_sent'] is False

    reconcile_intent = client.post('/account/demo/purchase-intents/reconcile',
        json={'account_id': 'VRTC123', 'intent_id': intent_id, 'contract_id': '123456789'}, headers=headers)
    assert reconcile_intent.status_code == 200
    assert reconcile_intent.json()['registration_applied'] is True
    assert len(registered) == 1

    reconcile_settlement = client.post('/account/demo/contracts/reconcile',
        json={'account_id': 'VRTC123'}, headers=headers)
    assert reconcile_settlement.status_code == 200
    assert reconcile_settlement.json()['results'][0]['persistence_applied'] is True
    assert len(applied) == 1

    # The whole tested route sequence remains read-only with respect to purchases.
    blocked = client.post('/account/demo/buy', headers=headers)
    assert blocked.status_code == 423


def _async(value):
    async def _return():
        return value
    return _return()
