from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, model_validator
from .strategy_rules import digit_frequency, last_digit_from_quote

from .strategy_engine_api import (
    get_engine_status,
    validate_market_stats,
    MarketStatsRequest,
)

app = FastAPI(
    title="Supa AI API",
    description="Development API for a Deriv-focused digit strategy platform.",
    version="0.1.0",
)

# Development-only CORS. Restrict origins before production deployment.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)

class FrequencyRequest(BaseModel):
    digits: list[int] = Field(min_length=1, max_length=10000)

    @model_validator(mode="after")
    def digits_must_be_decimal_digits(self):
        if any(d < 0 or d > 9 for d in self.digits):
            raise ValueError("Every item must be a digit from 0 to 9.")
        return self

class QuoteDigitRequest(BaseModel):
    quote: str = Field(min_length=1, max_length=100)

@app.get("/")
def root():
    return {
        "name": "Supa AI API",
        "status": "development",
        "trading_enabled": False,
        "message": "Development-only API. No Deriv trades are placed.",
    }

@app.get("/health")
def health():
    return {"status": "ok", "environment": "development", "trading_enabled": False}

@app.post("/tools/digit-frequency")
def calculate_frequency(request: FrequencyRequest):
    return {
        "sample_size": len(request.digits),
        "frequencies": digit_frequency(request.digits),
        "note": "Historical frequencies are observations, not predictions.",
    }

@app.post("/tools/last-digit")
def extract_last_digit(request: QuoteDigitRequest):
    try:
        digit = last_digit_from_quote(request.quote)
    except ValueError as exc:
        return {"valid": False, "error": str(exc)}
    return {"valid": True, "quote": request.quote, "last_digit": digit}

@app.get("/strategy/status")
def strategy_status():
    return get_engine_status()


@app.post("/strategy/validate-stats")
def strategy_validate_stats(request: MarketStatsRequest):
    try:
        return validate_market_stats(request)
    except ValueError as exc:
        from fastapi import HTTPException

        raise HTTPException(
            status_code=422,
            detail=str(exc),
        ) from exc
