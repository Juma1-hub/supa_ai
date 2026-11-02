# Supa AI Frontend — Stage 21

## Implemented
- Added Supabase email/password sign-up and sign-in using `@supabase/supabase-js` browser auth.
- Deriv OAuth can only be started after a Supabase session exists.
- Deriv callback checks that the Supabase session remains present before completing OAuth.
- Account selection verifies and links the selected Demo or Real Deriv account through the existing Stage 20 backend endpoints.
- The browser sends the Supabase access token as Bearer auth; the Deriv access token remains in the existing HTTP-only cookie and is forwarded server-to-server only.
- Workspace checks for a Supabase session and redirects to sign-in when missing.
- Selected account is persisted in localStorage to survive a browser return; live balance is refreshed from the Deriv account endpoint.
- Real-money trading remains disabled by the backend.
- Existing UI and strategy functionality are retained; starting stake remains USD 0.35.

## Required Vercel environment variables
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (or `NEXT_PUBLIC_SUPABASE_ANON_KEY`)
- `SUPA_AI_API_URL` (server-side URL of the deployed Stage 20 backend)
- `DERIV_CLIENT_ID`
- `DERIV_REDIRECT_URI=https://frontend-snowy-zeta-68.vercel.app/auth/deriv/callback`

`NEXT_PUBLIC_DERIV_CLIENT_ID` may also be set to the same Deriv App ID. Never put a Supabase service-role key or Deriv client secret in a `NEXT_PUBLIC_` variable.

## Supabase Auth setup
- Email provider must be enabled.
- If email confirmation is enabled, a new user must confirm the email before logging in.
- Add the deployed frontend origin to Supabase Auth URL configuration / redirect allow list as appropriate.

## Account-linking behaviour
The frontend calls the Stage 20 backend:
- `POST /account/demo/verify`
- `POST /account/real/verify`
- `GET /account/links`

The backend must have `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and service-role configuration required by its existing Stage 20 store. Apply the Stage 20 SQL migration before enabling account linking in production.

## Safety / verification
No trading execution was enabled or added in this stage. Before deployment, run `npm install` and `npm run build` from this directory, then test with a Supabase test user and Deriv Demo account. Stage 20 backend tests should be run separately from `backend/`.
