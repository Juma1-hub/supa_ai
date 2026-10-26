# Supa AI project plan

## Product focus
- Deriv Volatility Indices supported by the official API.
- Digit-based strategies, especially ODD and EVEN.
- Configurable rolling digit-frequency windows and minimum sample size.
- Natural-language instructions converted into explicit, reviewable rules.
- Multiple independent strategies and strategy-specific market eligibility.
- Shared account-level risk checks before purchases.
- Open contracts monitored independently of active market assignment.
- Durable state, audit logs, and careful recovery after disconnects or uncertain purchases.

## Development phases
1. Dashboard and backend skeleton.
2. Strategy schema, review, and validation.
3. Simulated tick engine and automated tests.
4. Deriv demo authorization and market-data integration after checking official documentation.
5. Demo-only proposal/purchase/contract lifecycle integration.
6. Recovery, monitoring, security, and load testing.
7. Production review before any real-money capability.

## Non-negotiable rules
- Never silently change trader-defined thresholds, sequences, or market-switch rules.
- Ask for clarification when an instruction is ambiguous or contradictory.
- Ranking may choose only among markets that satisfy the strategy's own conditions.
- Market switches must not reset martingale progression or loss history.
- Existing contracts remain monitored after market invalidation.
- Treat timed-out purchases as unknown until reconciled; never blindly retry.
- Enforce shared risk limits before purchases.
- Historical digit frequencies are observations, not predictions.
- Martingale can increase exposure and losses; it does not improve underlying odds.
- Frequency window and minimum sample size remain configurable; no default is assumed yet.
