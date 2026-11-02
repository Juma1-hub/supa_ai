import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const derivToken = request.cookies.get("supa_deriv_access_token")?.value;
  if (!derivToken) return NextResponse.json({ error: "Your Deriv session has expired. Please reconnect Deriv." }, { status: 401 });
  const supabaseToken = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!supabaseToken) return NextResponse.json({ error: "A valid Supa AI session is required." }, { status: 401 });
  const apiBase = (process.env.SUPA_AI_API_URL || process.env.NEXT_PUBLIC_SUPA_AI_API_URL || "").replace(/\/$/, "");
  if (!apiBase) return NextResponse.json({ error: "Backend is not configured. Set SUPA_AI_API_URL in Vercel." }, { status: 503 });
  try {
    const body = await request.json() as { accountId?: string; isVirtual?: boolean };
    if (!body.accountId || typeof body.accountId !== "string") return NextResponse.json({ error: "A valid Deriv account ID is required." }, { status: 400 });
    const endpoint = body.isVirtual ? "/account/demo/verify" : "/account/real/verify";
    const upstream = await fetch(`${apiBase}${endpoint}`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${supabaseToken}`, "X-Deriv-Access-Token": `Bearer ${derivToken}` }, body: JSON.stringify({ account_id: body.accountId }), cache: "no-store" });
    const payload = await upstream.json().catch(() => ({}));
    if (!upstream.ok) return NextResponse.json({ error: payload.detail || payload.error || "The backend could not verify and link this Deriv account." }, { status: upstream.status });
    return NextResponse.json(payload);
  } catch { return NextResponse.json({ error: "Unable to verify the Deriv account right now." }, { status: 502 }); }
}
