import pytest
from app import supa_store


def test_checkpoint_rejects_extra_fields_before_network(monkeypatch):
    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "test-key")
    with pytest.raises(supa_store.SupaStoreError, match="fields are invalid"):
        import asyncio
        asyncio.run(supa_store.save_runtime_checkpoint("user-1", {
            "strategy_id": "strategy-1", "martingale_step": 0, "session_pnl": "0",
            "open_contract_ids": [], "deriv_token": "must-never-be-stored"
        }))


def test_checkpoint_rejects_negative_martingale_step(monkeypatch):
    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "test-key")
    with pytest.raises(supa_store.SupaStoreError, match="Martingale step"):
        import asyncio
        asyncio.run(supa_store.save_runtime_checkpoint("user-1", {
            "strategy_id": "strategy-1", "martingale_step": -1, "session_pnl": "0",
            "open_contract_ids": []
        }))


def test_open_contract_registration_requires_exact_fields():
    with pytest.raises(supa_store.SupaStoreError, match="fields are invalid"):
        import asyncio
        asyncio.run(supa_store.register_persisted_open_contract("user-1", {"contract_id": "c1"}))


def test_settlement_requires_exact_fields():
    with pytest.raises(supa_store.SupaStoreError, match="fields are invalid"):
        import asyncio
        asyncio.run(supa_store.apply_persisted_settlement("user-1", {"contract_id": "c1", "profit": "-1"}))
