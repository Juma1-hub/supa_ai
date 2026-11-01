"""Read-only matching of a Deriv contract to a durable purchase intent."""
from decimal import Decimal, InvalidOperation

def verify_contract_matches_intent(intent: dict, contract: dict) -> None:
    if not isinstance(intent, dict) or not isinstance(contract, dict):
        raise ValueError("Intent and Deriv contract details are required")
    expected_type = "DIGITODD" if intent.get("contract_type") == "ODD" else "DIGITEVEN" if intent.get("contract_type") == "EVEN" else None
    if not expected_type:
        raise ValueError("Unsupported intent contract type")
    if str(contract.get("contract_id", "")) != str(contract.get("requested_contract_id", contract.get("contract_id", ""))):
        raise ValueError("Deriv contract ID does not match request")
    if contract.get("underlying") != intent.get("symbol"):
        raise ValueError("Deriv contract market does not match purchase intent")
    if contract.get("contract_type") != expected_type:
        raise ValueError("Deriv contract type does not match purchase intent")
    if str(contract.get("currency", "")) != str(intent.get("currency", "")):
        raise ValueError("Deriv contract currency does not match purchase intent")
    try:
        buy_price = Decimal(str(contract.get("buy_price")))
        ask_price = Decimal(str(intent.get("ask_price")))
        stake = Decimal(str(intent.get("stake")))
    except (InvalidOperation, TypeError) as exc:
        raise ValueError("Deriv contract price details are invalid") from exc
    if not all(x.is_finite() for x in (buy_price, ask_price, stake)) or buy_price <= 0 or stake <= 0:
        raise ValueError("Deriv contract price details are invalid")
    # Buy price must equal the proposal's bound ask price to the currency's supplied precision.
    if buy_price != ask_price:
        raise ValueError("Deriv contract buy price does not match the bound proposal")
