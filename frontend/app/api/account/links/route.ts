import { NextRequest, NextResponse } from "next/server";
export const runtime = "nodejs";
export async function GET(request: NextRequest) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return NextResponse.json({ error: "A valid Supa AI session is required." }, { status: 401 });
  const base = (process.env.SUPA_AI_API_URL || process.env.NEXT_PUBLIC_SUPA_AI_API_URL || "").replace(/\/$/, "");
  if (!base) return NextResponse.json({ error: "Backend is not configured. Set SUPA_AI_API_URL in Vercel." }, { status: 503 });
  try {
    const upstream = await fetch(`${base}/account/links`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
    const data = await upstream.json().catch(() => ({}));
    return NextResponse.json(data, { status: upstream.status });
  } catch { return NextResponse.json({ error: "Unable to retrieve linked accounts." }, { status: 502 }); }
}
