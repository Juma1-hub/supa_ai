# Deployment notes

This project is not production-ready.

Before public deployment:
1. Replace development CORS settings with exact trusted origins.
2. Add authentication and authorization to protected endpoints.
3. Add database migrations, row-level security policies, and backups.
4. Add secure secret management.
5. Verify current Deriv authorization/API documentation and permitted use.
6. Test strategy state machines, shared risk reservations, concurrent strategies, and recovery.
7. Keep purchases disabled until demo tests pass.
8. Add monitoring, alerting, and incident/recovery procedures.
