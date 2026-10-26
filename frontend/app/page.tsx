"use client";

import { useState } from "react";

type Health = { status?: string; environment?: string; message?: string };

export default function Home() {
  const [health, setHealth] = useState<Health | null>(null);
  const [checking, setChecking] = useState(false);

  async function checkBackend() {
    setChecking(true);
    try {
      const apiBase = process.env.NEXT_PUBLIC_SUPA_AI_API_URL || "http://localhost:8000";
      const response = await fetch(`${apiBase}/health`);
      if (!response.ok) throw new Error(`Backend returned ${response.status}`);
      setHealth(await response.json());
    } catch {
      setHealth({
        status: "not-connected",
        message: "Backend not reachable yet. This is expected before deployment.",
      });
    } finally {
      setChecking(false);
    }
  }

  return (
    <main className="shell">
      <header className="topbar">
        <div className="brand-mark">S</div>
        <div><div className="brand-name">Supa AI</div><div className="brand-subtitle">DERIV DIGIT STRATEGY WORKSPACE</div></div>
        <span className="environment-pill">DEVELOPMENT</span>
      </header>

      <section className="hero">
        <p className="eyebrow">BUILT FOR DERIV VOLATILITY MARKETS</p>
        <h1>Trade your rules.<br /><span>Not guesswork.</span></h1>
        <p className="hero-copy">A workspace for reviewing digit strategies, monitoring eligible markets, and managing risk. Trading is disabled in this starter version.</p>
        <div className="hero-actions">
          <button className="primary-button" onClick={checkBackend} disabled={checking}>{checking ? "Checking..." : "Check backend connection"}</button>
          <span className="safe-label"><span className="status-dot" /> Real-money trading disabled</span>
        </div>
        {health && <div className={`connection-result ${health.status === "ok" ? "connected" : ""}`}><strong>Backend status: {health.status}</strong><span>{health.message || `Environment: ${health.environment || "unknown"}`}</span></div>}
      </section>

      <section className="grid">
        <article className="panel">
          <div className="panel-heading"><div><p className="eyebrow">STRATEGY WORKSPACE</p><h2>Rules before execution</h2></div><span className="tag">PLANNED</span></div>
          <p className="muted">Supa AI will convert trader instructions into explicit rules and show them for confirmation before a strategy can run.</p>
          <div className="rule-preview"><div className="rule-icon">01</div><div><strong>Digit frequency</strong><span>Measure digit counts over a configurable rolling window.</span></div></div>
          <div className="rule-preview"><div className="rule-icon">02</div><div><strong>Sequence conditions</strong><span>Evaluate the exact tick sequence and tick window specified.</span></div></div>
          <div className="rule-preview"><div className="rule-icon">03</div><div><strong>Risk validation</strong><span>Check configured limits before any future purchase request.</span></div></div>
        </article>
        <article className="panel">
          <p className="eyebrow">ACCOUNT</p><h2>Deriv connection</h2>
          <div className="big-status"><span className="status-dot muted-dot" /> Not connected</div>
          <p className="muted">Official account authorization will be added in a later, tested milestone.</p><span className="tag">DEMO FIRST</span>
        </article>
        <article className="panel">
          <p className="eyebrow">MARKET MONITOR</p><h2>Eligible markets</h2>
          <div className="empty-state"><span className="pulse-ring">↗</span><strong>Waiting for market data</strong><span>Live Deriv data has not been connected.</span></div>
        </article>
        <article className="panel">
          <p className="eyebrow">SAFETY BY DESIGN</p><h2>No hidden rule changes. No blind retries.</h2>
          <p className="muted">Market eligibility will be strategy-specific. Existing contracts will be monitored independently, and uncertain purchase outcomes must be reconciled before retrying.</p>
        </article>
      </section>
      <footer><span>SUPA AI · DEVELOPMENT BUILD</span><span>Digit frequencies describe past observations; they do not predict the next digit.</span></footer>
    </main>
  );
}
