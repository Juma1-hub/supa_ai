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
