# Supa AI — Dashboard + Strategy Builder UI

This project contains a dashboard concept and a combined natural-language/manual Strategy Builder.

## What is included
- Responsive dark trading dashboard UI.
- Quick strategy entry on the dashboard.
- Dedicated Strategy Builder page with AI-instructions and manual modes.
- Rule review modal before saving.
- Local-browser strategy draft persistence.
- Supabase endpoint reachability check.
- Backend health-check button.

## Important implementation status
This is a **front-end prototype**, not a complete automated trading platform.
- The natural-language analyzer is a simple local heuristic, not a live AI model.
- Strategies are stored in browser localStorage; Supabase database writes/authentication are not yet implemented.
- The market frequency panel uses illustrative sample digits, not live Deriv ticks.
- Deriv OAuth/authorization, live market streams, server-side rule validation, risk enforcement, contract purchasing/settlement, durable state, and trade reconciliation are not implemented.
- Live and real-money execution are not enabled by this UI.

## Environment variables
Set these in Vercel for the `frontend` project:
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- Optional: `NEXT_PUBLIC_SUPA_AI_API_URL`

Never place a Supabase service-role/secret key in a `NEXT_PUBLIC_` variable or frontend file. Never ask users for Deriv passwords.

## Deploy
The Vercel Root Directory should remain `frontend`. Commit the project files to your existing GitHub repository and let Vercel deploy.


## Deriv OAuth setup (required before sign-in can complete)

The frontend now starts Deriv OAuth 2.0 Authorization Code with PKCE. Sign Up adds `prompt=registration` and your referral tracking parameter `t=UNHJX964Y5YX`. The callback exchanges the code server-side and stores the access token in an HTTP-only cookie; the token is not returned to browser JavaScript.

1. In Deriv's developer dashboard, confirm the application is an **OAuth 2.0** application.
2. Register this exact redirect URL (no trailing slash): `https://frontend-snowy-zeta-68.vercel.app/auth/deriv/callback`.
3. In Vercel → Supa AI project → Settings → Environment Variables, add `NEXT_PUBLIC_DERIV_CLIENT_ID` and `DERIV_CLIENT_ID`, both set to your Deriv App ID. Add `DERIV_REDIRECT_URI` with the exact URL above. Add `DERIV_CLIENT_SECRET` only if Deriv's app settings/documentation require it; keep it server-only and never prefix it with `NEXT_PUBLIC_`.
4. Redeploy the project after adding environment variables.
5. Test Sign Up and Log In using a safe test flow first. Account selection calls Deriv's authorized accounts endpoint. No trading orders are placed by this login integration.

### Important current limitations

- Do not enable real-money automated trading yet. This update implements the sign-in path and account-choice screen, not the trading engine, persistent risk enforcement, contract reconciliation, or live order execution.
- Access tokens currently live in a short-lived HTTP-only cookie (up to one hour). Refresh-token renewal and a durable server-side session store are not implemented yet. Users may need to sign in again after expiry.
- Verify the actual OAuth scopes and account response shape against the Deriv application and current API docs during deployment testing.


## Glassy integrated workspace

This package preserves the Deriv access flow and the full workspace navigation, including:
- Dashboard with a quick strategy-condition entry panel
- Strategy Builder with AI-instruction and manual-condition modes
- Rule review before saving
- Market Monitor, Active Trades, Trade History, Risk Controls, and Settings navigation
- Deriv OAuth callback and Demo/Real account selection
- Glassmorphism visual styling across access, account selection, and workspace screens

Strategy drafts in this starter are stored in browser local storage. The digit chart is illustrative until a live market-data service is connected. The current UI does not place real-money trades; do not enable real execution until server-side strategy validation, risk enforcement, trade reconciliation, and settlement handling have been implemented and tested.
