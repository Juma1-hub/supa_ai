# Supa AI — Starter Project

Supa AI is being developed for Deriv Volatility Indices and digit-based strategies, especially ODD and EVEN.

## Development-only status
This starter does not connect to Deriv or place trades. We will first build and test the dashboard and strategy utilities. Deriv authorization and trading integration will be added only after verifying current official API requirements.

## Structure
- `frontend/`: Next.js dashboard
- `backend/`: FastAPI API and digit utilities
- `docs/`: project plan and deployment safety notes

## Security
Never commit passwords, OAuth credentials, API tokens, or database secrets. Keep real-money trading disabled during initial development.
