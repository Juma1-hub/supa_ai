"use client";

import { useEffect, useState } from "react";

export default function DerivCallbackPage() {
  const [message, setMessage] = useState("Verifying your Deriv sign-in…");
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    async function complete() {
      try {
        const params = new URLSearchParams(window.location.search);
        const oauthError = params.get("error");
        if (oauthError) throw new Error(params.get("error_description") || "Deriv sign-in was cancelled or denied.");
        const code = params.get("code");
        const returnedState = params.get("state");
        const savedState = sessionStorage.getItem("supa_deriv_oauth_state");
        const verifier = sessionStorage.getItem("supa_deriv_pkce_verifier");
        if (!code || !returnedState || !savedState || returnedState !== savedState || !verifier) {
          throw new Error("We could not verify this sign-in attempt. Please return to Supa AI and try again.");
        }
        const response = await fetch("/api/auth/deriv/token", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code, codeVerifier: verifier, redirectUri: `${window.location.origin}/auth/deriv/callback` })
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "Deriv could not complete authorization.");
        sessionStorage.removeItem("supa_deriv_pkce_verifier");
        sessionStorage.removeItem("supa_deriv_oauth_state");
        if (!cancelled) {
          setMessage("Sign-in complete. Loading your available accounts…");
          window.location.replace("/account");
        }
      } catch (error) {
        if (!cancelled) { setFailed(true); setMessage(error instanceof Error ? error.message : "Sign-in could not be completed."); }
      }
    }
    void complete();
    return () => { cancelled = true; };
  }, []);
  return <main className="auth-page"><section className="auth-card callback-card"><div className="brand-lockup auth-brand"><div className="brand-mark">S<span>+</span></div><div><div className="brand-name">supa<span>ai</span></div><div className="brand-subtitle">TRADING INTELLIGENCE</div></div></div><div className={`callback-spinner ${failed ? "failed" : ""}`}>{failed ? "!" : "↻"}</div><h1>{failed ? "Sign-in needs attention" : "Connecting your account"}</h1><p className="auth-copy">{message}</p>{failed && <a className="auth-primary auth-link" href="/">Return to Supa AI</a>}</section></main>;
}
