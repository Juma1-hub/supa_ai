"use client";

import { useEffect, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase";

const CLIENT_ID = process.env.NEXT_PUBLIC_DERIV_CLIENT_ID || "34MNgFwTRwqitQRXRYcFf";
const REDIRECT_URI = process.env.NEXT_PUBLIC_DERIV_REDIRECT_URI || "https://frontend-snowy-zeta-68.vercel.app/auth/deriv/callback";
const SIGNUP_TRACKING_TOKEN = "UNHJX964Y5YX";
const AUTH_ENDPOINT = "https://auth.deriv.com/oauth2/auth";

function base64Url(bytes: Uint8Array) { let binary = ""; bytes.forEach((byte) => { binary += String.fromCharCode(byte); }); return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); }

async function startDerivAuth(mode: "login" | "signup", setBusy: (v: boolean) => void, setError: (v: string) => void) {
  setBusy(true); setError("");
  try {
    const supabase = getSupabaseBrowserClient();
    const { data } = await supabase.auth.getSession();
    if (!data.session) throw new Error("First sign in to your Supa AI account, then connect Deriv.");
    if (!window.isSecureContext || !window.crypto?.subtle) throw new Error("Secure HTTPS browser connection required.");
    const verifier = base64Url(crypto.getRandomValues(new Uint8Array(32)));
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
    const challenge = base64Url(new Uint8Array(digest));
    const state = base64Url(crypto.getRandomValues(new Uint8Array(24)));
    sessionStorage.setItem("supa_deriv_pkce_verifier", verifier);
    sessionStorage.setItem("supa_deriv_oauth_state", state);
    sessionStorage.setItem("supa_deriv_auth_mode", mode);
    const url = new URL(AUTH_ENDPOINT);
    url.searchParams.set("response_type", "code"); url.searchParams.set("client_id", CLIENT_ID);
    url.searchParams.set("redirect_uri", REDIRECT_URI); url.searchParams.set("scope", "trade");
    url.searchParams.set("state", state); url.searchParams.set("code_challenge", challenge); url.searchParams.set("code_challenge_method", "S256");
    if (mode === "signup") { url.searchParams.set("prompt", "registration"); url.searchParams.set("t", SIGNUP_TRACKING_TOKEN); }
    window.location.assign(url.toString());
  } catch (error) { setError(error instanceof Error ? error.message : "Could not start Deriv authentication."); setBusy(false); }
}

export default function AccessPage() {
  const [email, setEmail] = useState(""); const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [notice, setNotice] = useState("");
  const [supaReady, setSupaReady] = useState(false);
  useEffect(() => { try { void getSupabaseBrowserClient().auth.getSession().then(({ data, error }) => { if (!error && data.session) setSupaReady(true); }); } catch { /* Missing public configuration is reported when the user signs in. */ } }, []);
  async function supaAuth(mode: "login" | "signup") {
    setBusy(true); setError(""); setNotice("");
    try {
      const supabase = getSupabaseBrowserClient();
      const result = mode === "signup" ? await supabase.auth.signUp({ email: email.trim(), password }) : await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (result.error) throw result.error;
      if (mode === "signup" && !result.data.session) { setNotice("Check your email and confirm your Supa AI account. Then return here and log in."); return; }
      setSupaReady(true); setNotice("Supa AI account authenticated. Now connect your Deriv account below.");
    } catch (err) { setError(err instanceof Error ? err.message : "Supa AI authentication failed."); }
    finally { setBusy(false); }
  }
  return <main className="auth-page"><div className="auth-glow auth-glow-one"/><div className="auth-glow auth-glow-two"/><section className="auth-card">
    <div className="brand-lockup auth-brand"><div className="brand-mark">S<span>+</span></div><div><div className="brand-name">supa<span>ai</span></div><div className="brand-subtitle">TRADING INTELLIGENCE</div></div></div>
    <div className="auth-eyebrow">YOUR TRADING WORKSPACE</div><h1>Trade with a plan.<br/><span>Stay in control.</span></h1>
    <p className="auth-copy">First authenticate your Supa AI profile. Then securely connect your Deriv account.</p>
    <label className="auth-field-label" htmlFor="supa-email">EMAIL ADDRESS</label><input id="supa-email" className="auth-input" type="email" autoComplete="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="you@example.com"/>
    <label className="auth-field-label" htmlFor="supa-password">PASSWORD</label><input id="supa-password" className="auth-input" type="password" autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="Your Supa AI password"/>
    <button className="auth-primary" disabled={busy || !email.trim() || password.length < 6} onClick={()=>void supaAuth("login")}>{busy ? "Please wait…" : "Log in to Supa AI"}</button>
    <button className="auth-secondary" disabled={busy || !email.trim() || password.length < 6} onClick={()=>void supaAuth("signup")}>Create Supa AI account</button>
    {supaReady && <><div className="auth-divider"><span>SUPA AI AUTHENTICATED</span></div><button className="auth-primary" disabled={busy} onClick={()=>void startDerivAuth("login",setBusy,setError)}>Connect / Log in with Deriv <span>↗</span></button><button className="auth-secondary" disabled={busy} onClick={()=>void startDerivAuth("signup",setBusy,setError)}>Create Deriv account <span>↗</span></button></>}
    <div className="auth-preview-divider"><span>OR EXPLORE FIRST</span></div><a className="auth-preview-link" href="/preview">Preview the Supa AI workspace <span>→</span></a>
    {notice && <div className="account-state" role="status">{notice}</div>}{error && <div className="auth-error" role="alert">{error}</div>}
    <p className="auth-footnote">Your Supa AI password is handled by Supabase. Your Deriv password is entered only on Deriv. Trading involves risk; historical digit frequencies do not predict future outcomes.</p>
  </section><footer className="auth-footer"><span>SUPA AI <i>•</i> TRADING INTELLIGENCE</span><span>Secure access powered by Supabase and Deriv</span></footer></main>;
}
