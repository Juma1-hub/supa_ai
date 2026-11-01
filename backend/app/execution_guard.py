"""Stage 14: conservative execution state machine; intentionally no Deriv buy call."""
from __future__ import annotations
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from enum import Enum

class IntentStatus(str, Enum):
    PREPARED = "PREPARED_PURCHASE_DISABLED"
    READY = "READY_FOR_EXPLICIT_DEMO_AUTHORIZATION"
    UNKNOWN = "PURCHASE_UNKNOWN"
    CONFIRMED = "PURCHASE_CONFIRMED"
    ABORTED = "ABORTED"

@dataclass(frozen=True)
class FreshCheck:
    account_is_demo: bool
    account_id_matches: bool
    currency_matches: bool
    strategy_is_approved: bool
    persistence_available: bool
    risk_limits_clear: bool
    balance: str
    ask_price: str
    proposal_id: str
    actual_account_id: str
    actual_currency: str

    def validate(self, expected_account: str, expected_currency: str) -> None:
        flags = (self.account_is_demo, self.account_id_matches, self.currency_matches,
                 self.strategy_is_approved, self.persistence_available, self.risk_limits_clear)
        if not all(flags):
            raise ValueError("Fresh Demo execution checks did not all pass")
        if self.actual_account_id != expected_account or self.actual_currency != expected_currency:
            raise ValueError("Fresh account identity or currency does not match the purchase intent")
        if not self.proposal_id or len(self.proposal_id) > 200:
            raise ValueError("A fresh Deriv proposal is required")
        try:
            balance, ask = Decimal(self.balance), Decimal(self.ask_price)
        except (InvalidOperation, TypeError) as exc:
            raise ValueError("Fresh balance and ask price must be valid decimals") from exc
        if not balance.is_finite() or not ask.is_finite() or balance < 0 or ask <= 0 or ask > balance:
            raise ValueError("Fresh proposal price is invalid or exceeds available balance")


def next_status(current: IntentStatus, event: str, *, contract_id: str | None = None) -> IntentStatus:
    """Validate journal transitions. UNKNOWN is terminal for retries until reconciliation."""
    if event == "fresh_checks_passed" and current == IntentStatus.PREPARED:
        return IntentStatus.READY
    if event == "purchase_request_may_have_been_sent" and current == IntentStatus.READY:
        return IntentStatus.UNKNOWN
    if event == "deriv_purchase_confirmed" and current in {IntentStatus.READY, IntentStatus.UNKNOWN}:
        if not contract_id or not contract_id.isdigit() or len(contract_id) > 32:
            raise ValueError("A Deriv-confirmed numeric contract ID is required")
        return IntentStatus.CONFIRMED
    if event == "pre_purchase_check_failed" and current in {IntentStatus.PREPARED, IntentStatus.READY}:
        return IntentStatus.ABORTED
    raise ValueError("Unsafe or unsupported purchase-intent state transition")


def retry_allowed(status: IntentStatus) -> bool:
    # No automatic retry, especially after a timeout/unknown external outcome.
    return status == IntentStatus.PREPARED
