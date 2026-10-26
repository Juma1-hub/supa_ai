from app.strategy_rules import digit_frequency, last_digit_from_quote

def test_digit_frequency_counts_all_ten_digits():
    result = digit_frequency([1, 1, 2, 3])
    assert result["1"] == 50.0
    assert result["2"] == 25.0
    assert result["0"] == 0.0
    assert sum(result.values()) == 100.0

def test_last_digit_preserves_trailing_zero_precision():
    assert last_digit_from_quote("123.450") == 0
    assert last_digit_from_quote("123.45") == 5

def test_frequency_of_single_digit():
    result = digit_frequency([7])
    assert result["7"] == 100.0
