import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const token = request.cookies.get("supa_deriv_access_token")?.value;
  if (!token) return NextResponse.json({ error: "Please sign in with Deriv first." }, { status: 401 });
  try {
    const upstream = await fetch("https://api.derivws.com/trading/v1/options/accounts", {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }, cache: "no-store"
    });
    const data = await upstream.json() as { data?: Array<Record<string, unknown>>; accounts?: Array<Record<string, unknown>>; error?: { message?: string } | string };
    if (!upstream.ok) return NextResponse.json({ error: typeof data.error === "string" ? data.error : data.error?.message || "Could not retrieve your Deriv accounts." }, { status: upstream.status });
    const accounts = Array.isArray(data.data) ? data.data : Array.isArray(data.accounts) ? data.accounts : [];
    const safeAccounts = accounts.map((account) => ({
      accountId: account.account_id ?? account.id ?? account.loginid ?? "",
      accountType: account.account_type ?? account.type ?? account.landing_company_name ?? "",
      currency: account.currency ?? "",
      balance: account.balance ?? null,
      isVirtual: Boolean(account.is_virtual ?? account.is_demo ?? String(account.account_type ?? account.type ?? "").toLowerCase().includes("demo"))
    }));
    return NextResponse.json({ accounts: safeAccounts });
  } catch {
    return NextResponse.json({ error: "Unable to reach Deriv right now. Please try again." }, { status: 502 });
  }
}
