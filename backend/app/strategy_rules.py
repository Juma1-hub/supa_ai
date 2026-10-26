from collections import Counter
from decimal import Decimal, InvalidOperation

def digit_frequency(digits: list[int]) -> dict[str, float]:
    # Return the percentage frequency of each digit in the supplied sample.
    if not digits:
        raise ValueError("At least one digit is required.")
    if any(not isinstance(d, int) or d < 0 or d > 9 for d in digits):
        raise ValueError("Every item must be an integer digit from 0 to 9.")
    counts = Counter(digits)
    total = len(digits)
    return {str(d): round((counts.get(d, 0) / total) * 100, 4) for d in range(10)}

def last_digit_from_quote(quote: str) -> int:
    # Keep the quote as text so trailing zero precision is not lost.
    # Production extraction must use authoritative market precision metadata.
    value = quote.strip()
    if not value:
        raise ValueError("Quote cannot be empty.")
    try:
        Decimal(value)
    except InvalidOperation as exc:
        raise ValueError("Quote must be a valid decimal number represented as text.") from exc
    digits = [character for character in value if character.isdigit()]
    if not digits:
        raise ValueError("Quote must contain at least one digit.")
    return int(digits[-1])
