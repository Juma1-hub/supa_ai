"""Supabase Auth verification for Supa AI API requests.

The Supabase access token is verified by asking Supabase Auth for the user.
Deriv OAuth tokens are separate and must never be used as Supa AI identity.
"""
from __future__ import annotations
import os
from dataclasses import dataclass
from typing import Any
import httpx

class SupaAuthError(RuntimeError):
    pass

@dataclass(frozen=True)
class SupaUser:
    id: str
    email: str | None = None

async def verify_supabase_access_token(token: str) -> SupaUser:
    base = os.getenv("SUPABASE_URL", "").rstrip("/")
    anon_key = os.getenv("SUPABASE_ANON_KEY", "")
    if not base or not anon_key:
        raise SupaAuthError("Supabase authentication is not configured")
    if not token or len(token) > 16384:
        raise SupaAuthError("Invalid Supabase access token")
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(
                f"{base}/auth/v1/user",
                headers={"apikey": anon_key, "Authorization": f"Bearer {token}"},
            )
    except httpx.HTTPError as exc:
        raise SupaAuthError("Could not verify Supabase session") from exc
    if response.status_code != 200:
        raise SupaAuthError("Supabase session is invalid or expired")
    try:
        body: dict[str, Any] = response.json()
        user_id = body.get("id")
        if not isinstance(user_id, str) or not user_id:
            raise ValueError
        email = body.get("email")
        return SupaUser(id=user_id, email=email if isinstance(email, str) else None)
    except (ValueError, TypeError) as exc:
        raise SupaAuthError("Supabase returned an invalid user response") from exc
