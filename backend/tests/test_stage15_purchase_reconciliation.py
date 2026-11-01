import pytest
from app.purchase_reconciliation import verify_contract_matches_intent

INTENT = {
    "contract_type": "ODD", "symbol": "R_100", "currency": "USD",
    "ask_price": "0.50", "stake": "0.50",
}
CONTRACT = {
    "contract_id": "123456789", "underlying": "R_100",
    "contract_type": "DIGITODD", "currency": "USD", "buy_price": "0.50",
}

def test_deriv_confirmed_contract_must_match_every_bound_intent_field():
    verify_contract_matches_intent(INTENT, CONTRACT)

@pytest.mark.parametrize("field,value", [
    ("underlying", "R_50"), ("contract_type", "DIGITEVEN"),
    ("currency", "EUR"), ("buy_price", "0.51"),
])
def test_contract_mismatch_is_rejected(field, value):
    candidate = {**CONTRACT, field: value}
    with pytest.raises(ValueError):
        verify_contract_matches_intent(INTENT, candidate)

def test_unknown_or_missing_deriv_fields_are_rejected():
    with pytest.raises(ValueError):
        verify_contract_matches_intent(INTENT, {**CONTRACT, "buy_price": None})
    with pytest.raises(ValueError):
        verify_contract_matches_intent({**INTENT, "contract_type": "CALL"}, CONTRACT)
