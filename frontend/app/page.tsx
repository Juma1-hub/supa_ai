"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

type Strategy = {
  id: string;
  name: string;
  market: string;
  contract: "ODD" | "EVEN";
  instructions: string;
  frequencyWindow: number;
  threshold: number;
  qualifyingDigits: number;
  sequenceLength: number;
  sequenceWindow: number;
  stake: number;
  martingaleMultiplier: number;
  maxMartingaleSteps: number;
  status: "Draft" | "Awaiting review" | "Monitoring" | "Paused";
  createdAt: string;
};

const initialStrategy: Strategy = {
  id: "draft-1",
  name: "My ODD Strategy",
  market: "Volatility 100 Index",
  contract: "ODD",
  instructions: "Monitor Volatility 100 Index. Wait until all even digits have frequencies below 10%, and at least three odd digits have frequencies of 10.5% or higher. Identify the least-frequent even digit. Wait for it to appear, then watch the next five ticks. If two consecutive odd digits appear, enter an ODD trade.",
  frequencyWindow: 100,
  threshold: 10,
  qualifyingDigits: 3,
  sequenceLength: 2,
  sequenceWindow: 5,
  stake: 1,
  martingaleMultiplier: 2,
  maxMartingaleSteps: 3,
  status: "Draft",
  createdAt: new Date().toISOString()
};

const navItems = [
  { id: "dashboard", label: "Dashboard", icon: "▦" },
  { id: "builder", label: "Strategy Builder", icon: "⌘" },
  { id: "markets", label: "Market Monitor", icon: "⌁" },
  { id: "trades", label: "Active Trades", icon: "↗" },
  { id: "history", label: "Trade History", icon: "◷" },
  { id: "risk", label: "Risk Controls", icon: "◇" },
  { id: "settings", label: "Settings", icon: "⚙" }
];

function readSavedStrategies(): Strategy[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem("supa-ai-strategies");
    return raw ? JSON.parse(raw) as Strategy[] : [];
  } catch {
    return [];
  }
}

export default function Home() {
  const [page, setPage] = useState("dashboard");
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [draft, setDraft] = useState<Strategy>(initialStrategy);
  const [mode, setMode] = useState<"ai" | "manual">("ai");
  const [reviewOpen, setReviewOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const [supabaseStatus, setSupabaseStatus] = useState<"checking" | "connected" | "missing" | "error">("checking");
  const [backendStatus, setBackendStatus] = useState<"unknown" | "connected" | "offline">("unknown");
  const [lastDigits] = useState([7, 3, 9, 1, 4, 7, 5, 3, 8, 1, 9, 5, 3, 7, 1, 5, 9, 3, 4, 7]);
  const [frequencyWindow, setFrequencyWindow] = useState(100);

  useEffect(() => {
    setStrategies(readSavedStrategies());
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    if (!url || !key) {
      setSupabaseStatus("missing");
      return;
    }
    fetch(`${url.replace(/\/$/, "")}/auth/v1/settings`, {
      headers: { apikey: key }
    }).then((res) => setSupabaseStatus(res.ok ? "connected" : "error"))
      .catch(() => setSupabaseStatus("error"));
  }, []);

  const frequencies = useMemo(() => {
    const counts = Array(10).fill(0) as number[];
    lastDigits.forEach((d) => counts[d]++);
    return counts.map((count, digit) => ({ digit, count, percent: (count / lastDigits.length) * 100 }))
      .sort((a, b) => a.digit - b.digit);
  }, [lastDigits]);

  function updateDraft<K extends keyof Strategy>(key: K, value: Strategy[K]) {
    setDraft((old) => ({ ...old, [key]: value }));
  }

  function analyzeInstructions() {
    const text = draft.instructions.toLowerCase();
    const updated = { ...draft };
    if (text.includes("even trade") || text.includes("enter an even") || text.includes("trade even")) updated.contract = "EVEN";
    if (text.includes("odd trade") || text.includes("enter an odd") || text.includes("trade odd")) updated.contract = "ODD";
    const thresholdMatch = text.match(/below\s+(\d+(?:\.\d+)?)\s*%/);
    if (thresholdMatch) updated.threshold = Number(thresholdMatch[1]);
    const qualifyMatch = text.match(/at least\s+(\d+)\s+(?:odd|even)?\s*digits?/);
    if (qualifyMatch) updated.qualifyingDigits = Number(qualifyMatch[1]);
    const tickMatch = text.match(/(?:next|within)\s+(\d+)\s+ticks?/);
    if (tickMatch) updated.sequenceWindow = Number(tickMatch[1]);
    setDraft({ ...updated, status: "Awaiting review" });
    setReviewOpen(true);
    setNotice("A preliminary rule draft was created. Check every field; this local demo does not use a live AI model.");
  }

  function saveStrategy(activate = false) {
    const saved: Strategy = {
      ...draft,
      id: draft.id.startsWith("draft") ? `strategy-${Date.now()}` : draft.id,
      status: activate ? "Monitoring" : "Draft",
      createdAt: draft.createdAt || new Date().toISOString()
    };
    const next = [saved, ...strategies.filter((s) => s.id !== saved.id)];
    setStrategies(next);
    window.localStorage.setItem("supa-ai-strategies", JSON.stringify(next));
    setDraft(saved);
    setReviewOpen(false);
    setNotice(activate
      ? "Strategy marked as Monitoring in the interface. Live trading is not connected or enabled."
      : "Strategy saved in this browser. Supabase database persistence is not yet implemented.");
    setPage("dashboard");
  }

  function editStrategy(strategy: Strategy) {
    setDraft(strategy);
    setMode("manual");
    setPage("builder");
    setReviewOpen(false);
  }

  function togglePause(strategy: Strategy) {
    const next = strategies.map((s) => s.id === strategy.id
      ? { ...s, status: s.status === "Paused" ? "Monitoring" as const : "Paused" as const }
      : s);
    setStrategies(next);
    window.localStorage.setItem("supa-ai-strategies", JSON.stringify(next));
    setNotice("Strategy status updated in this browser only; no trading worker is attached yet.");
  }

  async function checkBackend() {
    const base = process.env.NEXT_PUBLIC_SUPA_AI_API_URL;
    if (!base) {
      setBackendStatus("offline");
      setNotice("Backend URL is not configured. The trading engine is not connected.");
      return;
    }
    try {
      const res = await fetch(`${base.replace(/\/$/, "")}/health`);
      setBackendStatus(res.ok ? "connected" : "offline");
      setNotice(res.ok ? "Backend health check succeeded." : "Backend health check failed.");
    } catch {
      setBackendStatus("offline");
      setNotice("Could not reach the backend. Check its deployment and URL.");
    }
  }

  const pageTitle = navItems.find((n) => n.id === page)?.label || "Dashboard";

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand-lockup">
          <div className="brand-mark">S<span>+</span></div>
          <div><div className="brand-name">supa<span>ai</span></div><div className="brand-subtitle">TRADING INTELLIGENCE</div></div>
        </div>
        <div className="workspace-label">WORKSPACE</div>
        <nav className="side-nav" aria-label="Main navigation">
          {navItems.map((item) => (
            <button key={item.id} className={`nav-item ${page === item.id ? "active" : ""}`} onClick={() => setPage(item.id)}>
              <span className="nav-icon">{item.icon}</span><span>{item.label}</span>
              {item.id === "builder" && <span className="nav-new">NEW</span>}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="connection-mini"><span className={`status-dot ${supabaseStatus === "connected" ? "green" : "amber"}`} /><div><b>Supabase</b><small>{supabaseStatus === "connected" ? "Endpoint reachable" : supabaseStatus === "missing" ? "Not configured" : supabaseStatus === "error" ? "Connection error" : "Checking…"}</small></div></div>
          <div className="connection-mini"><span className="status-dot amber" /><div><b>Deriv account</b><small>Not connected</small></div></div>
          <div className="profile-row"><div className="avatar">SA</div><div><b>Supa AI Workspace</b><small>Demo environment</small></div><span className="more-dots">•••</span></div>
        </div>
      </aside>

      <section className="main-area">
        <header className="topbar">
          <div className="breadcrumbs"><span>Workspace</span><span className="crumb-slash">/</span><b>{pageTitle}</b></div>
          <div className="top-actions"><span className="environment-pill"><span className="status-dot amber" /> DEMO MODE</span><button className="icon-button" aria-label="Notifications">♧</button><div className="avatar small">SA</div></div>
        </header>

        <div className="page-content">
          {notice && <div className="notice-bar"><span>ⓘ</span><span>{notice}</span><button onClick={() => setNotice("")} aria-label="Dismiss notice">×</button></div>}

          {page === "dashboard" && <>
            <div className="page-heading-row">
              <div><div className="eyebrow">MONDAY, OCTOBER 26, 2026</div><h1>Welcome to your trading desk.</h1><p className="subtitle">Build your strategy, monitor market conditions, and stay in control.</p></div>
              <button className="primary-button" onClick={() => { setPage("builder"); setReviewOpen(false); }}>＋ Create strategy</button>
            </div>
            <div className="status-banner"><div className="status-banner-icon">◈</div><div><b>Your trading workspace is in setup mode</b><p>Connect and test each component before enabling any real-money activity.</p></div><span className="banner-badge">SETUP IN PROGRESS</span></div>
            <section className="quick-builder panel">
              <div className="section-heading"><div><div className="eyebrow">STRATEGY STUDIO</div><h2>What should Supa AI look for?</h2><p>Describe your trading conditions or configure them manually.</p></div><span className="sparkle">✳</span></div>
              <div className="mode-switch"><button className={mode === "ai" ? "selected" : ""} onClick={() => setMode("ai")}>✧ AI instructions</button><button className={mode === "manual" ? "selected" : ""} onClick={() => setMode("manual")}>☷ Manual conditions</button></div>
              {mode === "ai" ? <><label className="field-label" htmlFor="quick-instructions">YOUR STRATEGY IN PLAIN LANGUAGE</label><textarea id="quick-instructions" className="instruction-input" value={draft.instructions} onChange={(e) => updateDraft("instructions", e.target.value)} placeholder="Example: Monitor a market, check digit frequencies, then wait for my exact trigger…"/><div className="input-footer"><span>✦ Your rules will be shown for review before saving.</span><button className="text-button" onClick={() => setPage("builder")}>Open full builder ↗</button></div><div className="quick-actions"><button className="secondary-button" onClick={() => { setPage("builder"); setMode("ai"); }}>Edit in Strategy Builder</button><button className="primary-button" onClick={analyzeInstructions}>Analyze instructions <span>→</span></button></div></> : <><div className="form-grid compact-grid"><label>Strategy name<input value={draft.name} onChange={(e) => updateDraft("name", e.target.value)} /></label><label>Market<select value={draft.market} onChange={(e) => updateDraft("market", e.target.value)}><option>Volatility 100 Index</option><option>Volatility 50 Index</option><option>Volatility 25 Index</option><option>Volatility 75 Index</option><option>Volatility 10 Index</option><option>Choose after connecting</option></select></label><label>Contract type<select value={draft.contract} onChange={(e) => updateDraft("contract", e.target.value as Strategy["contract"])}><option>ODD</option><option>EVEN</option></select></label><label>Frequency window (ticks)<input type="number" min="10" value={draft.frequencyWindow} onChange={(e) => updateDraft("frequencyWindow", Number(e.target.value))}/></label></div><div className="quick-actions"><button className="secondary-button" onClick={() => setPage("builder")}>More conditions</button><button className="primary-button" onClick={() => { setReviewOpen(true); setDraft({...draft, status:"Awaiting review"}); }}>Review conditions →</button></div></>}
            </section>
            <div className="metrics-grid">
              <Metric label="ACTIVE STRATEGIES" value={String(strategies.filter(s => s.status === "Monitoring").length).padStart(2,"0")} foot={`${strategies.length} saved in this browser`} icon="⌘"/>
              <Metric label="OPEN CONTRACTS" value="00" foot="Deriv connection required" icon="↗"/>
              <Metric label="SESSION P&L" value="$0.00" foot="No live trading data" icon="$"/>
              <Metric label="RISK STATUS" value="Protected" foot="Real-money trading disabled" icon="◇" positive/>
            </div>
            <div className="lower-grid">
              <section className="panel">
                <div className="panel-heading"><div><h2>Your strategies</h2><p>Review and manage your saved configurations.</p></div><button className="text-button" onClick={() => setPage("builder")}>＋ New strategy</button></div>
                {strategies.length === 0 ? <div className="empty-state"><div className="empty-icon">⌘</div><b>No saved strategies yet</b><p>Create a strategy above. It will be saved locally in this browser for now.</p><button className="secondary-button" onClick={() => setPage("builder")}>Build your first strategy</button></div> : <div className="strategy-list">{strategies.map(s => <div className="strategy-row" key={s.id}><div className="strategy-symbol">{s.contract === "ODD" ? "◐" : "◑"}</div><div className="strategy-info"><b>{s.name}</b><small>{s.market} · {s.contract}</small></div><span className={`strategy-status ${s.status.toLowerCase().replace(" ","-")}`}>{s.status}</span><button className="row-action" onClick={() => editStrategy(s)}>Edit</button><button className="row-action" onClick={() => togglePause(s)}>{s.status === "Paused" ? "Resume" : "Pause"}</button></div>)}</div>}
              </section>
              <section className="panel market-card">
                <div className="panel-heading"><div><h2>Digit frequency snapshot</h2><p>Illustrative sample · not live ticks</p></div><span className="live-tag"><span className="status-dot amber"/> DEMO</span></div>
                <div className="frequency-bars">{frequencies.map(f => <div className="frequency-item" key={f.digit}><div className="frequency-value">{f.percent.toFixed(0)}%</div><div className="frequency-track"><div className={`frequency-fill ${f.digit % 2 ? "odd-fill" : ""}`} style={{height:`${Math.max(5,f.percent*2.5)}%`}}/></div><div className="frequency-digit">{f.digit}</div></div>)}</div>
                <div className="chart-footnote"><span><i className="legend-dot" /> Even digits</span><span><i className="legend-dot odd" /> Odd digits</span><button className="text-button" onClick={() => setPage("markets")}>Market monitor ↗</button></div>
              </section>
            </div>
          </>}

          {page === "builder" && <section className="builder-page">
            <div className="page-heading-row"><div><div className="eyebrow">STRATEGY STUDIO / RULE EDITOR</div><h1>Strategy Builder</h1><p className="subtitle">Describe your idea, fine-tune the rules, and review everything before activation.</p></div><span className="draft-pill">● {draft.status.toUpperCase()}</span></div>
            <div className="builder-layout">
              <div className="builder-main panel">
                <div className="step-header"><span className="step-number">01</span><div><h2>Define your strategy</h2><p>Start with plain-language instructions or configure each rule yourself.</p></div></div>
                <div className="mode-switch wide"><button className={mode === "ai" ? "selected" : ""} onClick={() => setMode("ai")}>✧ AI instructions</button><button className={mode === "manual" ? "selected" : ""} onClick={() => setMode("manual")}>☷ Manual conditions</button></div>
                {mode === "ai" && <div className="form-stack"><label className="field-label">STRATEGY INSTRUCTIONS</label><textarea className="instruction-input large" value={draft.instructions} onChange={(e) => updateDraft("instructions", e.target.value)} placeholder="Explain the exact market, frequency thresholds, trigger sequence, entry condition and risk limits…"/><div className="helper-box"><span>✦</span><p><b>Rule safety:</b> the analyzer below is a simple local demo, not a full AI engine. Always verify every interpreted condition before saving.</p></div><button className="secondary-button align-start" onClick={analyzeInstructions}>Analyze instructions →</button></div>}
                {mode === "manual" && <div className="form-stack"><div className="form-grid"><label>Strategy name<input value={draft.name} onChange={(e) => updateDraft("name", e.target.value)} placeholder="e.g. ODD frequency setup"/></label><label>Market<select value={draft.market} onChange={(e) => updateDraft("market", e.target.value)}><option>Volatility 100 Index</option><option>Volatility 75 Index</option><option>Volatility 50 Index</option><option>Volatility 25 Index</option><option>Volatility 10 Index</option><option>Choose after connecting</option></select></label><label>Contract type<select value={draft.contract} onChange={(e) => updateDraft("contract", e.target.value as Strategy["contract"])}><option>ODD</option><option>EVEN</option></select></label><label>Frequency window (ticks)<input type="number" min="10" max="10000" value={draft.frequencyWindow} onChange={(e) => updateDraft("frequencyWindow", Math.max(10,Number(e.target.value)))}/></label><label>Frequency threshold (%)<input type="number" min="0" max="100" step="0.1" value={draft.threshold} onChange={(e) => updateDraft("threshold", Number(e.target.value))}/></label><label>Minimum qualifying digits<input type="number" min="1" max="5" value={draft.qualifyingDigits} onChange={(e) => updateDraft("qualifyingDigits", Number(e.target.value))}/></label><label>Required sequence length<input type="number" min="1" max="10" value={draft.sequenceLength} onChange={(e) => updateDraft("sequenceLength", Number(e.target.value))}/></label><label>Sequence window (ticks)<input type="number" min="1" max="100" value={draft.sequenceWindow} onChange={(e) => updateDraft("sequenceWindow", Number(e.target.value))}/></label></div><label className="field-label">FULL STRATEGY NOTES / EXTRA CONDITIONS<textarea className="instruction-input notes-input" value={draft.instructions} onChange={(e) => updateDraft("instructions", e.target.value)} /></label></div>}
                <div className="section-divider"/>
                <div className="step-header"><span className="step-number">02</span><div><h2>Risk and stake settings</h2><p>Configure limits. These settings are not connected to live execution yet.</p></div></div>
                <div className="form-grid"><label>Initial stake<input type="number" min="0.35" step="0.01" value={draft.stake} onChange={(e) => updateDraft("stake", Number(e.target.value))}/><small className="field-help">Use a valid amount for the selected contract when connected.</small></label><label>Martingale multiplier<input type="number" min="1" max="10" step="0.1" value={draft.martingaleMultiplier} onChange={(e) => updateDraft("martingaleMultiplier", Number(e.target.value))}/></label><label>Maximum progression steps<input type="number" min="0" max="10" value={draft.maxMartingaleSteps} onChange={(e) => updateDraft("maxMartingaleSteps", Number(e.target.value))}/></label></div>
                <div className="builder-footer"><button className="secondary-button" onClick={() => { setDraft(initialStrategy); setReviewOpen(false); }}>Reset form</button><button className="primary-button" onClick={() => { setReviewOpen(true); setDraft({...draft,status:"Awaiting review"}); }}>Review all rules →</button></div>
              </div>
              <aside className="builder-side">
                <div className="panel checklist-panel"><h3>Before activation</h3><div className="check-row"><span className="check-pending">1</span><div><b>Define conditions</b><small>Set market and trigger rules</small></div></div><div className="check-row"><span className="check-pending">2</span><div><b>Review interpreted rules</b><small>Verify each threshold and sequence</small></div></div><div className="check-row"><span className="check-pending">3</span><div><b>Validate risk limits</b><small>Confirm stake and progression caps</small></div></div><div className="check-row"><span className="check-pending">4</span><div><b>Connect market data</b><small>Deriv connection is not active</small></div></div></div>
                <div className="panel side-note"><div className="note-icon">◇</div><h3>Safety comes first</h3><p>Strategies are saved locally in this browser in this build. No live Deriv orders can be placed from this interface.</p><span className="safe-label">REAL-MONEY EXECUTION DISABLED</span></div>
              </aside>
            </div>
          </section>}

          {page === "markets" && <PlaceholderPage title="Market Monitor" description="A live market monitor will show connected Deriv ticks, digit frequencies, and strategy eligibility." icon="⌁" action="Check backend connection" onAction={checkBackend} status={backendStatus}/>}
          {page === "trades" && <PlaceholderPage title="Active Trades" description="Open contracts will appear here once an authenticated Deriv connection and trade-management service are implemented." icon="↗"/>}
          {page === "history" && <PlaceholderPage title="Trade History" description="Settled outcomes and audit events will appear here after persistent trade storage is connected." icon="◷"/>}
          {page === "risk" && <PlaceholderPage title="Risk Controls" description="Risk settings can be reviewed in the Strategy Builder. Server-side enforcement is required before live execution." icon="◇" action="Open Strategy Builder" onAction={() => setPage("builder")}/>}
          {page === "settings" && <section><div className="page-heading-row"><div><div className="eyebrow">WORKSPACE CONFIGURATION</div><h1>Settings & connections</h1><p className="subtitle">Review service connectivity. Never share your Deriv password or secret API keys.</p></div></div><div className="settings-grid"><div className="panel setting-card"><div className="setting-title"><span className="setting-logo">S</span><div><h2>Supabase</h2><p>Database endpoint status</p></div><span className={`status-pill ${supabaseStatus}`}>{supabaseStatus}</span></div><p className="setting-description">The endpoint check confirms reachability only. User authentication and database persistence are not yet implemented.</p><button className="secondary-button" onClick={() => { setSupabaseStatus("checking"); const u=process.env.NEXT_PUBLIC_SUPABASE_URL; const k=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY; if(!u||!k){setSupabaseStatus("missing");return;} fetch(`${u.replace(/\/$/,"")}/auth/v1/settings`,{headers:{apikey:k}}).then(r=>setSupabaseStatus(r.ok?"connected":"error")).catch(()=>setSupabaseStatus("error")); }}>Recheck connection</button></div><div className="panel setting-card"><div className="setting-title"><span className="setting-logo deriv-logo">D</span><div><h2>Deriv</h2><p>Official account authorization</p></div><span className="status-pill missing">not connected</span></div><p className="setting-description">Use the official Deriv authorization flow when it is implemented. Supa AI will never ask for your Deriv password.</p><button className="secondary-button" onClick={() => setNotice("Official Deriv authorization has not been implemented yet.")}>Connection details</button></div><div className="panel setting-card"><div className="setting-title"><span className="setting-logo">API</span><div><h2>Backend service</h2><p>Trading engine health</p></div><span className={`status-pill ${backendStatus}`}>{backendStatus}</span></div><p className="setting-description">A persistent backend is needed for live ticks, contract reconciliation, risk enforcement, and trade workers.</p><button className="secondary-button" onClick={checkBackend}>Check backend</button></div></div></section>}

          {reviewOpen && <div className="modal-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) setReviewOpen(false); }}><section className="review-modal panel" role="dialog" aria-modal="true" aria-labelledby="review-title"><div className="modal-heading"><div><div className="eyebrow">CONFIRMATION REQUIRED</div><h2 id="review-title">Review strategy rules</h2><p>Check every rule before saving. Nothing will be traded.</p></div><button className="icon-button" onClick={() => setReviewOpen(false)} aria-label="Close review">×</button></div><div className="review-warning"><span>!</span><p><b>Demo interface only.</b> The instruction parser is a simple heuristic, not a full AI model. Verify all rules manually.</p></div><div className="review-summary"><div><small>STRATEGY</small><b>{draft.name || "Untitled strategy"}</b></div><div><small>MARKET</small><b>{draft.market}</b></div><div><small>CONTRACT</small><b>{draft.contract}</b></div><div><small>FREQUENCY WINDOW</small><b>{draft.frequencyWindow} ticks</b></div><div><small>FREQUENCY THRESHOLD</small><b>{draft.threshold}%</b></div><div><small>MIN. QUALIFYING DIGITS</small><b>{draft.qualifyingDigits}</b></div><div><small>SEQUENCE</small><b>{draft.sequenceLength} consecutive digit(s)</b></div><div><small>SEQUENCE WINDOW</small><b>{draft.sequenceWindow} ticks</b></div><div><small>INITIAL STAKE</small><b>{draft.stake}</b></div><div><small>MARTINGALE</small><b>{draft.martingaleMultiplier}× · max {draft.maxMartingaleSteps} steps</b></div></div><div className="review-instructions"><small>ORIGINAL INSTRUCTIONS</small><p>{draft.instructions || "No natural-language instructions supplied."}</p></div><div className="modal-footer"><button className="secondary-button" onClick={() => { setReviewOpen(false); setPage("builder"); }}>Edit conditions</button><button className="secondary-button" onClick={() => saveStrategy(false)}>Save as draft</button><button className="primary-button" onClick={() => saveStrategy(true)}>Confirm & save <span>→</span></button></div></section></div>}
        </div>
        <footer className="footer"><span>SUPA AI <span className="footer-dot">•</span> BUILD 0.2.0</span><span>Demo workspace · Live trading disabled</span></footer>
      </section>
    </main>
  );
}

function Metric({ label, value, foot, icon, positive = false }: { label: string; value: string; foot: string; icon: string; positive?: boolean }) {
  return <div className="metric-card panel"><div className="metric-top"><span>{label}</span><i>{icon}</i></div><div className={`metric-value ${positive ? "positive" : ""}`}>{value}</div><div className="metric-foot">{foot}</div></div>;
}

function PlaceholderPage({ title, description, icon, action, onAction, status }: { title: string; description: string; icon: string; action?: string; onAction?: () => void; status?: string }) {
  return <section><div className="page-heading-row"><div><div className="eyebrow">SUPA AI WORKSPACE</div><h1>{title}</h1><p className="subtitle">{description}</p></div></div><div className="panel placeholder-panel"><div className="placeholder-icon">{icon}</div><h2>This module is not connected yet</h2><p>{description}</p>{status && <div className="placeholder-status">Backend status: <b>{status}</b></div>}{action && <button className="primary-button" onClick={onAction}>{action} →</button>}<div className="placeholder-foot">This build focuses on the dashboard and Strategy Builder interface. Live data and execution must be implemented and tested separately.</div></div></section>;
}
