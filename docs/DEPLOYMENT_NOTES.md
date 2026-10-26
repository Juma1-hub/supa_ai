# Deployment notes

- Vercel Root Directory: `frontend`
- Build command: `npm run build` (default)
- Install command: default npm install
- Environment variables:
  - `NEXT_PUBLIC_SUPABASE_URL`
  - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
  - Optional `NEXT_PUBLIC_SUPA_AI_API_URL`

The Supabase check verifies that the project's Auth settings endpoint responds to the publishable key. It does not verify that database tables, policies, authentication, or application data operations are fully wired.

This project does not yet connect to Deriv or execute trades.
