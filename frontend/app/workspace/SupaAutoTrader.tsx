"use client";

import React, { useEffect, useRef, useState } from "react";
import {
  DEFAULT_CONFIG, StrategyEngine, analyzeMarket, normalizeLastDigit,
  type EngineState, type MarketAnalysis, type MarketDefinition, type StrategyConfig, type Tick, type TradeSignal
} from "./strategy-engine";

type MarketMeta = MarketDefinition & { pipSize: number };
type FeedMessage = Record<string, any>;

const PUBLIC_WS = "wss://api.derivws.com/trading/v1/options/ws/public";

export default function SupaAutoTrader() {
  const [config, setConfig] = useState<StrategyConfig>({ ...DEFAULT_CONFIG });
  const [status, setStatus] = useState<"idle"|"connecting"|"scanning"|"streaming"|"error">("idle");
  const [markets, setMarkets] = useState<MarketAnalysis[]>([]);
  const [state, setState] = useState<EngineState | null>(null);
  const [feedMessage, setFeedMessage] = useState("Scanner stopped.");
  const [signal, setSignal] = useState<TradeSignal | null>(null);
  const [engineLog, setEngineLog] = useState<string[]>([]);
  const [virtualResultInput, setVirtualResultInput] = useState<"win"|"loss">("win");
  const [manualResultInput, setManualResultInput] = useState("0");
  const [selectedTab, setSelectedTab] = useState<"rules"|"markets"|"log">("rules");
  const socketRef = useRef<WebSocket | null>(null);
  const engineRef = useRef<StrategyEngine | null>(null);
  const metaRef = useRef<Map<string, MarketMeta>>(new Map());
  const historyReceivedRef = useRef<Set<string>>(new Set());
  const pendingHistoryRef = useRef<Map<number, MarketMeta>>(new Map());
  const subscriptionIdsRef = useRef<Map<string, number>>(new Map());
  const reqIdRef = useRef(1);
  const runRef = useRef(false);

  function updateConfig<K extends keyof StrategyConfig>(key: K, value: StrategyConfig[K]) {
    setConfig(old => ({ ...old, [key]: value }));
  }
  function refreshFromEngine() {
    const engine = engineRef.current;
    if (!engine) return;
    setState(engine.getState());
    setMarkets(engine.getAnalyses());
    setEngineLog(engine.getState().log);
  }
  function stopScanner(reason = "Scanner stopped by trader.") {
    runRef.current = false;
    engineRef.current?.stop(reason);
    try { socketRef.current?.close(); } catch {}
    socketRef.current = null;
    setStatus("idle");
    setFeedMessage(reason);
    refreshFromEngine();
  }

  function startScanner() {
    if (status === "connecting" || status === "scanning" || status === "streaming") return;
    try {
      const engine = new StrategyEngine(config);
      engineRef.current = engine;
      runRef.current = true;
      historyReceivedRef.current.clear();
      pendingHistoryRef.current.clear();
      subscriptionIdsRef.current.clear();
      metaRef.current.clear();
      setMarkets([]);
      setSignal(null);
      setStatus("connecting");
      setFeedMessage("Connecting to Deriv public market data…");
      const ws = new WebSocket(PUBLIC_WS);
      socketRef.current = ws;
      const marketsBySymbol = new Map<string, MarketMeta>();
      let requestedHistory = false;
      let expectedHistoryCount = 0;
      const historyResults = new Map<string, Tick[]>();
      const symbolReq = reqIdRef.current++;

      const send = (payload: object) => {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
      };

      ws.onopen = () => send({ active_symbols: "brief", req_id: symbolReq });

      ws.onmessage = (event) => {
        if (!runRef.current) return;
        let msg: FeedMessage;
        try { msg = JSON.parse(event.data); } catch { return; }

        if (msg.error) {
          const req = Number(msg.req_id);
          const market = pendingHistoryRef.current.get(req);
          if (market) {
            historyReceivedRef.current.add(market.symbol);
            setFeedMessage(`${market.label}: ${msg.error.message || "market history unavailable"}`);
            if (historyReceivedRef.current.size >= expectedHistoryCount) beginStreams();
          } else {
            setFeedMessage(`Deriv API: ${msg.error.message || "request failed"}`);
          }
          return;
        }

        if (msg.msg_type === "active_symbols" && !requestedHistory) {
          const rows = Array.isArray(msg.active_symbols) ? msg.active_symbols : [];
          const candidates: MarketMeta[] = rows
            .filter((row: any) => {
              const name = String(row.underlying_symbol_name || "");
              const symbol = String(row.underlying_symbol || "");
              return /volatility/i.test(name) && /^(R_|1HZ)/.test(symbol);
            })
            .map((row: any) => ({
              symbol: String(row.underlying_symbol),
              label: String(row.underlying_symbol_name || row.underlying_symbol),
              pipSize: Number.isInteger(Number(row.pip_size)) ? Number(row.pip_size) : -1
            }))
            .filter((row: MarketMeta) => row.pipSize >= 0 && row.pipSize <= 10);
          // If metadata is unavailable for a market, omit it rather than guess its last-digit precision.
          if (!candidates.length) {
            setStatus("error");
            setFeedMessage("Deriv did not return usable volatility-market precision metadata. No guessed digit data was used.");
            return;
          }
          candidates.forEach(m => marketsBySymbol.set(m.symbol,m));
          metaRef.current = new Map(candidates.map(m => [m.symbol,m]));
          engine.start(candidates);
          expectedHistoryCount = candidates.length;
          requestedHistory = true;
          setStatus("scanning");
          setFeedMessage(`Loading ${config.window.toLocaleString()} historical ticks for ${candidates.length} supported volatility markets…`);
          candidates.forEach(market => {
            const req = reqIdRef.current++;
            pendingHistoryRef.current.set(req, market);
            send({ ticks_history: market.symbol, count: config.window, end: "latest", style: "ticks", req_id: req });
          });
          return;
        }

        const req = Number(msg.req_id);
        const pendingMarket = pendingHistoryRef.current.get(req);
        if (pendingMarket && msg.history && Array.isArray(msg.history.prices)) {
          const times: number[] = Array.isArray(msg.history.times) ? msg.history.times : [];
          const ticks: Tick[] = msg.history.prices.map((price: any, index: number) => {
            const digit = normalizeLastDigit(price, pendingMarket.pipSize);
            if (digit === null) return null;
            return { quote: Number(price), digit, epoch: Number(times[index] ?? 0) };
          }).filter((t: Tick | null): t is Tick => t !== null).slice(-config.window);
          historyResults.set(pendingMarket.symbol, ticks);
          historyReceivedRef.current.add(pendingMarket.symbol);
          engine.seedHistory(pendingMarket.symbol,ticks);
          pendingHistoryRef.current.delete(req);
          setFeedMessage(`Loaded ${ticks.length}/${config.window} ticks for ${pendingMarket.label}.`);
          refreshFromEngine();
          if (historyReceivedRef.current.size >= expectedHistoryCount) beginStreams();
          return;
        }

        if (msg.msg_type === "tick" && msg.tick) {
          const symbol = String(msg.tick.symbol || "");
          const meta = marketsBySymbol.get(symbol);
          if (!meta) return;
          const digit = normalizeLastDigit(msg.tick.quote, meta.pipSize);
          if (digit === null) return;
          const tick: Tick = { quote: Number(msg.tick.quote), digit, epoch: Number(msg.tick.epoch) };
          const found = engine.onTick(symbol,tick);
          if (found) {
            setSignal(found);
            setFeedMessage(found.mode === "VIRTUAL"
              ? `Virtual-hook signal on ${found.label}; no order sent.`
              : `Strategy trigger on ${found.label}. Live execution adapter is not connected; no order was sent.`);
          }
          refreshFromEngine();
        }
      };

      const beginStreams = () => {
        if (!runRef.current || !ws || ws.readyState !== WebSocket.OPEN || subscriptionIdsRef.current.size) return;
        setStatus("streaming");
        setFeedMessage(`Historical scan complete. Streaming qualifying volatility markets and rechecking the rules on every tick.`);
        for (const market of marketsBySymbol.values()) {
          const req = reqIdRef.current++;
          subscriptionIdsRef.current.set(market.symbol,req);
          send({ ticks: market.symbol, subscribe: 1, req_id: req });
        }
        refreshFromEngine();
      };

      ws.onerror = () => {
        setStatus("error");
        setFeedMessage("Market-data WebSocket failed. Check network access and retry.");
      };
      ws.onclose = () => {
        if (runRef.current) {
          setStatus("error");
          setFeedMessage("Market-data connection closed. Scanner stopped; reconnect manually.");
          engine.stop("Market-data connection closed; entries disabled.");
          refreshFromEngine();
        }
      };
    } catch (error) {
      setStatus("error");
      setFeedMessage(error instanceof Error ? error.message : "Could not start scanner.");
    }
  }

  useEffect(() => () => {
    runRef.current = false;
    try { socketRef.current?.close(); } catch {}
  }, []);

  function recordResult() {
    const profit = Number(manualResultInput);
    if (!Number.isFinite(profit)) return;
    engineRef.current?.recordResult(profit, false);
    refreshFromEngine();
    setFeedMessage(`Result recorded: ${profit.toFixed(2)}. This is a manual test entry only, not broker-confirmed.`);
  }
  function recordVirtualResult() {
    const profit = virtualResultInput === "win" ? config.stake * 0.8 : -config.stake;
    engineRef.current?.recordResult(profit, true);
    refreshFromEngine();
    setFeedMessage(`Virtual ${virtualResultInput} recorded for testing. This does not update the broker account.`);
  }

  const active = status === "streaming";
  const stateLabel = state?.status || "STOPPED";
  const readyMarkets = markets.filter(m=>m.eligible).length;

  return <section className="supa-auto-trader">
    <style jsx>{`
      .supa-auto-trader{color:var(--foreground,#e8eef8);display:grid;gap:16px}
      .sat-panel{background:var(--panel,rgba(13,22,36,.9));border:1px solid var(--border,#263449);border-radius:16px;padding:18px}
      .sat-head{display:flex;justify-content:space-between;align-items:flex-start;gap:14px;flex-wrap:wrap}
      .sat-kicker{font-size:11px;letter-spacing:.14em;font-weight:800;color:#67d7b0}
      .sat-head h2{font-size:24px;margin:5px 0}
      .sat-sub{opacity:.72;font-size:13px;max-width:800px}
      .sat-badge{border:1px solid #475569;border-radius:999px;padding:7px 10px;font-size:11px;font-weight:800}
      .sat-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}
      .sat-field{display:grid;gap:6px;font-size:12px}
      .sat-field input,.sat-field select{width:100%;box-sizing:border-box;background:var(--input,#0b1422);color:inherit;border:1px solid var(--border,#34445b);border-radius:9px;padding:10px}
      .sat-field small{opacity:.65}
      .sat-row{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
      .sat-button{border:1px solid #43536a;border-radius:9px;padding:10px 14px;background:#172538;color:#e8eef8;font-weight:800;cursor:pointer}
      .sat-button.primary{background:#087f5b;border-color:#087f5b}
      .sat-button:disabled{opacity:.45;cursor:not-allowed}
      .sat-warning{padding:12px;border-radius:10px;background:rgba(245,158,11,.1);border:1px solid rgba(245,158,11,.4);font-size:12px;line-height:1.5}
      .sat-metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}
      .sat-metric{border:1px solid var(--border,#263449);border-radius:10px;padding:12px}
      .sat-metric small{display:block;opacity:.65;font-size:10px;font-weight:800;letter-spacing:.08em}
      .sat-metric b{display:block;font-size:20px;margin-top:6px}
      .sat-tabs{display:flex;gap:8px;border-bottom:1px solid var(--border,#263449);padding-bottom:10px}
      .sat-tabs button{border:0;background:transparent;color:inherit;opacity:.7;padding:8px 10px;cursor:pointer}
      .sat-tabs button.selected{opacity:1;border-bottom:2px solid #34d399;font-weight:800}
      .sat-table-wrap{overflow:auto}
      .sat-table{width:100%;border-collapse:collapse;font-size:12px;min-width:740px}
      .sat-table th,.sat-table td{text-align:left;padding:10px 8px;border-bottom:1px solid var(--border,#263449)}
      .sat-table th{font-size:10px;opacity:.65;letter-spacing:.08em}
      .sat-log{display:grid;gap:8px;max-height:300px;overflow:auto}
      .sat-log div{font-size:12px;padding:9px 10px;border-radius:8px;background:rgba(100,116,139,.1)}
      @media(max-width:760px){.sat-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.sat-metrics{grid-template-columns:repeat(2,minmax(0,1fr))}.sat-head h2{font-size:20px}}
      @media(max-width:480px){.sat-grid{grid-template-columns:1fr}}
    `}</style>
    <div className="sat-panel">
      <div className="sat-head">
        <div><div className="sat-kicker">SUPA AI · AUTONOMOUS STRATEGY ENGINE</div><h2>Automatic Volatility Trader</h2><div className="sat-sub">Enter the rules once. The scanner checks active volatility markets, evaluates the last {config.window.toLocaleString()} ticks, and emits a signal only when every configured condition is met.</div></div>
        <span className="sat-badge">EXECUTION: NOT CONNECTED</span>
      </div>
      <div className="sat-warning" style={{marginTop:14}}><b>Research/engineering status:</b> this tool scans real public market data and evaluates rules, but it does not send orders. Deriv order placement requires the account-authorized WebSocket obtained through the secure account flow. Never put an access token in this component. The real executor is intentionally not simulated.</div>
    </div>

    <div className="sat-panel">
      <h3 style={{marginTop:0}}>Trader controls</h3><p style={{fontSize:12,opacity:.7}}>Settings are captured when scanning starts. Stop and restart after changing rules so the engine uses the updated settings.</p>
      <div className="sat-grid">
        <label className="sat-field">Stake<input type="number" min="0.35" step="0.01" value={config.stake} onChange={e=>updateConfig("stake",Number(e.target.value))}/><small>Initial stake in account currency; broker minimum may differ.</small></label>
        <label className="sat-field">Maximum stake<input type="number" min={config.stake} step="0.01" value={config.maxStake} onChange={e=>updateConfig("maxStake",Math.max(config.stake,Number(e.target.value)))}/><small>Hard cap applied to the proposed stake.</small></label>
        <label className="sat-field">Analysis ticks<input type="number" min="100" max="1000" step="100" value={config.window} onChange={e=>updateConfig("window",Math.max(100,Math.min(1000,Number(e.target.value)||1000)))}/><small>Maximum 1,000 recent ticks per market.</small></label>
        <label className="sat-field">Even digit maximum %<input type="number" min="0.1" max="100" step="0.1" value={config.evenDigitMaxPercent} onChange={e=>updateConfig("evenDigitMaxPercent",Number(e.target.value))}/><small>Each even digit must be strictly below this.</small></label>
        <label className="sat-field">Odd digit minimum %<input type="number" min="0" max="100" step="0.1" value={config.oddDigitMinPercent} onChange={e=>updateConfig("oddDigitMinPercent",Number(e.target.value))}/><small>At least the required count of odd digits must meet it.</small></label>
        <label className="sat-field">Qualifying odd digits<input type="number" min="1" max="5" value={config.qualifyingOddCount} onChange={e=>updateConfig("qualifyingOddCount",Math.max(1,Math.min(5,Number(e.target.value)||3)))}/></label>
        <label className="sat-field">Sequence window (ticks)<input type="number" min="2" max="20" value={config.sequenceWindow} onChange={e=>updateConfig("sequenceWindow",Math.max(config.consecutiveOddCount,Math.min(20,Number(e.target.value)||5)))}/><small>After the least-frequent even digit appears.</small></label>
        <label className="sat-field">Consecutive odd digits<input type="number" min="2" max="5" value={config.consecutiveOddCount} onChange={e=>updateConfig("consecutiveOddCount",Math.max(2,Math.min(5,Number(e.target.value)||2)))}/></label>
        <label className="sat-field">Stop-loss<input type="number" min="0.01" step="0.01" value={config.stopLoss} onChange={e=>updateConfig("stopLoss",Number(e.target.value))}/></label>
        <label className="sat-field">Take-profit<input type="number" min="0.01" step="0.01" value={config.takeProfit} onChange={e=>updateConfig("takeProfit",Number(e.target.value))}/></label>
        <label className="sat-field">Stop after consecutive losses<input type="number" min="1" max="20" value={config.maxConsecutiveLosses} onChange={e=>updateConfig("maxConsecutiveLosses",Math.max(1,Math.min(20,Number(e.target.value)||3)))}/></label>
        <label className="sat-field">Maximum trades per session<input type="number" min="1" max="500" value={config.maxTradesPerSession} onChange={e=>updateConfig("maxTradesPerSession",Math.max(1,Math.min(500,Number(e.target.value)||50)))}/></label>
        <label className="sat-field">Contract<select value={config.contract} onChange={e=>updateConfig("contract",e.target.value as StrategyConfig["contract"])}><option value="ODD">ODD</option><option value="EVEN">EVEN</option></select></label>
      </div>
      <div className="sat-row" style={{marginTop:14}}>
        <label className="sat-row"><input type="checkbox" checked={config.martingaleEnabled} onChange={e=>updateConfig("martingaleEnabled",e.target.checked)}/><b>Martingale {config.martingaleEnabled?"ON":"OFF"}</b></label>
        {config.martingaleEnabled && <><label className="sat-field" style={{minWidth:140}}>Multiplier<input type="number" min="1" max="5" step="0.1" value={config.martingaleMultiplier} onChange={e=>updateConfig("martingaleMultiplier",Number(e.target.value))}/></label><label className="sat-field" style={{minWidth:140}}>Maximum steps<input type="number" min="0" max="5" value={config.maxMartingaleSteps} onChange={e=>updateConfig("maxMartingaleSteps",Number(e.target.value))}/></label></>}
        <label className="sat-row"><input type="checkbox" checked={config.virtualHookEnabled} onChange={e=>updateConfig("virtualHookEnabled",e.target.checked)}/><b>Virtual Hook {config.virtualHookEnabled?"ON":"OFF"}</b></label>
      </div>
      <p style={{fontSize:12,opacity:.7,lineHeight:1.5}}>Virtual Hook definition in this build: after a recorded real loss, subsequent signals are virtual-only until a virtual win is recorded. Virtual results never change the broker balance. Martingale is OFF by default; enabling it can rapidly increase losses.</p>
      <div className="sat-row" style={{marginTop:16}}>
        <button className="sat-button primary" disabled={status==="connecting"||status==="scanning"||status==="streaming"} onClick={startScanner}>Start automatic scan</button>
        <button className="sat-button" disabled={!active} onClick={()=>stopScanner()}>Stop scanner</button>
        <button className="sat-button" disabled={!state||state.status!=="PAUSED_RISK"} onClick={()=>{engineRef.current?.resumeAfterReview();refreshFromEngine();}}>Resume after risk review</button>
      </div>
      <p role="status" style={{fontSize:12,marginTop:12}}><b>{status.toUpperCase()}</b> · {feedMessage}</p>
    </div>

    <div className="sat-metrics">
      <div className="sat-metric"><small>ENGINE STATE</small><b>{stateLabel}</b></div>
      <div className="sat-metric"><small>QUALIFYING MARKETS</small><b>{readyMarkets}</b></div>
      <div className="sat-metric"><small>SESSION P/L</small><b>{(state?.sessionProfit??0).toFixed(2)}</b></div>
      <div className="sat-metric"><small>CONSECUTIVE LOSSES</small><b>{state?.consecutiveLosses??0} / {config.maxConsecutiveLosses}</b></div>
    </div>

    {signal && <div className="sat-panel"><div className="sat-head"><div><div className="sat-kicker">STRATEGY SIGNAL</div><h3>{signal.label} · {signal.contract}</h3><p>{signal.explanation}</p><p>Stake plan: {signal.stake.toFixed(2)} · {signal.mode==="VIRTUAL"?"VIRTUAL ONLY":"LIVE CANDIDATE — NOT EXECUTED"}</p></div><span className="sat-badge">{signal.mode}</span></div></div>}

    <div className="sat-panel">
      <div className="sat-tabs">
        <button className={selectedTab==="rules"?"selected":""} onClick={()=>setSelectedTab("rules")}>Strategy rules</button>
        <button className={selectedTab==="markets"?"selected":""} onClick={()=>setSelectedTab("markets")}>Market scan ({markets.length})</button>
        <button className={selectedTab==="log"?"selected":""} onClick={()=>setSelectedTab("log")}>Engine log</button>
      </div>
      {selectedTab==="rules" && <div style={{paddingTop:14,fontSize:13,lineHeight:1.7}}>
        <b>Entry checklist</b><ol><li>At least {config.window} valid ticks exist.</li><li>Each even digit (0, 2, 4, 6, 8) is strictly below {config.evenDigitMaxPercent}%.</li><li>At least {config.qualifyingOddCount} odd digits are at or above {config.oddDigitMinPercent}%.</li><li>The least-frequent even digit appears.</li><li>Within the next {config.sequenceWindow} ticks, {config.consecutiveOddCount} consecutive odd digits appear.</li><li>Session stop-loss, take-profit, consecutive-loss, and max-trade checks pass.</li></ol>
        <div className="sat-warning">If a market's rolling frequency rules fail, the engine stops generating new signals for that market and continues scanning the others. It cannot move an already-open Deriv contract to another market; an open contract must settle or be managed through a supported broker feature.</div>
      </div>}
      {selectedTab==="markets" && <div className="sat-table-wrap" style={{paddingTop:10}}><table className="sat-table"><thead><tr>{["Market","Ticks","Digit 0","Digit 2","Digit 4","Digit 6","Digit 8","Qualifying odd digits","Status"].map(x=><th key={x}>{x}</th>)}</tr></thead><tbody>{markets.map(m=><tr key={m.symbol}><td><b>{m.label}</b><small style={{display:"block",opacity:.6}}>{m.symbol}</small></td><td>{m.sampleSize}/ {config.window}</td>{[0,2,4,6,8].map(d=><td key={d}>{m.digitPercents[d].toFixed(1)}%</td>)}<td>{m.qualifyingOddDigits.length} ({m.qualifyingOddDigits.join(", ")||"none"})</td><td>{m.eligible?"QUALIFIES":m.reasons.join(" ")}</td></tr>)}</tbody></table></div>}
      {selectedTab==="log" && <div className="sat-log" style={{paddingTop:12}}>{engineLog.length?engineLog.map((line,i)=><div key={`${i}-${line}`}>{line}</div>):<p>No events yet.</p>}</div>}
    </div>

    <div className="sat-panel">
      <h3 style={{marginTop:0}}>Result reconciliation / Virtual Hook test controls</h3>
      <div className="sat-warning">For development testing only. Real broker results should come from confirmed contract updates, not from manually typed values. These controls do not send or settle trades.</div>
      <div className="sat-row" style={{marginTop:12}}>
        <label className="sat-field">Virtual result<select value={virtualResultInput} onChange={e=>setVirtualResultInput(e.target.value as "win"|"loss")}><option value="win">Virtual win</option><option value="loss">Virtual loss</option></select></label>
        <button className="sat-button" onClick={recordVirtualResult} disabled={!engineRef.current}>Record virtual result</button>
        <label className="sat-field">Manual P/L result<input type="number" step="0.01" value={manualResultInput} onChange={e=>setManualResultInput(e.target.value)}/></label>
        <button className="sat-button" onClick={recordResult} disabled={!engineRef.current}>Record test result</button>
      </div>
    </div>
  </section>;
}

