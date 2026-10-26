"use client";

import { useState } from "react";

const CLIENT_ID = process.env.NEXT_PUBLIC_DERIV_CLIENT_ID || "34MNgFwTRwqitQRXRYcFf";
const REDIRECT_URI = "https://frontend-snowy-zeta-68.vercel.app/auth/deriv/callback";
const SIGNUP_TRACKING_TOKEN = "UNHJX964Y5YX";
const AUTH_ENDPOINT = "https://auth.deriv.com/oauth2/auth";

function base64Url(bytes: Uint8Array) {
  let binary = "";
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function startDerivAuth(mode: "login" | "signup", setBusy: (v: boolean) => void, setError: (v: string) => void) {
  setBusy(true);
  setError("");
  try {
    if (!window.isSecureContext || !window.crypto?.subtle) throw new Error("Secure browser connection required. Please open Supa AI using its HTTPS address.");
    const random = crypto.getRandomValues(new Uint8Array(32));
    const verifier = base64Url(random);
    const challengeDigest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
    const challenge = base64Url(new Uint8Array(challengeDigest));
    const state = base64Url(crypto.getRandomValues(new Uint8Array(24)));
    sessionStorage.setItem("supa_deriv_pkce_verifier", verifier);
    sessionStorage.setItem("supa_deriv_oauth_state", state);
    sessionStorage.setItem("supa_deriv_auth_mode", mode);

    const url = new URL(AUTH_ENDPOINT);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", CLIENT_ID);
    url.searchParams.set("redirect_uri", REDIRECT_URI);
    url.searchParams.set("scope", "trade account_manage");
    url.searchParams.set("state", state);
    url.searchParams.set("code_challenge", challenge);
    url.searchParams.set("code_challenge_method", "S256");
    if (mode === "signup") {
      url.searchParams.set("prompt", "registration");
      url.searchParams.set("t", SIGNUP_TRACKING_TOKEN);
    }
    window.location.assign(url.toString());
  } catch (error) {
    setError(error instanceof Error ? error.message : "Could not start Deriv authentication.");
    setBusy(false);
  }
}

export default function AccessPage() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return <main className="auth-page">
    <div className="auth-glow auth-glow-one"/><div className="auth-glow auth-glow-two"/>
    <section className="auth-card">
      <div className="brand-lockup auth-brand"><div className="brand-mark">S<span>+</span></div><div><div className="brand-name">supa<span>ai</span></div><div className="brand-subtitle">TRADING INTELLIGENCE</div></div></div>
      <div className="auth-eyebrow">YOUR TRADING WORKSPACE</div>
      <h1>Trade with a plan.<br/><span>Stay in control.</span></h1>
      <p className="auth-copy">Sign in securely with Deriv to access your Supa AI workspace. Your Deriv password is never shared with Supa AI.</p>
      <div className="auth-benefits"><div><span>✓</span><div><b>Deriv authentication</b><small>Sign in on Deriv's official secure page</small></div></div><div><span>✓</span><div><b>Demo and Real account options</b><small>Choose an account after authorization</small></div></div><div><span>✓</span><div><b>Your rules, your decisions</b><small>Review strategy and risk settings before trading</small></div></div></div>
      <button className="auth-primary" disabled={busy} onClick={() => startDerivAuth("login", setBusy, setError)}>{busy ? "Redirecting to Deriv…" : "Log in with Deriv"}<span>↗</span></button>
      <div className="auth-divider"><span>NEW TO DERIV?</span></div>
      <button className="auth-secondary" disabled={busy} onClick={() => startDerivAuth("signup", setBusy, setError)}>Create account through Deriv <span>↗</span></button>
      <div className="auth-preview-divider"><span>OR EXPLORE FIRST</span></div>
      <a className="auth-preview-link" href="/preview">Preview the Supa AI workspace <span>→</span></a>
      {error && <div className="auth-error" role="alert">{error}</div>}
      <p className="auth-footnote">By continuing, you will leave Supa AI and use Deriv's authentication service. Trading involves risk; past digit frequencies do not predict future outcomes.</p>
    </section>
    <footer className="auth-footer"><span>SUPA AI <i>•</i> TRADING INTELLIGENCE</span><span>Secure access powered by Deriv OAuth</span></footer>
  </main>;
}
