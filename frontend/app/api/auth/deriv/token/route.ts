import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const clientId = process.env.DERIV_CLIENT_ID || process.env.NEXT_PUBLIC_DERIV_CLIENT_ID;
  const clientSecret = process.env.DERIV_CLIENT_SECRET;
  if (!clientId) return NextResponse.json({ error: "Deriv OAuth is not configured on the server yet. Add DERIV_CLIENT_ID in Vercel settings." }, { status: 503 });
  try {
    const body = await request.json() as { code?: string; codeVerifier?: string; redirectUri?: string };
    const expectedRedirect = process.env.DERIV_REDIRECT_URI || "https://frontend-snowy-zeta-68.vercel.app/auth/deriv/callback";
    if (!body.code || !body.codeVerifier || !body.redirectUri || body.redirectUri !== expectedRedirect) {
      return NextResponse.json({ error: "Invalid authorization callback details. Check the registered redirect URL." }, { status: 400 });
    }
    const form = new URLSearchParams({ grant_type: "authorization_code", client_id: clientId, code: body.code, code_verifier: body.codeVerifier, redirect_uri: expectedRedirect });
    if (clientSecret) form.set("client_secret", clientSecret);
    const upstream = await fetch("https://auth.deriv.com/oauth2/token", {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: form.toString(), cache: "no-store"
    });
    const payload = await upstream.json() as { access_token?: string; expires_in?: number; token_type?: string; error?: string; error_description?: string };
    if (!upstream.ok || !payload.access_token) {
      return NextResponse.json({ error: payload.error_description || payload.error || "Deriv rejected the token exchange. Check your OAuth application settings and credentials." }, { status: 502 });
    }
    const response = NextResponse.json({ authenticated: true, expiresIn: payload.expires_in || 3600 });
    response.cookies.set("supa_deriv_access_token", payload.access_token, {
      httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: Math.min(payload.expires_in || 3600, 3600)
    });
    return response;
  } catch {
    return NextResponse.json({ error: "Unable to complete Deriv authorization. Please try again." }, { status: 500 });
  }
}
