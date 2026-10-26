# Supa AI Project Plan

## Frontend prototype in this release
- Dashboard with a compact strategy-entry panel.
- Full Strategy Builder with natural-language and manual modes.
- Rule-review modal and explicit user confirmation.
- Strategy statuses and browser-local draft persistence.
- Supabase endpoint reachability and optional backend health checks.
- Non-live demo frequency visualization.

## Not yet implemented
1. Official Deriv OAuth / authorization flow.
2. Real-time Deriv tick subscriptions and quote-precision metadata.
3. Server-side interpretation of natural-language instructions into a validated structured rule schema.
4. Persistent Supabase authentication, per-user ownership, database writes, and audit logging.
5. Dedicated persistent trading workers and durable state.
6. Server-side risk limits, session P&L, martingale progression, and strategy eligibility enforcement.
7. Contract purchase, settlement, open-contract reconciliation, and duplicate-order prevention.
8. Comprehensive tests and demo-account validation.

## Safety requirements
- Never collect Deriv account passwords.
- Show parsed rules for explicit review and confirmation.
- Do not silently alter user thresholds or sequence requirements.
- Treat past digit frequencies as observations, not reliable predictions.
- Keep real-money execution disabled until the complete system has been tested and the user explicitly authorizes it.
