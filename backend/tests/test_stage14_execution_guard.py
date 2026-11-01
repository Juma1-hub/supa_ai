import pytest
from app.execution_guard import FreshCheck, IntentStatus, next_status, retry_allowed


def _check(**changes):
    values = dict(account_is_demo=True, account_id_matches=True, currency_matches=True,
                  strategy_is_approved=True, persistence_available=True, risk_limits_clear=True,
                  balance="100.00", ask_price="0.50", proposal_id="fresh-proposal",
                  actual_account_id="VRTC123", actual_currency="USD")
    values.update(changes)
    return FreshCheck(**values)


def test_fresh_checks_accept_only_valid_demo_state():
    _check().validate("VRTC123", "USD")
    with pytest.raises(ValueError):
        _check(account_is_demo=False).validate("VRTC123", "USD")
    with pytest.raises(ValueError):
        _check(ask_price="101").validate("VRTC123", "USD")
    with pytest.raises(ValueError):
        _check(actual_account_id="OTHER").validate("VRTC123", "USD")


def test_intent_state_machine_requires_fresh_checks_before_ready():
    assert next_status(IntentStatus.PREPARED, "fresh_checks_passed") == IntentStatus.READY
    with pytest.raises(ValueError):
        next_status(IntentStatus.PREPARED, "purchase_request_may_have_been_sent")


def test_unknown_purchase_outcome_cannot_be_retried():
    unknown = next_status(IntentStatus.READY, "purchase_request_may_have_been_sent")
    assert unknown == IntentStatus.UNKNOWN
    assert not retry_allowed(unknown)
    with pytest.raises(ValueError):
        next_status(unknown, "purchase_request_may_have_been_sent")


def test_purchase_confirmation_requires_contract_id():
    with pytest.raises(ValueError):
        next_status(IntentStatus.UNKNOWN, "deriv_purchase_confirmed")
    assert next_status(IntentStatus.UNKNOWN, "deriv_purchase_confirmed", contract_id="123456") == IntentStatus.CONFIRMED


def test_failed_final_check_aborts_without_purchase():
    assert next_status(IntentStatus.READY, "pre_purchase_check_failed") == IntentStatus.ABORTED
    assert not retry_allowed(IntentStatus.ABORTED)
