"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import SupaAutoTrader from "./SupaAutoTrader";
type SelectedDerivAccount = {
  accountId: string;
  accountType: string;
  currency: string;
  balance: number | string | null;
  isVirtual: boolean;
};
type ImportedBotBlock = { type: string; fields: string[]; children: number };
type ImportedBot = { fileName: string; xml: string; blocks: ImportedBotBlock[]; importedAt: string };

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
  takeProfit: number;
  stopLoss: number;
  maxStake: number;
  maxTrades: number;
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
  takeProfit: 10,
  stopLoss: 5,
  maxStake: 10,
  maxTrades: 5,
  status: "Draft",
  createdAt: new Date().toISOString()
};

const navItems = [
  { id: "dashboard", label: "Dashboard", icon: "▦" },
  { id: "builder", label: "Strategy Builder", icon: "⌘" },
  { id: "ai-console", label: "Supa AI Console", icon: "✦" },
  { id: "auto-trader", label: "Supa AI Auto Trader", icon: "⚡" },
  { id: "markets", label: "Market Monitor", icon: "⌁" },
  { id: "trades", label: "Active Trades", icon: "↗" },
  { id: "history", label: "Trade History", icon: "◷" },
  { id: "risk", label: "Risk Controls", icon: "◇" },
  { id: "bots", label: "Deriv Bot Studio", icon: "▦" },
  { id: "offline", label: "Offline Trading", icon: "▣" },
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

export default function Home({ previewMode = false }: { previewMode?: boolean }) {
  const [page, setPage] = useState("dashboard");
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [selectedAccount, setSelectedAccount] =
  useState<SelectedDerivAccount | null>(null);
  const [draft, setDraft] = useState<Strategy>(initialStrategy);
  const [aiInstructionText, setAiInstructionText] = useState(initialStrategy.instructions);
  const [aiInterpretation, setAiInterpretation] = useState<{market:string; contract:string; stake:number|null; window:number; martingale:boolean|null; maxLossStreak:number|null; entryRule:string|null; warnings:string[]; ready:boolean} | null>(null);
  const [mode, setMode] = useState<"ai" | "manual">("ai");
  const [reviewOpen, setReviewOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const [marketSymbol, setMarketSymbol] = useState("R_100");
  const [marketTicks, setMarketTicks] = useState<Array<{quote:number; digit:number; epoch:number}>>([]);
  const [marketStatus, setMarketStatus] = useState<"connecting"|"live"|"error">("connecting");
  const [marketError, setMarketError] = useState("");
  type MarketScanResult = { symbol: string; label: string; sampleSize: number; oddPercent: number; evenPercent: number; qualifyingDigits: number; score: number; eligible: boolean; note: string };
  const [marketScanResults, setMarketScanResults] = useState<MarketScanResult[]>([]);
  const [marketScanStatus, setMarketScanStatus] = useState<"idle"|"scanning"|"complete"|"error">("idle");
  const [marketScanMessage, setMarketScanMessage] = useState("");
  const [sessionTickCount, setSessionTickCount] = useState(0);
  const tickKeysRef = useRef<Set<string>>(new Set());
  const marketSymbols = [
    {value:"R_10",label:"Volatility 10 Index"},{value:"R_25",label:"Volatility 25 Index"},
    {value:"R_50",label:"Volatility 50 Index"},{value:"R_75",label:"Volatility 75 Index"},
    {value:"R_100",label:"Volatility 100 Index"},{value:"1HZ10V",label:"Volatility 10 (1s) Index"},
    {value:"1HZ25V",label:"Volatility 25 (1s) Index"},{value:"1HZ50V",label:"Volatility 50 (1s) Index"},
    {value:"1HZ75V",label:"Volatility 75 (1s) Index"},{value:"1HZ100V",label:"Volatility 100 (1s) Index"},
    {value:"JD10",label:"Jump 10 Index"},{value:"JD25",label:"Jump 25 Index"},
    {value:"JD50",label:"Jump 50 Index"},{value:"JD75",label:"Jump 75 Index"},{value:"JD100",label:"Jump 100 Index"}
  ];
  const [virtualHook, setVirtualHook] = useState(false);
  const [offlineEnabled, setOfflineEnabled] = useState(false);
  const [botRunning, setBotRunning] = useState(false);
  const [floatingDigitsOpen, setFloatingDigitsOpen] = useState(false);
  const [offlineContracts, setOfflineContracts] = useState<Array<{id:string;time:string;market:string;contract:string;result:string;mode:string;profit:string}>>([]);
  const [botName, setBotName] = useState("My first bot");
  const [importedBot, setImportedBot] = useState<ImportedBot | null>(null);
  const [xmlImportError, setXmlImportError] = useState("");
  const [xmlImportBusy, setXmlImportBusy] = useState(false);
  const xmlInputRef = useRef<HTMLInputElement | null>(null);
  const [communitySharing, setCommunitySharing] = useState(false);
  const [controlsHydrated, setControlsHydrated] = useState(false);

  async function handleBotXmlUpload(file?: File) {
    if (!file) return;
    setXmlImportError("");
    setXmlImportBusy(true);
    try {
      if (!file.name.toLowerCase().endsWith(".xml")) {
        throw new Error("Choose a Blockly XML file with the .xml extension.");
      }
      if (file.size > 5 * 1024 * 1024) {
        throw new Error("This XML file is larger than 5 MB. Please export a smaller bot file.");
      }
      const xml = await file.text();
      const parser = new DOMParser();
      const doc = parser.parseFromString(xml, "application/xml");
      if (doc.querySelector("parsererror")) throw new Error("The XML file is malformed and could not be read.");
      const root = doc.documentElement;
      if (!root || !["xml", "workspace"].includes(root.tagName.toLowerCase())) {
        throw new Error("This doesn't look like a Blockly workspace XML file.");
      }
      const blockNodes = Array.from(doc.querySelectorAll("block, shadow"));
      if (blockNodes.length === 0) throw new Error("No Blockly blocks were found in this XML file.");
      const blocks = blockNodes.map((node) => ({
        type: node.getAttribute("type") || node.tagName.toLowerCase(),
        fields: Array.from(node.children).filter((child) => child.tagName.toLowerCase() === "field").map((field) => `${field.getAttribute("name") || "FIELD"}: ${field.textContent || ""}`),
        children: Array.from(node.children).filter((child) => ["block", "shadow", "statement", "value", "next"].includes(child.tagName.toLowerCase())).length,
      }));
      setImportedBot({ fileName: file.name, xml, blocks, importedAt: new Date().toISOString() });
      setBotName(file.name.replace(/\.xml$/i, "") || "Imported bot");
      setBotRunning(false);
      setNotice(`Imported ${file.name}: ${blockNodes.length} Blockly blocks loaded for review. Execution remains disabled until a compatible bot runtime is connected.`);
    } catch (error) {
      setXmlImportError(error instanceof Error ? error.message : "Could not import this XML file.");
    } finally {
      setXmlImportBusy(false);
      if (xmlInputRef.current) xmlInputRef.current.value = "";
    }
  }

  function downloadImportedBotXml() {
    if (!importedBot) return;
    const blob = new Blob([importedBot.xml], { type: "application/xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = importedBot.fileName || "supa-ai-bot.xml";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  useEffect(() => {
    try {
      const saved = localStorage.getItem("supa-ai-frontend-controls");
      if (saved) {
        const v = JSON.parse(saved);
        setVirtualHook(Boolean(v.virtualHook));
        setOfflineEnabled(Boolean(v.offlineEnabled));
        setBotRunning(Boolean(v.botRunning));
        setOfflineContracts(Array.isArray(v.offlineContracts) ? v.offlineContracts.slice(-100) : []);
        setCommunitySharing(Boolean(v.communitySharing));
      }
    } catch { /* Start with safe defaults if local browser data is invalid. */ }
    setControlsHydrated(true);
  }, []);

  useEffect(() => {
    if (!controlsHydrated) return;
    try { localStorage.setItem("supa-ai-frontend-controls", JSON.stringify({virtualHook, offlineEnabled, botRunning, offlineContracts: offlineContracts.slice(-100), communitySharing})); }
    catch { /* Backend persistence will replace browser-only storage. */ }
  }, [virtualHook, offlineEnabled, botRunning, offlineContracts, communitySharing, controlsHydrated]);

useEffect(() => {
  setStrategies(readSavedStrategies());

  let cancelled = false;
  let refreshing = false;

  const loadSelectedAccount = () => {
    try {
      const savedAccount = sessionStorage.getItem(
        "supa_deriv_selected_account"
      );

      if (!savedAccount) {
        setSelectedAccount(null);
        return;
      }

      const account = JSON.parse(savedAccount);

      if (
        account &&
        typeof account === "object" &&
        typeof account.accountId === "string" &&
        typeof account.isVirtual === "boolean"
      ) {
        setSelectedAccount(account as SelectedDerivAccount);
      }
    } catch {
      setSelectedAccount(null);
    }
  };

  const refreshBalance = async () => {
    if (cancelled || refreshing) return;

    refreshing = true;

    try {
      const response = await fetch("/api/auth/deriv/accounts", {
        cache: "no-store",
      });

      if (!response.ok) return;

      const data = await response.json();

      if (!Array.isArray(data.accounts) || cancelled) return;

      const savedAccount = sessionStorage.getItem(
        "supa_deriv_selected_account"
      );

      if (!savedAccount) return;

      const selected = JSON.parse(savedAccount);

      const latestAccount = data.accounts.find(
        (account: SelectedDerivAccount) =>
          account.accountId === selected.accountId
      );

      if (!latestAccount || cancelled) return;

      setSelectedAccount(latestAccount);

      sessionStorage.setItem(
        "supa_deriv_selected_account",
        JSON.stringify(latestAccount)
      );
    } catch {
      // Keep the last known balance if a refresh temporarily fails.
    } finally {
      refreshing = false;
    }
  };

  loadSelectedAccount();
  void refreshBalance();

  const intervalId = window.setInterval(() => {
    void refreshBalance();
  }, 15000);

  return () => {
    cancelled = true;
    window.clearInterval(intervalId);
  };
}, []);

  useEffect(() => {
    let cancelled = false;
    let socket: WebSocket | null = null;
    let reconnectTimer: number | undefined;
    let pingTimer: number | undefined;
    let reconnectAttempts = 0;
    let historyLoaded = false;

    const parseQuote = (quote: unknown, pipSize: unknown) => {
      const value = Number(quote);
      if (!Number.isFinite(value)) return null;
      const rawPipSize = Number(pipSize);
      const decimals = Number.isInteger(rawPipSize) && rawPipSize >= 0 && rawPipSize <= 10
        ? rawPipSize
        : 2;
      // Keep trailing zeroes so the last digit matches the market's pip precision.
      const formatted = value.toFixed(decimals);
      const fractional = formatted.includes(".") ? formatted.split(".")[1] : "";
      const lastChar = fractional.length ? fractional[fractional.length - 1] : formatted.slice(-1);
      const digit = Number(lastChar);
      return Number.isInteger(digit) && digit >= 0 && digit <= 9 ? { quote: value, digit } : null;
    };

    const receiveHistory = (message: any) => {
      const prices: unknown[] = Array.isArray(message.history?.prices) ? message.history.prices : [];
      const times: unknown[] = Array.isArray(message.history?.times) ? message.history.times : [];
      const pipSize = message.pip_size ?? 2;
      const rows = prices.map((price, index) => {
        const parsed = parseQuote(price, pipSize);
        const epoch = Number(times[index]);
        return parsed && Number.isFinite(epoch) ? { ...parsed, epoch } : null;
      }).filter((row): row is { quote: number; digit: number; epoch: number } => row !== null);

      // History is a snapshot. Replace the window rather than waiting for a live tick.
      setMarketTicks(rows.slice(-1000));
      historyLoaded = true;
      setMarketStatus("live");
      setMarketError("");
    };

    const appendLiveTick = (tick: any, response: any) => {
      const parsed = parseQuote(tick?.quote, tick?.pip_size ?? response?.pip_size);
      const epoch = Number(tick?.epoch);
      if (!parsed || !Number.isFinite(epoch)) return;

      // Do not deduplicate by epoch+quote: fast markets can legitimately publish
      // multiple identical quotes within one second.
      setMarketTicks(old => [...old, { ...parsed, epoch }].slice(-1000));
      setSessionTickCount(old => {
        const next = old + 1;
        try { localStorage.setItem("supa-ai-session-tick-count", String(next)); } catch {}
        return next;
      });
      setMarketStatus("live");
      setMarketError("");
    };

    const scheduleReconnect = () => {
      if (cancelled) return;
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      reconnectTimer = window.setTimeout(connect, Math.min(15000, 1000 * (2 ** Math.min(reconnectAttempts++, 4))));
    };

    const connect = () => {
      if (cancelled) return;
      historyLoaded = false;
      setMarketStatus("connecting");
      setMarketError("Connecting to Deriv market data…");

      try {
        socket = new WebSocket("wss://api.derivws.com/trading/v1/options/ws/public");
      } catch {
        setMarketStatus("error");
        setMarketError("Could not create the Deriv WebSocket connection.");
        scheduleReconnect();
        return;
      }

      socket.onopen = () => {
        if (cancelled || !socket) return;
        reconnectAttempts = 0;
        // Request history first. Subscribe only after the snapshot arrives to avoid
        // racing history and stream responses.
        socket.send(JSON.stringify({
          ticks_history: marketSymbol,
          count: 1000,
          end: "latest",
          style: "ticks",
          req_id: 1
        }));
        if (pingTimer) window.clearInterval(pingTimer);
        pingTimer = window.setInterval(() => {
          if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ ping: 1 }));
        }, 25000);
      };

      socket.onmessage = event => {
        if (cancelled) return;
        let message: any;
        try { message = JSON.parse(event.data); } catch { return; }

        if (message.error) {
          setMarketStatus("error");
          setMarketError(`Deriv API: ${String(message.error.message || "Request failed")}`);
          return;
        }

        if (message.msg_type === "history" && message.history) {
          receiveHistory(message);
          if (socket?.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ ticks: marketSymbol, subscribe: 1, req_id: 2 }));
          }
          return;
        }

        if (message.msg_type === "tick" && message.tick) {
          appendLiveTick(message.tick, message);
          return;
        }

        // Keep the UI informative if the server responds but does not return history.
        if (message.msg_type === "ping") return;
        if (!historyLoaded && message.msg_type === "active_symbols") return;
      };

      socket.onerror = () => {
        if (!cancelled) {
          setMarketStatus("error");
          setMarketError("Deriv connection error. Check your internet connection or app ID; retrying automatically.");
        }
      };

      socket.onclose = event => {
        if (pingTimer) window.clearInterval(pingTimer);
        if (!cancelled) {
          setMarketStatus("connecting");
          setMarketError(`Deriv connection closed${event.code ? ` (${event.code})` : ""}; reconnecting…`);
          scheduleReconnect();
        }
      };
    };

    try {
      const saved = Number(localStorage.getItem("supa-ai-session-tick-count") || "0");
      if (Number.isFinite(saved) && saved >= 0) setSessionTickCount(saved);
    } catch {}

    connect();

    return () => {
      cancelled = true;
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      if (pingTimer) window.clearInterval(pingTimer);
      if (socket) {
        socket.onopen = null;
        socket.onmessage = null;
        socket.onerror = null;
        socket.onclose = null;
        socket.close();
      }
    };
  }, [marketSymbol]);

  const frequencies = useMemo(() => {
    const counts = Array(10).fill(0) as number[];
    marketTicks.forEach(t => { if (t.digit >= 0 && t.digit <= 9) counts[t.digit]++; });
    const total = marketTicks.length;
    return counts.map((count,digit)=>({digit,count,percent:total ? count/total*100 : 0}));
  }, [marketTicks]);

  const digitColors = useMemo(() => {
    const ranked = [...frequencies].sort((a,b)=>b.count-a.count||a.digit-b.digit);
    const colors: Record<number,string> = {};
    if (ranked[0]?.count>0) colors[ranked[0].digit]="#20b981";
    if (ranked[1]?.count>0) colors[ranked[1].digit]="#3987ff";
    const low = [...ranked].filter(x=>x.count>0).sort((a,b)=>a.count-b.count||a.digit-b.digit);
    if (low[0]) colors[low[0].digit]="#ef5350";
    if (low[1]) colors[low[1].digit]="#f59e0b";
    return colors;
  }, [frequencies]);

  const priceSeries = useMemo(() => {
    const points = marketTicks.slice(-1000);
    if (!points.length) return { path: "", latest: null as number | null, high: null as number | null, low: null as number | null, change: null as number | null };
    const quotes = points.map(point => point.quote);
    const min = Math.min(...quotes);
    const max = Math.max(...quotes);
    const range = max - min || 1;
    const path = quotes.map((quote, index) => {
      const x = points.length === 1 ? 500 : (index / (points.length - 1)) * 1000;
      const y = 210 - ((quote - min) / range) * 180;
      return `${index === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(" ");
    return { path, latest: quotes[quotes.length - 1], high: max, low: min, change: quotes.length > 1 ? quotes[quotes.length - 1] - quotes[0] : 0 };
  }, [marketTicks]);

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
    setNotice("Review the interpreted rules carefully before saving.");
  }

  function interpretTraderInstructions() {
    const raw = aiInstructionText.trim();
    const text = raw.toLowerCase();
    const warnings: string[] = [];
    if (!raw) {
      setAiInterpretation({ market: "Not specified", contract: "Not specified", stake: null, window: 1000, martingale: null, maxLossStreak: null, entryRule: null, warnings: ["Enter instructions first."], ready: false });
      return;
    }
    const marketMatch = marketSymbols.find(m => text.includes(m.label.toLowerCase()) || text.includes(m.value.toLowerCase()));
    const stakeMatch = text.match(/(?:stake|bet|amount)\s*(?:of|is|=|:)?\s*[$€£]?\s*(\d+(?:\.\d+)?)/i);
    const tickMatch = text.match(/(?:last|latest|previous|past|use)\s+(\d{1,5})\s+ticks?/i);
    const lossMatch = text.match(/(?:stop|pause|halt|quit)[^.!\n]{0,40}?(?:after|at)\s+(\d+)\s+consecutive\s+loss(?:es)?/i);
    const contract = /\b(even)\b/.test(text) ? "EVEN" : /\b(odd)\b/.test(text) ? "ODD" : "Not specified";
    const martingale = /no martingale|never (?:increase|raise) (?:the )?stake|do not (?:increase|raise) (?:the )?stake|don't (?:increase|raise) (?:the )?stake/i.test(raw) ? false : /martingale\s*(?:on|enabled|yes)/i.test(raw) ? true : null;
    const entryRule = /\b(odd|even)\b/.test(text) && /(when|if|after|following|consecutive|digit|frequency|trigger)/.test(text) ? raw : null;
    if (!marketMatch) warnings.push("Market not confidently identified. Select the market explicitly.");
    if (!stakeMatch) warnings.push("Stake not found. Set it in the strategy settings before trading.");
    if (contract === "Not specified") warnings.push("Contract type not identified (for example, ODD or EVEN).");
    if (!entryRule) warnings.push("Entry trigger is ambiguous. Describe the exact condition that must be true before a trade.");
    if (martingale === null) warnings.push("Martingale preference not specified. Explicitly say whether it is allowed; default should remain off.");
    if (!lossMatch) warnings.push("No consecutive-loss stop rule found. Configure a stop condition in Risk Controls.");
    const window = tickMatch ? Math.max(10, Math.min(1000, Number(tickMatch[1]))) : 1000;
    if (tickMatch && Number(tickMatch[1]) > 1000) warnings.push("Market Monitor currently retains at most 1,000 ticks, so the requested window was capped at 1,000.");
    setAiInterpretation({
      market: marketMatch?.label || "Not specified",
      contract,
      stake: stakeMatch ? Number(stakeMatch[1]) : null,
      window,
      martingale,
      maxLossStreak: lossMatch ? Number(lossMatch[1]) : null,
      entryRule,
      warnings,
      ready: Boolean(marketMatch && stakeMatch && contract !== "Not specified" && entryRule && martingale === false && lossMatch)
    });
    if (marketMatch) setMarketSymbol(marketMatch.value);
    setDraft(old => ({ ...old, instructions: raw, market: marketMatch?.label || old.market, contract: contract === "Not specified" ? old.contract : contract as Strategy["contract"], stake: stakeMatch ? Number(stakeMatch[1]) : old.stake, frequencyWindow: window, martingaleMultiplier: martingale === false ? 1 : old.martingaleMultiplier, maxMartingaleSteps: martingale === false ? 0 : old.maxMartingaleSteps, status: "Awaiting review" }));
  }

  async function scanMarketsForStrategy() {
    if (marketScanStatus === "scanning") return;
    setMarketScanStatus("scanning");
    setMarketScanMessage("Requesting up to 1,000 recent ticks from each supported volatility market…");
    setMarketScanResults([]);

    const candidates = marketSymbols.filter(item => /^(R_|1HZ|JD)/.test(item.value));
    const reqToMarket = new Map<number, typeof candidates[number]>();
    candidates.forEach((market, index) => reqToMarket.set(index + 100, market));

    await new Promise<void>((resolve) => {
      let socket: WebSocket | null = null;
      let finished = false;
      const results: MarketScanResult[] = [];
      const timer = window.setTimeout(() => {
        finish("Some markets did not respond before the scan timed out.", true);
      }, 30000);

      const finish = (message: string, error = false) => {
        if (finished) return;
        finished = true;
        window.clearTimeout(timer);
        try { socket?.close(); } catch {}
        setMarketScanResults(results.sort((a,b) => b.score - a.score || b.sampleSize - a.sampleSize));
        setMarketScanStatus(error && results.length === 0 ? "error" : "complete");
        setMarketScanMessage(results.length
          ? `${results.length} markets analyzed. Scores reflect the current rule fit, not a prediction of future prices or profitability.`
          : message);
        resolve();
      };

      try {
        socket = new WebSocket("wss://api.derivws.com/trading/v1/options/ws/public");
      } catch {
        finish("Could not open the public market-data connection.", true);
        return;
      }

      socket.onopen = () => {
        reqToMarket.forEach((market, reqId) => {
          socket?.send(JSON.stringify({
            ticks_history: market.value,
            count: 1000,
            end: "latest",
            style: "ticks",
            req_id: reqId
          }));
        });
      };

      socket.onmessage = event => {
        if (finished) return;
        let message: any;
        try { message = JSON.parse(event.data); } catch { return; }
        const reqId = Number(message.req_id);
        const market = reqToMarket.get(reqId);
        if (!market) return;

        if (message.error) {
          results.push({
            symbol: market.value, label: market.label, sampleSize: 0,
            oddPercent: 0, evenPercent: 0, qualifyingDigits: 0, score: 0,
            eligible: false, note: String(message.error.message || "Market data unavailable")
          });
        } else if (message.history && Array.isArray(message.history.prices)) {
          const pipSize = Number.isInteger(Number(message.pip_size)) ? Number(message.pip_size) : 2;
          const digits = message.history.prices.map((price: unknown) => {
            const value = Number(price);
            if (!Number.isFinite(value)) return null;
            const formatted = value.toFixed(Math.max(0, Math.min(10, pipSize)));
            const fraction = formatted.includes(".") ? formatted.split(".")[1] : "";
            const digit = Number(fraction.length ? fraction.slice(-1) : formatted.slice(-1));
            return Number.isInteger(digit) && digit >= 0 && digit <= 9 ? digit : null;
          }).filter((digit: number | null): digit is number => digit !== null).slice(-1000);

          const sampleSize = digits.length;
          const oddPercent = sampleSize ? digits.filter((digit: number) => digit % 2 === 1).length / sampleSize * 100 : 0;
          const evenPercent = sampleSize ? 100 - oddPercent : 0;
          const counts = Array(10).fill(0) as number[];
          digits.forEach((digit: number) => counts[digit]++);
          const targetDigits = counts.map((count, digit) => ({
            digit,
            percent: sampleSize ? count / sampleSize * 100 : 0,
            matchesParity: draft.contract === "ODD" ? digit % 2 === 1 : digit % 2 === 0
          })).filter(item => item.matchesParity);
          const qualifyingDigits = targetDigits.filter(item => item.percent >= draft.threshold).length;
          const requiredWindow = Math.max(10, Math.min(1000, draft.frequencyWindow));
          const enoughData = sampleSize >= requiredWindow;
          const eligible = enoughData && qualifyingDigits >= Math.max(1, draft.qualifyingDigits);
          const distance = Math.abs((draft.contract === "ODD" ? oddPercent : evenPercent) - 50);
          const score = enoughData ? Math.max(0, Math.min(100, 70 + qualifyingDigits * 5 - distance * 2)) : 0;
          results.push({
            symbol: market.value, label: market.label, sampleSize, oddPercent, evenPercent,
            qualifyingDigits, score: Math.round(score), eligible,
            note: !enoughData ? `Need ${requiredWindow} ticks; received ${sampleSize}.` :
              eligible ? `${qualifyingDigits} ${draft.contract.toLowerCase()} digits meet the ${draft.threshold}% threshold.` :
              `Only ${qualifyingDigits} ${draft.contract.toLowerCase()} digits meet the ${draft.threshold}% threshold; ${Math.max(1, draft.qualifyingDigits)} required.`
          });
        }

        if (results.length >= candidates.length) finish("Market scan completed.");
      };
      socket.onerror = () => finish("Market-data connection failed. Check the public feed and try again.", true);
    });
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
      ? "Strategy settings saved. Confirm your account and risk settings before using them."
      : "Strategy draft saved.");
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
    setNotice("Strategy status updated.");
  }

  const pageTitle = navItems.find((n) => n.id === page)?.label || "Dashboard";

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand-lockup">
          <div className="brand-mark">S<span>+</span></div>
          <div><div className="brand-name">supa<span>ai</span></div><div className="brand-subtitle">TRADING INTELLIGENCE</div></div>
        </div>
       <nav className="sidebar-nav">
       <button
  type="button"
  className="workspace-label"
  onClick={() => setPage("dashboard")}
  style={{
    display: "block",
    width: "100%",
    border: "none",
    background: "transparent",
    textAlign: "left",
    cursor: "pointer",
    font: "inherit",
  }}
>
  WORKSPACE
</button>
        {navItems.map((item) => <button key={item.id} type="button" className={`nav-item ${page === item.id ? "active" : ""}`} onClick={() => setPage(item.id)}><span>{item.icon}</span><span>{item.label}</span></button>)}
        </nav>
        <div className="sidebar-bottom">
          <div className="profile-row"><div className="avatar">SA</div><div><b>Supa AI Workspace</b><small>{previewMode ? "Preview only" : "Deriv-authorized workspace"}</small></div><span className="more-dots">•••</span></div>
        </div>
      </aside>

      <section className="main-area">
        <header className="topbar">
          <div className="breadcrumbs"><span>Workspace</span><span className="crumb-slash">/</span><b>{pageTitle}</b></div>
          <div className="top-actions">
  {selectedAccount && (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-end",
        marginRight: "12px",
        gap: "4px",
      }}
    >
      <span
        style={{
          fontSize: "11px",
          fontWeight: 700,
          letterSpacing: "1px",
          color: selectedAccount.isVirtual ? "#D9A441" : "#36C995",
        }}
      >
        {selectedAccount.isVirtual ? "DEMO ACCOUNT" : "REAL ACCOUNT"}
      </span>

      <strong style={{ fontSize: "16px" }}>
        {selectedAccount.balance !== null &&
        selectedAccount.balance !== "" &&
        Number.isFinite(Number(selectedAccount.balance))
          ? `${selectedAccount.currency || ""} ${Number(
              selectedAccount.balance
            ).toLocaleString(undefined, {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}`.trim()
          : "Balance unavailable"}
      </strong>

      <small style={{ opacity: 0.7 }}>
        {selectedAccount.accountId}
      </small>
    </div>
  )}

  {previewMode ? (
    <button
      className="secondary-button account-mode-button"
      onClick={() => window.location.assign("/")}
    >
      Exit preview ↗
    </button>
  ) : (
    <button
      className="secondary-button account-mode-button"
      onClick={() => window.location.assign("/account")}
    >
      Choose account ↗
    </button>
  )}

  <button className="icon-button" aria-label="Notifications">
    ♧
  </button>

  <div className="avatar small">SA</div>
</div>
        </header>

        <div className="page-content">
          {previewMode && <div className="notice-bar preview-access-banner"><span>◈</span><span><b>Preview mode</b> — explore the dashboard and Strategy Builder. No Deriv account is connected, and no trades can be placed.</span><button onClick={() => window.location.assign("/")} aria-label="Exit preview">×</button></div>}
          {notice && <div className="notice-bar"><span>ⓘ</span><span>{notice}</span><button onClick={() => setNotice("")} aria-label="Dismiss notice">×</button></div>}

          {page === "dashboard" && <>
            <div className="page-heading-row">
              <div><div className="eyebrow">MONDAY, OCTOBER 26, 2026</div><h1>Welcome to your trading desk.</h1><p className="subtitle">Build your strategy, monitor market conditions, and stay in control.</p></div>
              <button className="primary-button" onClick={() => { setPage("builder"); setReviewOpen(false); }}>＋ Create strategy</button>
            </div>
            <section className="quick-builder panel">
              <div className="section-heading"><div><div className="eyebrow">STRATEGY STUDIO</div><h2>What should Supa AI look for?</h2><p>Describe your trading conditions or configure them manually.</p></div><span className="sparkle">✳</span></div>
              <div className="mode-switch"><button className={mode === "ai" ? "selected" : ""} onClick={() => setMode("ai")}>✧ AI instructions</button><button className={mode === "manual" ? "selected" : ""} onClick={() => setMode("manual")}>☷ Manual conditions</button></div>
              {mode === "ai" ? <><label className="field-label" htmlFor="quick-instructions">YOUR STRATEGY IN PLAIN LANGUAGE</label><textarea id="quick-instructions" className="instruction-input" value={draft.instructions} onChange={(e) => updateDraft("instructions", e.target.value)} placeholder="Example: Monitor a market, check digit frequencies, then wait for my exact trigger…"/><div className="input-footer"><span>✦ Your rules will be shown for review before saving.</span><button className="text-button" onClick={() => setPage("builder")}>Open full builder ↗</button></div><div className="quick-actions"><button className="secondary-button" onClick={() => { setPage("builder"); setMode("ai"); }}>Edit in Strategy Builder</button><button className="primary-button" onClick={analyzeInstructions}>Analyze instructions <span>→</span></button></div></> : <><div className="form-grid compact-grid"><label>Strategy name<input value={draft.name} onChange={(e) => updateDraft("name", e.target.value)} /></label><label>Market<select value={draft.market} onChange={(e) => updateDraft("market", e.target.value)}><option>Volatility 100 Index</option><option>Volatility 50 Index</option><option>Volatility 25 Index</option><option>Volatility 75 Index</option><option>Volatility 10 Index</option><option>Choose after connecting</option></select></label><label>Contract type<select value={draft.contract} onChange={(e) => updateDraft("contract", e.target.value as Strategy["contract"])}><option>ODD</option><option>EVEN</option></select></label><label>Frequency window (ticks)<input type="number" min="10" value={draft.frequencyWindow} onChange={(e) => updateDraft("frequencyWindow", Number(e.target.value))}/></label></div><div className="quick-actions"><button className="secondary-button" onClick={() => setPage("builder")}>More conditions</button><button className="primary-button" onClick={() => { setReviewOpen(true); setDraft({...draft, status:"Awaiting review"}); }}>Review conditions →</button></div></>}
            </section>
            <div className="metrics-grid">
              <Metric label="ACTIVE STRATEGIES" value={String(strategies.filter(s => s.status === "Monitoring").length).padStart(2,"0")} foot={`${strategies.length} saved in this browser`} icon="⌘"/>
              <Metric label="OPEN CONTRACTS" value="00" foot="Current open positions" icon="↗"/>
              <Metric label="SESSION P&L" value="$0.00" foot="Current session" icon="$"/>
              <Metric label="RISK STATUS" value="Protected" foot="Review your risk limits" icon="◇" positive/>
            </div>
            <div className="lower-grid">
              <section className="panel">
                <div className="panel-heading"><div><h2>Your strategies</h2><p>Review and manage your saved configurations.</p></div><button className="text-button" onClick={() => setPage("builder")}>＋ New strategy</button></div>
                {strategies.length === 0 ? <div className="empty-state"><div className="empty-icon">⌘</div><b>No saved strategies yet</b><p>Create a strategy above to get started.</p><button className="secondary-button" onClick={() => setPage("builder")}>Build your first strategy</button></div> : <div className="strategy-list">{strategies.map(s => <div className="strategy-row" key={s.id}><div className="strategy-symbol">{s.contract === "ODD" ? "◐" : "◑"}</div><div className="strategy-info"><b>{s.name}</b><small>{s.market} · {s.contract}</small></div><span className={`strategy-status ${s.status.toLowerCase().replace(" ","-")}`}>{s.status}</span><button className="row-action" onClick={() => editStrategy(s)}>Edit</button><button className="row-action" onClick={() => togglePause(s)}>{s.status === "Paused" ? "Resume" : "Pause"}</button></div>)}</div>}
              </section>
              <section className="panel market-card">
                <div className="panel-heading"><div><h2>Digit frequency snapshot</h2><p>Illustrative digit-frequency snapshot</p></div><span className="live-tag"><span className="status-dot amber"/> SAMPLE</span></div>
                <div className="frequency-bars">{frequencies.map(f => <div className="frequency-item" key={f.digit}><div className="frequency-value">{f.percent.toFixed(0)}%</div><div className="frequency-track"><div className={`frequency-fill ${f.digit % 2 ? "odd-fill" : ""}`} style={{height:`${Math.max(5,f.percent*2.5)}%`}}/></div><div className="frequency-digit">{f.digit}</div></div>)}</div>
                <div className="chart-footnote"><span><i className="legend-dot" /> Even digits</span><span><i className="legend-dot odd" /> Odd digits</span><button className="text-button" onClick={() => setPage("markets")}>Market monitor ↗</button></div>
              </section>
            </div>
          </>}

          {page === "ai-console" && <section className="builder-page">
            <div className="page-heading-row"><div><div className="eyebrow">NATURAL LANGUAGE · STRATEGY INTERPRETER</div><h1>Supa AI Console</h1><p className="subtitle">Describe your trading plan in plain language. Supa AI converts recognizable instructions into a reviewable draft; it does not place orders.</p></div><span className="draft-pill">INTERPRETER V1 · REVIEW ONLY</span></div>
            <div className="builder-layout">
              <div className="builder-main panel">
                <div className="step-header"><span className="step-number">01</span><div><h2>Tell Supa AI what to do</h2><p>Be specific about market, contract, entry condition, stake, and when to stop.</p></div></div>
                <label className="field-label" htmlFor="supa-ai-instructions">TRADER INSTRUCTIONS</label>
                <textarea id="supa-ai-instructions" className="instruction-input large" value={aiInstructionText} onChange={e=>setAiInstructionText(e.target.value)} placeholder="Example: Trade Volatility 10 Index, use a stake of $0.50, analyze the last 1,000 ticks, enter an ODD contract only after [precise condition], never increase stake after a loss, and stop after 3 consecutive losses." />
                <div className="helper-box"><span>✦</span><p><b>How this version works:</b> This is a transparent pattern-based interpreter, not a connected general-purpose AI model. It extracts only supported details and flags anything it cannot reliably understand.</p></div>
                <div className="quick-actions"><button className="secondary-button" onClick={()=>setAiInstructionText("Trade Volatility 10 Index. Use a stake of $0.50. Analyze the last 1,000 ticks. Enter an ODD contract only when my exact entry condition is met: [describe the condition]. Never increase the stake after a loss (no martingale). Stop after 3 consecutive losses.")}>Use example template</button><button className="primary-button" onClick={interpretTraderInstructions}>Interpret instructions →</button></div>
                {aiInterpretation && <div className="panel" style={{padding:16,marginTop:20}}>
                  <div className="panel-heading"><div><h2>Interpreted strategy</h2><p>Check every field before using this draft.</p></div><span className={`draft-pill ${aiInterpretation.ready?"":""}`}>{aiInterpretation.ready?"REVIEWABLE":"NEEDS CLARIFICATION"}</span></div>
                  <div className="form-grid"><label>Market<input readOnly value={aiInterpretation.market}/></label><label>Contract<input readOnly value={aiInterpretation.contract}/></label><label>Stake<input readOnly value={aiInterpretation.stake===null?"Not found":String(aiInterpretation.stake)}/></label><label>Tick window<input readOnly value={`${aiInterpretation.window} ticks`}/></label><label>Martingale<input readOnly value={aiInterpretation.martingale===null?"Not specified":aiInterpretation.martingale?"Requested ON":"OFF"}/></label><label>Stop after losses<input readOnly value={aiInterpretation.maxLossStreak===null?"Not specified":`${aiInterpretation.maxLossStreak} consecutive losses`}/></label></div>
                  <div style={{marginTop:14}}><b>Entry instruction</b><p style={{marginTop:6,opacity:.82}}>{aiInterpretation.entryRule || "Not understood — describe an exact, testable trigger."}</p></div>
                  {aiInterpretation.warnings.length>0 && <div className="xml-import-error" style={{marginTop:14}}><b>Needs attention</b><ul style={{margin:"8px 0 0",paddingLeft:20}}>{aiInterpretation.warnings.map((warning,i)=><li key={i}>{warning}</li>)}</ul></div>}
                  <div className="quick-actions"><button className="secondary-button" onClick={()=>{setDraft(old=>({...old,instructions:aiInstructionText,status:"Awaiting review"}));setPage("builder");setNotice("Instructions copied to Strategy Builder. Review every field before saving.")}}>Open in Strategy Builder</button><button className="primary-button" onClick={()=>{setDraft(old=>({...old,instructions:aiInstructionText,status:"Awaiting review"}));setReviewOpen(true);setNotice("Strategy draft sent for review only. No trade was placed.")}}>Review strategy draft →</button></div>
                  <small className="bot-disclaimer">No order is sent from this console. Even when all fields are recognized, the strategy still requires human review, rule validation, and a tested execution engine.</small>
                </div>}
              </div>
              <aside className="builder-side"><div className="panel checklist-panel"><h3>Supported in interpreter v1</h3><div className="check-row"><span className="check-pending">1</span><div><b>Market name or symbol</b><small>Matches known market options</small></div></div><div className="check-row"><span className="check-pending">2</span><div><b>Stake amount</b><small>Reads explicit amount</small></div></div><div className="check-row"><span className="check-pending">3</span><div><b>Tick window</b><small>Capped to available 1,000 ticks</small></div></div><div className="check-row"><span className="check-pending">4</span><div><b>Contract and stop rule</b><small>Flags missing or ambiguous instructions</small></div></div></div><div className="panel side-note"><div className="note-icon">◇</div><h3>Execution is separate</h3><p>This console prepares a draft only. Real-account order execution is not activated by interpreting instructions.</p><span className="safe-label">NO ORDERS SENT</span></div></aside>
            </div>
          </section>}

          {page === "builder" && <section className="builder-page">
            <div className="page-heading-row"><div><div className="eyebrow">STRATEGY STUDIO / RULE EDITOR</div><h1>Strategy Builder</h1><p className="subtitle">Describe your idea, fine-tune the rules, and review everything before activation.</p></div><span className="draft-pill">● {draft.status.toUpperCase()}</span></div>
            <div className="builder-layout">
              <div className="builder-main panel">
                <div className="step-header"><span className="step-number">01</span><div><h2>Define your strategy</h2><p>Start with plain-language instructions or configure each rule yourself.</p></div></div>
                <div className="mode-switch wide"><button className={mode === "ai" ? "selected" : ""} onClick={() => setMode("ai")}>✧ AI instructions</button><button className={mode === "manual" ? "selected" : ""} onClick={() => setMode("manual")}>☷ Manual conditions</button></div>
                {mode === "ai" && <div className="form-stack"><label className="field-label">STRATEGY INSTRUCTIONS</label><textarea className="instruction-input large" value={draft.instructions} onChange={(e) => updateDraft("instructions", e.target.value)} placeholder="Explain the exact market, frequency thresholds, trigger sequence, entry condition and risk limits…"/><div className="helper-box"><span>✦</span><p><b>Rule safety:</b> Supa AI will prepare a rule summary from your instructions. Verify every threshold, digit condition, sequence, and risk limit before saving.</p></div><button className="secondary-button align-start" onClick={analyzeInstructions}>Analyze instructions →</button></div>}
                {mode === "manual" && <div className="form-stack"><div className="form-grid"><label>Strategy name<input value={draft.name} onChange={(e) => updateDraft("name", e.target.value)} placeholder="e.g. ODD frequency setup"/></label><label>Market<select value={draft.market} onChange={(e) => updateDraft("market", e.target.value)}><option>Volatility 100 Index</option><option>Volatility 75 Index</option><option>Volatility 50 Index</option><option>Volatility 25 Index</option><option>Volatility 10 Index</option><option>Choose after connecting</option></select></label><label>Contract type<select value={draft.contract} onChange={(e) => updateDraft("contract", e.target.value as Strategy["contract"])}><option>ODD</option><option>EVEN</option></select></label><label>Frequency window (ticks)<input type="number" min="10" max="10000" value={draft.frequencyWindow} onChange={(e) => updateDraft("frequencyWindow", Math.max(10,Number(e.target.value)))}/></label><label>Frequency threshold (%)<input type="number" min="0" max="100" step="0.1" value={draft.threshold} onChange={(e) => updateDraft("threshold", Number(e.target.value))}/></label><label>Minimum qualifying digits<input type="number" min="1" max="5" value={draft.qualifyingDigits} onChange={(e) => updateDraft("qualifyingDigits", Number(e.target.value))}/></label><label>Required sequence length<input type="number" min="1" max="10" value={draft.sequenceLength} onChange={(e) => updateDraft("sequenceLength", Number(e.target.value))}/></label><label>Sequence window (ticks)<input type="number" min="1" max="100" value={draft.sequenceWindow} onChange={(e) => updateDraft("sequenceWindow", Number(e.target.value))}/></label></div><label className="field-label">FULL STRATEGY NOTES / EXTRA CONDITIONS<textarea className="instruction-input notes-input" value={draft.instructions} onChange={(e) => updateDraft("instructions", e.target.value)} /></label></div>}
                <div className="section-divider"/>
                <div className="step-header"><span className="step-number">02</span><div><h2>Risk and stake settings</h2><p>Configure your stake and risk limits.</p></div></div>
                <div className="form-grid"><label>Initial stake<input type="number" min="0.35" step="0.01" value={draft.stake} onChange={(e) => updateDraft("stake", Number(e.target.value))}/><small className="field-help">Use a valid amount for the selected contract.</small></label><label>Martingale multiplier<input type="number" min="1" max="10" step="0.1" value={draft.martingaleMultiplier} onChange={(e) => updateDraft("martingaleMultiplier", Number(e.target.value))}/></label><label>Maximum progression steps<input type="number" min="0" max="10" value={draft.maxMartingaleSteps} onChange={(e) => updateDraft("maxMartingaleSteps", Number(e.target.value))}/></label><label>Take-profit limit<input type="number" min="0" step="0.01" value={draft.takeProfit} onChange={(e) => updateDraft("takeProfit", Number(e.target.value))}/></label><label>Stop-loss limit<input type="number" min="0" step="0.01" value={draft.stopLoss} onChange={(e) => updateDraft("stopLoss", Number(e.target.value))}/></label><label>Maximum stake<input type="number" min="0.35" step="0.01" value={draft.maxStake} onChange={(e) => updateDraft("maxStake", Number(e.target.value))}/></label><label>Maximum concurrent trades<input type="number" min="1" max="50" value={draft.maxTrades} onChange={(e) => updateDraft("maxTrades", Number(e.target.value))}/></label></div>
                <div className="panel" style={{padding:14,marginTop:16}}><label style={{display:"flex",gap:10,alignItems:"center"}}><input type="checkbox" checked={virtualHook} onChange={e=>setVirtualHook(e.target.checked)}/><b>Virtual Hook {virtualHook?"ON":"OFF"}</b></label><p style={{margin:"8px 0 0",fontSize:12,opacity:.75}}>When enabled, the future execution engine will simulate eligible entries before permitting real entries. A virtual win is not a prediction or guarantee. Real trading remains locked until tested and explicitly authorized.</p></div><div className="builder-footer"><button className="secondary-button" onClick={() => { setDraft(initialStrategy); setReviewOpen(false); }}>Reset form</button><button className="primary-button" onClick={() => { setReviewOpen(true); setDraft({...draft,status:"Awaiting review"}); }}>Review all rules →</button></div>
              </div>
              <aside className="builder-side">
                <div className="panel checklist-panel"><h3>Before activation</h3><div className="check-row"><span className="check-pending">1</span><div><b>Define conditions</b><small>Set market and trigger rules</small></div></div><div className="check-row"><span className="check-pending">2</span><div><b>Review interpreted rules</b><small>Verify each threshold and sequence</small></div></div><div className="check-row"><span className="check-pending">3</span><div><b>Validate risk limits</b><small>Confirm stake and progression caps</small></div></div><div className="check-row"><span className="check-pending">4</span><div><b>Connect your account</b><small>Authorize access with Deriv</small></div></div></div>
                <div className="panel side-note"><div className="note-icon">◇</div><h3>Safety comes first</h3><p>Review your rules and risk limits carefully before activating a strategy.</p><span className="safe-label">RISK CONTROLS</span></div>
              </aside>
            </div>
          </section>}

          {page === "auto-trader" && <SupaAutoTrader />}

          {page === "markets" && <section>
            <div className="page-heading-row"><div><div className="eyebrow">LIVE MARKET WORKSPACE</div><h1>Market Monitor</h1><p className="subtitle">Live digit-frequency analysis using up to the latest 1,000 ticks. Frequency history is descriptive, not predictive.</p></div><span className="draft-pill">{marketStatus.toUpperCase()}</span></div>
            <div className="panel market-monitor-panel terminal-panel">
              <div className="terminal-toolbar"><div className="terminal-market-title"><span className={`terminal-status ${marketStatus}`}></span><div><b>Deriv market stream</b><small>{marketStatus === "live" ? "Receiving public tick data" : marketStatus === "error" ? "Connection needs attention" : "Connecting to public market data"}</small></div></div><div className="terminal-tags"><span>PUBLIC DATA</span><span>NO ORDERS SENT</span></div></div>
              <div className="market-controls"><label>Market<select value={marketSymbol} onChange={e=>{tickKeysRef.current.clear();setMarketTicks([]);setMarketSymbol(e.target.value);}}>{marketSymbols.map(item=><option key={item.value} value={item.value}>{item.label}</option>)}</select></label><div className="tick-stat"><small>TICKS IN WINDOW</small><strong>{marketTicks.length} / 1,000</strong></div><div className="tick-stat"><small>SESSION TICK COUNT</small><strong>{sessionTickCount.toLocaleString()}</strong></div><div className="tick-stat"><small>LATEST QUOTE</small><strong>{marketTicks.length?marketTicks[marketTicks.length-1].quote:"—"}</strong></div></div>
              <div className="panel market-scan-panel" style={{margin:"16px 0",padding:16}}>
                <div className="panel-heading"><div><h2>Automatic Market Selector</h2><p>Compare supported markets against the current strategy's digit-frequency conditions.</p></div><button className="primary-button" onClick={scanMarketsForStrategy} disabled={marketScanStatus==="scanning"}>{marketScanStatus==="scanning" ? "Scanning markets…" : "Scan markets"}</button></div>
                <div className="helper-box"><span>✦</span><p>This scanner ranks current historical rule fit using up to 1,000 ticks per market. It does not predict the next tick or place orders. Unrecognized or complex instructions still require explicit strategy rules.</p></div>
                {marketScanMessage && <p role="status" style={{fontSize:13,margin:"10px 0"}}>{marketScanMessage}</p>}
                {marketScanResults.length > 0 && <div style={{overflowX:"auto"}}><table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}><thead><tr>{["Market","Ticks","ODD %","EVEN %","Qualifying digits","Rule fit","Status","Action"].map(h=><th key={h} style={{textAlign:"left",padding:"10px 8px",borderBottom:"1px solid var(--border, #263449)",whiteSpace:"nowrap"}}>{h}</th>)}</tr></thead><tbody>{marketScanResults.map(result=><tr key={result.symbol}><td style={{padding:"10px 8px",borderBottom:"1px solid var(--border, #263449)"}}><b>{result.label}</b><small style={{display:"block",opacity:.7}}>{result.symbol}</small></td><td style={{padding:"10px 8px",borderBottom:"1px solid var(--border, #263449)"}}>{result.sampleSize}</td><td style={{padding:"10px 8px",borderBottom:"1px solid var(--border, #263449)"}}>{result.sampleSize ? result.oddPercent.toFixed(1)+"%" : "—"}</td><td style={{padding:"10px 8px",borderBottom:"1px solid var(--border, #263449)"}}>{result.sampleSize ? result.evenPercent.toFixed(1)+"%" : "—"}</td><td style={{padding:"10px 8px",borderBottom:"1px solid var(--border, #263449)"}}>{result.qualifyingDigits}</td><td style={{padding:"10px 8px",borderBottom:"1px solid var(--border, #263449)"}}>{result.score}/100</td><td style={{padding:"10px 8px",borderBottom:"1px solid var(--border, #263449)"}}><span className={`strategy-status ${result.eligible ? "monitoring" : "paused"}`}>{result.eligible ? "Meets measured rules" : "Does not qualify"}</span><small style={{display:"block",maxWidth:230,opacity:.7,marginTop:4}}>{result.note}</small></td><td style={{padding:"10px 8px",borderBottom:"1px solid var(--border, #263449)"}}><button className="row-action" disabled={!result.eligible} onClick={()=>{setMarketSymbol(result.symbol);setMarketScanMessage(`${result.label} selected for monitoring. No trade has been placed.`);setNotice(`${result.label} selected based on the current rule-fit scan. This is not a trade signal.`);}}>Monitor</button></td></tr>)}</tbody></table></div>}
              </div>
              {marketError && <div className="market-error">{marketError}</div>}
              <div className="price-chart-panel">
                <div className="price-chart-heading"><div><span className="chart-overline">PRICE MOVEMENT · LAST 1,000 TICKS</span><h2>{priceSeries.latest === null ? "Waiting for quote" : priceSeries.latest}</h2><small>Live public tick quotes · chart is descriptive, not a prediction</small></div><div className={`price-change ${priceSeries.change !== null && priceSeries.change >= 0 ? "positive" : "negative"}`}>{priceSeries.change === null ? "—" : `${priceSeries.change >= 0 ? "+" : ""}${priceSeries.change.toFixed(4)}`}<small>window change</small></div></div>
                <div className="price-chart-visual" role="img" aria-label="Line chart of the latest 1,000 received market quotes">
                  <svg viewBox="0 0 1000 240" preserveAspectRatio="none"><defs><linearGradient id="priceFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#20b981" stopOpacity=".22"/><stop offset="100%" stopColor="#20b981" stopOpacity="0"/></linearGradient></defs>{[35,80,125,170,215].map(y=><line key={y} x1="0" x2="1000" y1={y} y2={y} className="chart-grid-line"/>)}{priceSeries.path && <><path d={`${priceSeries.path} L1000,240 L0,240 Z`} fill="url(#priceFill)"/><path d={priceSeries.path} className="price-line"/></>}</svg>
                  {!marketTicks.length && <div className="chart-waiting">The chart will draw when live ticks arrive.</div>}
                </div>
                <div className="price-chart-footer"><span>HIGH <b>{priceSeries.high === null ? "—" : priceSeries.high}</b></span><span>LOW <b>{priceSeries.low === null ? "—" : priceSeries.low}</b></span><span>POINTS <b>{Math.min(1000, marketTicks.length)}</b></span></div>
              </div>
              <div className="digit-grid">{frequencies.map(f=><div className="digit-card" key={f.digit} style={{borderColor:digitColors[f.digit]||"#dfe5ee"}}><div className="digit-card-top"><span>Digit</span><b style={{color:digitColors[f.digit]||"inherit"}}>{f.digit}</b></div><strong>{f.percent.toFixed(2)}%</strong><small>{f.count} ticks</small><div className="digit-progress"><span style={{width:`${f.percent}%`,background:digitColors[f.digit]||"#8b95a7"}}/></div></div>)}</div>
              <div className="panel-heading"><div><h2>Recent ticks</h2><p>Newest first · only real received tick data is shown.</p></div></div>
              <div className="recent-ticks">{[...marketTicks].slice(-30).reverse().map((tick,i)=><div className="recent-tick" key={`${tick.epoch}-${tick.quote}-${i}`}><small>{new Date(tick.epoch*1000).toLocaleTimeString()}</small><strong>{tick.quote}</strong><span style={{background:digitColors[tick.digit]||"#8b95a7"}}>{tick.digit}</span></div>)}</div>
              {!marketTicks.length && <div className="empty-state"><b>Waiting for Deriv ticks…</b><p>Keep the dashboard open while the public market stream connects.</p></div>}
            </div>
            <div className="panel" style={{padding:20,marginTop:16}}><h2>Digit ranking legend</h2><div style={{display:"flex",gap:12,flexWrap:"wrap"}}>{[["Highest frequency","#20b981"],["Second highest","#3987ff"],["Lowest frequency","#ef5350"],["Second lowest","#f59e0b"]].map(([label,color])=><span key={label} style={{padding:"8px 12px",borderRadius:9,background:`${color}18`,color,fontWeight:700}}>{label}</span>)}</div></div>
          </section>}
          {page === "trades" && <section><div className="page-heading-row"><div><div className="eyebrow">EXECUTION MONITOR</div><h1>Active Trades</h1><p className="subtitle">Open contracts will appear here after secure execution and contract reconciliation are connected.</p></div><span className="draft-pill">REAL TRADING LOCKED</span></div><div className="panel" style={{padding:20}}><h2>Contract monitor</h2><p>No live contracts are being reported by this frontend-only panel. The UI does not place trades.</p><div style={{overflowX:"auto"}}><table style={{width:"100%",textAlign:"left",borderCollapse:"collapse"}}><thead><tr>{["Time","Market","Contract","Stake","Status","P/L"].map(x=><th key={x} style={{padding:12,borderBottom:"1px solid #26313e"}}>{x}</th>)}</tr></thead><tbody><tr><td colSpan={6} style={{padding:18,opacity:.7}}>No contracts available yet.</td></tr></tbody></table></div></div></section>}
          {page === "history" && <section><div className="page-heading-row"><div><div className="eyebrow">CONTRACT RECORDS</div><h1>Trade History</h1><p className="subtitle">Settled real contracts and simulated virtual trades will be clearly separated.</p></div></div><div className="panel" style={{padding:20}}><h2>History status</h2><p>Broker-confirmed history will be loaded from the backend. Browser-only UI events are not presented as real contracts.</p></div></section>}
          {page === "risk" && <section><div className="page-heading-row"><div><div className="eyebrow">ACCOUNT PROTECTION</div><h1>Risk Controls</h1><p className="subtitle">Configure strategy-level limits in Strategy Builder. These frontend settings do not yet enforce broker-side controls.</p></div></div><div className="panel" style={{padding:20}}><div className="form-grid"><label>Current strategy initial stake<input readOnly value={draft.stake}/></label><label>Take profit<input readOnly value={draft.takeProfit}/></label><label>Stop loss<input readOnly value={draft.stopLoss}/></label><label>Maximum stake<input readOnly value={draft.maxStake}/></label><label>Max martingale steps<input readOnly value={draft.maxMartingaleSteps}/></label><label>Max concurrent trades<input readOnly value={draft.maxTrades}/></label></div><button className="primary-button" onClick={() => setPage("builder")}>Edit risk settings →</button></div></section>}
          {page === "bots" && <section className="bot-studio-page">
            <div className="page-heading-row"><div><div className="eyebrow">AUTOMATION STUDIO / VISUAL BUILDER</div><h1>Deriv Bot Studio</h1><p className="subtitle">Build a visual strategy or import a Deriv Bot Blockly XML file. Review detected blocks with Supa AI before execution is enabled.</p></div><span className="draft-pill">VISUAL PREVIEW · EXECUTION LOCKED</span></div>
            <div className="bot-studio-grid">
              <div className="bot-canvas panel">
                <div className="bot-canvas-head"><div><span className="eyebrow">BOT WORKSPACE</span><h2>Build your bot</h2></div><span className="canvas-zoom">100%</span></div>
                <div className="xml-import-panel">
                  <div className="xml-import-copy"><span className="xml-file-icon">XML</span><div><b>Import your Deriv Bot</b><p>Load a Blockly <code>.xml</code> file to inspect its blocks and preserve the original workspace.</p></div></div>
                  <input ref={xmlInputRef} className="xml-file-input" type="file" accept=".xml,application/xml,text/xml" onChange={e=>void handleBotXmlUpload(e.target.files?.[0])} aria-label="Upload Deriv Bot XML file" />
                  <div className="xml-import-actions"><button className="primary-button" disabled={xmlImportBusy} onClick={()=>xmlInputRef.current?.click()}>{xmlImportBusy ? "Reading XML…" : "↑ Upload bot XML"}</button>{importedBot && <button className="secondary-button" onClick={downloadImportedBotXml}>Download original XML</button>}{importedBot && <button className="secondary-button" onClick={()=>{setImportedBot(null);setXmlImportError("");setNotice("Imported XML cleared from this workspace.")}}>Clear import</button>}</div>
                  {xmlImportError && <div className="xml-import-error" role="alert">{xmlImportError}</div>}
                  {importedBot && <div className="xml-import-success" role="status"><b>✓ {importedBot.fileName}</b><span>{importedBot.blocks.length} blocks found · imported {new Date(importedBot.importedAt).toLocaleTimeString()}</span><small>The original XML is kept unchanged in this page session. Unknown or unsupported blocks are not executed.</small></div>}
                </div>
                <div className="bot-name-row"><label>Bot name<input value={botName} onChange={e=>setBotName(e.target.value)} aria-label="Bot name" /></label><label>Use strategy<select value={draft.id} onChange={e=>{const found=strategies.find(x=>x.id===e.target.value);if(found)setDraft(found)}}><option value={draft.id}>{draft.name || "Current draft"}</option>{strategies.filter(x=>x.id!==draft.id).map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select></label></div>
                <div className="block-workspace" aria-label="Visual strategy blocks">
                  <div className="flow-start">▶ START</div>
                  <div className="flow-connector"></div>
                  <article className="strategy-block block-market"><div className="block-label"><span className="block-icon">◉</span><div><small>BLOCK 01 · MARKET</small><b>Watch market</b></div><span className="block-menu">•••</span></div><label>Market<select value={marketSymbol} onChange={e=>{setMarketTicks([]);setMarketSymbol(e.target.value)}}>{marketSymbols.map(item=><option key={item.value} value={item.value}>{item.label}</option>)}</select></label><div className="block-hint">Uses the existing public Deriv tick stream.</div></article>
                  <div className="flow-connector"></div>
                  <article className="strategy-block block-condition"><div className="block-label"><span className="block-icon">◇</span><div><small>BLOCK 02 · CONDITION</small><b>Check digit frequency</b></div><span className="block-menu">•••</span></div><div className="block-fields"><label>Look back<input type="number" min="10" max="1000" value={draft.frequencyWindow} onChange={e=>updateDraft("frequencyWindow",Math.max(10,Math.min(1000,Number(e.target.value))))}/> ticks</label><label>Threshold<input type="number" min="0" max="100" step="0.1" value={draft.threshold} onChange={e=>updateDraft("threshold",Number(e.target.value))}/> %</label></div><div className="block-hint">Frequency is descriptive, not a prediction of the next digit.</div></article>
                  <div className="flow-connector"></div>
                  <article className="strategy-block block-entry"><div className="block-label"><span className="block-icon">⇢</span><div><small>BLOCK 03 · ENTRY RULE</small><b>Entry condition</b></div><span className="block-menu">•••</span></div><div className="block-fields"><label>Contract<select value={draft.contract} onChange={e=>updateDraft("contract",e.target.value as Strategy["contract"])}><option value="ODD">Matches — ODD</option><option value="EVEN">Matches — EVEN</option></select></label><label>Consecutive digits<input type="number" min="1" max="10" value={draft.sequenceLength} onChange={e=>updateDraft("sequenceLength",Math.max(1,Math.min(10,Number(e.target.value))))}/></label></div><div className="block-hint">This configures the rule summary only; it does not place a contract.</div></article>
                  <div className="flow-connector"></div>
                  <article className="strategy-block block-risk"><div className="block-label"><span className="block-icon">⬡</span><div><small>BLOCK 04 · RISK</small><b>Set safety limits</b></div><span className="block-menu">•••</span></div><div className="block-fields"><label>Stake<input type="number" min="0.35" step="0.01" value={draft.stake} onChange={e=>updateDraft("stake",Math.max(0.35,Number(e.target.value)))}/></label><label>Stop loss<input type="number" min="0" step="0.01" value={draft.stopLoss} onChange={e=>updateDraft("stopLoss",Math.max(0,Number(e.target.value)))}/></label><label>Take profit<input type="number" min="0" step="0.01" value={draft.takeProfit} onChange={e=>updateDraft("takeProfit",Math.max(0,Number(e.target.value)))}/></label><label>Max stake<input type="number" min="0.35" step="0.01" value={draft.maxStake} onChange={e=>updateDraft("maxStake",Math.max(0.35,Number(e.target.value)))}/></label></div></article>
                  <div className="flow-connector"></div><div className="flow-end">END · WAIT FOR NEXT TICK</div>
                </div>
                {importedBot && <section className="imported-blocks-panel"><div className="panel-heading"><div><h3>Imported XML block inventory</h3><p>Block types detected in the uploaded file; this is a structural preview, not a running Blockly engine.</p></div><span className="draft-pill">{importedBot.blocks.length} BLOCKS</span></div><div className="imported-block-list">{importedBot.blocks.slice(0,120).map((block,index)=><article className="imported-block-row" key={`${block.type}-${index}`}><span className="imported-block-number">{String(index+1).padStart(2,"0")}</span><div><b>{block.type}</b>{block.fields.length>0 && <small>{block.fields.slice(0,4).join(" · ")}</small>}</div><span className="imported-block-kind">{block.type.toLowerCase().includes("trade") || block.type.toLowerCase().includes("purchase") ? "TRADE" : block.type.toLowerCase().includes("contract") || block.type.toLowerCase().includes("market") ? "MARKET" : "BLOCK"}</span></article>)}{importedBot.blocks.length>120 && <p className="block-list-note">Showing the first 120 of {importedBot.blocks.length} detected blocks.</p>}</div></section>}
                <div className="bot-canvas-actions"><button className="secondary-button" onClick={()=>setPage("builder")}>Open full strategy builder ↗</button><button className="primary-button" onClick={()=>{setReviewOpen(true);setDraft({...draft,status:"Awaiting review"});}}>Review bot rules →</button></div>
              </div>
              <aside className="bot-studio-aside">
                <div className="panel bot-ai-panel"><div className="bot-ai-icon">✦</div><div className="eyebrow">SUPA AI ASSISTANT</div><h2>Explain your bot</h2><p>Use plain language to describe what you want this block flow to do. Supa AI's current instruction parser is heuristic, so verify every interpreted rule.</p><button className="secondary-button" onClick={()=>{setPage("builder");setMode("ai")}}>Open AI strategy builder →</button></div>
                <div className="panel bot-status-panel"><div className="panel-heading"><div><h2>Bot status</h2><p>Local interface state only</p></div><span className={`bot-state-dot ${botRunning?"on":"off"}`}></span></div><div className="bot-status-line"><span>Builder</span><b>Ready to review</b></div><div className="bot-status-line"><span>Deriv feed</span><b>{marketStatus === "live" ? "Connected" : marketStatus === "error" ? "Needs attention" : "Connecting"}</b></div><div className="bot-status-line"><span>Execution engine</span><b className="locked-text">Not connected</b></div><button className={botRunning?"secondary-button":"primary-button"} onClick={()=>{setBotRunning(!botRunning);setNotice(botRunning?"Bot preview stopped. No broker orders were sent.":"Preview flag enabled only. No trading engine is connected and no broker orders were sent.")}}>{botRunning?"■ Stop preview":"▶ Run visual preview"}</button><small className="bot-disclaimer">This button only toggles a local preview flag. It does not run a bot or place trades.</small></div>
                <div className="panel bot-library-panel"><h3>Block library</h3><p>Available block categories in this interface</p><div className="library-chip market-chip">◉ Market</div><div className="library-chip condition-chip">◇ Conditions</div><div className="library-chip entry-chip">⇢ Entry rules</div><div className="library-chip risk-chip">⬡ Risk controls</div><div className="library-chip ai-chip">✦ Supa AI</div></div>
              </aside>
            </div>
            <div className="panel bot-sharing-panel"><div><h2>Community bots</h2><p>Sharing preference is stored in this browser only. Publishing requires backend storage, validation, and moderation.</p></div><label><input type="checkbox" checked={communitySharing} onChange={e=>setCommunitySharing(e.target.checked)}/> Mark this bot for future community sharing</label></div>
          </section>}

          {page === "offline" && <section><div className="page-heading-row"><div><div className="eyebrow">BACKGROUND EXECUTION</div><h1>Offline Trading</h1><p className="subtitle">This mode can run while you are online or away once the background worker is implemented.</p></div><span className="draft-pill">WORKER REQUIRED</span></div><div className="panel" style={{padding:20,marginBottom:16}}><div className="panel-heading"><div><h2>Offline execution controls</h2><p>Enable the background-running preference independently of whether you close the dashboard.</p></div></div><div style={{display:"flex",gap:18,flexWrap:"wrap",alignItems:"center"}}><label style={{display:"flex",gap:10,alignItems:"center"}}><input type="checkbox" checked={offlineEnabled} onChange={e=>{setOfflineEnabled(e.target.checked);setNotice(e.target.checked?"Offline mode preference enabled locally. A background worker is required before it can execute while the browser is closed.":"Offline mode disabled.")}}/> <b>Offline Trading {offlineEnabled?"ON":"OFF"}</b></label><label style={{display:"flex",gap:10,alignItems:"center"}}><input type="checkbox" checked={virtualHook} onChange={e=>setVirtualHook(e.target.checked)}/> <b>Virtual Hook {virtualHook?"ON":"OFF"}</b></label><button className="secondary-button" onClick={()=>setBotRunning(false)} disabled={!botRunning}>Stop bot</button><button className="secondary-button" onClick={()=>{if(botRunning){setNotice("Stop the bot before resetting contract history.");return;}if(!window.confirm("Clear the last 100 contracts from this local view? Broker records and open contracts will not be deleted."))return;setOfflineContracts([]);setNotice("Local contract display cleared. Broker records are unchanged.")}} disabled={botRunning}>Reset contracts</button></div><div className="metrics-grid" style={{marginTop:18}}><Metric label="OFFLINE MODE" value={offlineEnabled?"ON":"OFF"} foot="Preference saved in this browser" icon="▣"/><Metric label="VIRTUAL HOOK" value={virtualHook?"ON":"OFF"} foot={virtualHook?"Virtual test before eligible real entry":"Virtual gate disabled"} icon="◎"/><Metric label="BOT STATUS" value={botRunning?"RUNNING":"STOPPED"} foot="Frontend preview state" icon="▶"/><Metric label="CONTRACT HISTORY" value={String(offlineContracts.length).padStart(2,"0")} foot="Maximum 100 displayed" icon="◷"/></div><p style={{marginTop:14,opacity:.75}}>This page currently demonstrates settings and history layout only. It does not run trades in the background until the worker and persistent database are connected.</p></div><div className="panel" style={{padding:20}}><div className="panel-heading"><div><h2>Last 100 contracts</h2><p>Most recent first · real and virtual records must be clearly labelled.</p></div></div><div style={{overflowX:"auto"}}><table style={{width:"100%",textAlign:"left",borderCollapse:"collapse"}}><thead><tr>{["Time","Market","Contract","Result","Mode","Profit/Loss"].map(x=><th key={x} style={{padding:12,borderBottom:"1px solid #26313e"}}>{x}</th>)}</tr></thead><tbody>{offlineContracts.length===0?<tr><td colSpan={6} style={{padding:18,opacity:.7}}>No contract records yet. Real records will appear after backend execution is connected.</td></tr>:offlineContracts.slice(-100).reverse().map(c=><tr key={c.id}>{[c.time,c.market,c.contract,c.result,c.mode,c.profit].map((v,i)=><td key={i} style={{padding:12,borderBottom:"1px solid #26313e"}}>{v}</td>)}</tr>)}</tbody></table></div></div></section>}

          {page === "settings" && <section><div className="page-heading-row"><div><div className="eyebrow">WORKSPACE</div><h1>Settings & connections</h1><p className="subtitle">Manage your account connection and trading preferences.</p></div></div><div className="settings-grid"><div className="panel setting-card"><div className="setting-title"><span className="setting-logo deriv-logo">D</span><div><h2>Deriv account</h2><p>Secure account authorization</p></div></div><p className="setting-description">Connect through Deriv's official authorization process. Supa AI will never ask for your Deriv password.</p><button className="primary-button" onClick={() => window.location.assign("/account")}>Choose account ↗</button></div></div></section>}


          {floatingDigitsOpen && <aside className="panel" style={{position:"fixed",right:24,bottom:24,zIndex:50,width:320,maxWidth:"calc(100vw - 32px)",padding:18,boxShadow:"0 16px 48px #0008"}}><div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}><h3 style={{margin:0}}>Floating digit analysis</h3><button className="icon-button" onClick={()=>setFloatingDigitsOpen(false)} aria-label="Close floating digit tool">×</button></div><p style={{fontSize:12,opacity:.7}}>Live data from the selected market; the latest 1,000 ticks are analysed.</p><div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:6}}>{frequencies.map(f=><div key={f.digit} style={{padding:"8px 4px",textAlign:"center",borderRadius:8,background:`${digitColors[f.digit] || "#202b38"}22`,border:`1px solid ${digitColors[f.digit] || "#394657"}`,color:digitColors[f.digit] || "inherit"}}><b>{f.digit}</b><div style={{fontSize:11}}>{f.percent.toFixed(0)}%</div></div>)}</div><p style={{fontSize:11,opacity:.7,marginBottom:0}}>Green/blue mark the highest frequencies; red/orange mark the lowest frequencies.</p></aside>}

          {reviewOpen && <div className="modal-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) setReviewOpen(false); }}><section className="review-modal panel" role="dialog" aria-modal="true" aria-labelledby="review-title"><div className="modal-heading"><div><div className="eyebrow">CONFIRMATION REQUIRED</div><h2 id="review-title">Review strategy rules</h2><p>Check every rule before saving. Nothing will be traded.</p></div><button className="icon-button" onClick={() => setReviewOpen(false)} aria-label="Close review">×</button></div><div className="review-warning"><span>!</span><p><b>Demo interface only.</b> The instruction parser is a simple heuristic, not a full AI model. Verify all rules manually.</p></div><div className="review-summary"><div><small>STRATEGY</small><b>{draft.name || "Untitled strategy"}</b></div><div><small>MARKET</small><b>{draft.market}</b></div><div><small>CONTRACT</small><b>{draft.contract}</b></div><div><small>FREQUENCY WINDOW</small><b>{draft.frequencyWindow} ticks</b></div><div><small>FREQUENCY THRESHOLD</small><b>{draft.threshold}%</b></div><div><small>MIN. QUALIFYING DIGITS</small><b>{draft.qualifyingDigits}</b></div><div><small>SEQUENCE</small><b>{draft.sequenceLength} consecutive digit(s)</b></div><div><small>SEQUENCE WINDOW</small><b>{draft.sequenceWindow} ticks</b></div><div><small>INITIAL STAKE</small><b>{draft.stake}</b></div><div><small>MARTINGALE</small><b>{draft.martingaleMultiplier}× · max {draft.maxMartingaleSteps} steps</b></div><div><small>TAKE PROFIT</small><b>{draft.takeProfit}</b></div><div><small>STOP LOSS</small><b>{draft.stopLoss}</b></div><div><small>MAXIMUM STAKE</small><b>{draft.maxStake}</b></div><div><small>MAX CONCURRENT TRADES</small><b>{draft.maxTrades}</b></div><div><small>VIRTUAL HOOK</small><b>{virtualHook?"ON":"OFF"}</b></div></div><div className="review-instructions"><small>ORIGINAL INSTRUCTIONS</small><p>{draft.instructions || "No natural-language instructions supplied."}</p></div><div className="modal-footer"><button className="secondary-button" onClick={() => { setReviewOpen(false); setPage("builder"); }}>Edit conditions</button><button className="secondary-button" onClick={() => saveStrategy(false)}>Save as draft</button><button className="primary-button" onClick={() => saveStrategy(true)}>Confirm & save <span>→</span></button></div></section></div>}
        </div>
        <footer className="footer"><span>SUPA AI <span className="footer-dot">•</span> TRADING INTELLIGENCE</span><span>Trade responsibly.</span></footer>
      </section>
      <style jsx global>{`
        .xml-import-panel{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:14px;align-items:center;margin:0 0 16px;padding:15px;background:#0d141b;border:1px solid #2a3a45;border-radius:12px}.xml-import-copy{display:flex;align-items:center;gap:12px;min-width:0}.xml-file-icon{display:grid;place-items:center;flex:0 0 42px;height:42px;border-radius:10px;background:#70e1bb18;border:1px solid #70e1bb50;color:#70e1bb;font-size:11px;font-weight:900}.xml-import-copy b{font-size:13px}.xml-import-copy p{margin:5px 0 0;color:#91a4af;font-size:11px;line-height:1.5}.xml-import-copy code{color:#b5ffe6}.xml-file-input{display:none}.xml-import-actions{grid-column:1/-1;display:flex;gap:8px;flex-wrap:wrap}.xml-import-actions button{min-height:38px}.xml-import-error{grid-column:1/-1;border:1px solid #653238;background:#321f22;color:#ffb3b3;border-radius:8px;padding:10px;font-size:12px}.xml-import-success{grid-column:1/-1;display:flex;flex-direction:column;gap:5px;padding:11px 12px;border-radius:8px;border:1px solid #286650;background:#10271f;color:#b5ffe6;font-size:12px}.xml-import-success span,.xml-import-success small{color:#91b5a8}.imported-blocks-panel{margin-top:16px;padding:16px;border:1px solid #2a3946;border-radius:12px;background:#0e151c}.imported-block-list{display:grid;gap:7px;max-height:430px;overflow:auto}.imported-block-row{display:flex;align-items:center;gap:10px;padding:10px;border:1px solid #2a3946;background:#131d26;border-radius:8px;min-width:0}.imported-block-number{font-size:10px;color:#8094a1;font-family:monospace}.imported-block-row>div{display:flex;flex-direction:column;gap:4px;min-width:0;flex:1}.imported-block-row b{font-size:11px;overflow-wrap:anywhere}.imported-block-row small{font-size:10px;color:#91a4af;overflow-wrap:anywhere}.imported-block-kind{font-size:9px;letter-spacing:.08em;color:#70e1bb;border:1px solid #355b50;padding:4px 6px;border-radius:5px}.block-list-note{font-size:11px;color:#91a4af}
        .market-error{color:#b42318;background:#fff1f0;border:1px solid #ffd5d2;padding:10px 12px;border-radius:10px;margin:12px 0;font-size:13px}

        .market-monitor-panel{padding:20px}.market-controls{display:grid;grid-template-columns:minmax(220px,2fr) repeat(3,minmax(120px,1fr));gap:14px;align-items:end;margin-bottom:22px}
        .price-chart-panel{border:1px solid var(--line,#26313e);border-radius:16px;padding:18px;margin:4px 0 22px;background:linear-gradient(145deg,rgba(32,185,129,.045),rgba(20,28,40,.18))}.price-chart-heading{display:flex;align-items:flex-start;justify-content:space-between;gap:16px}.chart-overline{font-size:10px;letter-spacing:.13em;font-weight:800;color:#8d9aaa}.price-chart-heading h2{font-size:27px;margin:8px 0 4px;font-variant-numeric:tabular-nums}.price-chart-heading small{color:var(--muted,#8d9aaa)}.price-change{font-weight:800;text-align:right;font-variant-numeric:tabular-nums}.price-change small{display:block;font-size:10px;color:var(--muted,#8d9aaa);font-weight:600;margin-top:5px}.price-change.positive{color:#20b981}.price-change.negative{color:#ef5350}.price-chart-visual{height:210px;position:relative;margin-top:12px;overflow:hidden}.price-chart-visual svg{width:100%;height:100%;overflow:visible}.chart-grid-line{stroke:rgba(140,155,175,.16);stroke-width:1;stroke-dasharray:4 6}.price-line{fill:none;stroke:#20b981;stroke-width:3;vector-effect:non-scaling-stroke;stroke-linecap:round;stroke-linejoin:round}.chart-waiting{position:absolute;inset:0;display:grid;place-items:center;color:var(--muted,#8d9aaa);font-size:13px}.price-chart-footer{display:flex;gap:26px;flex-wrap:wrap;border-top:1px solid var(--line,#26313e);padding-top:12px;color:var(--muted,#8d9aaa);font-size:10px;letter-spacing:.08em}.price-chart-footer b{display:block;color:var(--text,#edf2f7);font-size:13px;letter-spacing:0;margin-top:5px;font-variant-numeric:tabular-nums}
        .market-controls label{display:flex;flex-direction:column;gap:8px;font-size:12px;font-weight:700}.market-controls select{min-height:42px;border:1px solid #dfe5ee;border-radius:10px;padding:0 12px;background:white;color:inherit}
        .tick-stat{display:flex;flex-direction:column;gap:7px;border:1px solid #e7ebf2;border-radius:10px;padding:10px 12px;min-height:62px;justify-content:center}.tick-stat small{font-size:10px;opacity:.65;letter-spacing:.06em}.tick-stat strong{font-size:15px;overflow-wrap:anywhere}
        .digit-grid{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:12px;margin:16px 0 26px}.digit-card{border:1px solid;border-radius:12px;padding:13px;min-width:0}.digit-card-top{display:flex;justify-content:space-between;align-items:center;margin-bottom:10px}
        .digit-card-top span,.digit-card small{font-size:11px;opacity:.65}.digit-card-top b{font-size:22px}.digit-card>strong{display:block;font-size:21px}.digit-progress{height:5px;background:#eef1f6;border-radius:99px;overflow:hidden;margin-top:12px}.digit-progress span{display:block;height:100%;border-radius:99px}
        .recent-ticks{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}.recent-tick{display:flex;align-items:center;gap:10px;border:1px solid #edf0f5;border-radius:9px;padding:8px 10px;min-width:0}
        .recent-tick small{opacity:.65;font-size:10px}.recent-tick strong{margin-left:auto;font-size:12px;overflow:hidden;text-overflow:ellipsis}.recent-tick span{display:inline-grid;place-items:center;width:22px;height:22px;border-radius:6px;color:white;font-size:12px;font-weight:800}
        @media(max-width:760px){.app-shell{display:flex!important;flex-direction:column!important;min-height:100vh}.sidebar{width:100%!important;min-width:0!important;position:sticky;top:0;z-index:50;padding:10px 12px!important}.brand-lockup{display:none!important}
        .workspace-label{padding:4px 8px 8px!important;font-size:10px!important;letter-spacing:.12em}.sidebar-nav{display:flex!important;flex-direction:row!important;gap:8px!important;overflow-x:auto!important;overflow-y:hidden;white-space:nowrap;padding:0 0 8px;scrollbar-width:thin;-webkit-overflow-scrolling:touch}
        .nav-item{flex:0 0 auto!important;width:auto!important;min-width:max-content;padding:10px 12px!important}.sidebar-bottom{display:none!important}.main-area{width:100%!important;min-width:0!important}
        .topbar{padding:10px 12px!important;gap:8px;flex-wrap:wrap}.top-actions{gap:6px!important;flex-wrap:wrap}.page-content{padding:14px!important}.page-heading-row{align-items:flex-start!important;flex-direction:column!important;gap:12px}
        .metrics-grid,.lower-grid{grid-template-columns:1fr!important}.market-controls{grid-template-columns:1fr 1fr}.digit-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.recent-ticks{grid-template-columns:1fr 1fr}.builder-layout{grid-template-columns:1fr!important}.footer{padding:12px!important}}
        @media(max-width:420px){.market-controls,.recent-ticks{grid-template-columns:1fr}.account-mode-button{font-size:10px!important;padding:6px 8px!important}}
        /* Supa AI terminal + visual bot studio refresh */
        .terminal-panel{background:linear-gradient(145deg,#111a23,#0f151d);border-color:#263846!important;color:#e8eef4}
        .terminal-toolbar{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:2px 0 18px;margin-bottom:18px;border-bottom:1px solid #26313c}
        .terminal-market-title{display:flex;align-items:center;gap:11px}.terminal-market-title b,.terminal-market-title small{display:block}.terminal-market-title b{font-size:14px}.terminal-market-title small{font-size:11px;color:#8b9aa8;margin-top:4px}
        .terminal-status{width:9px;height:9px;border-radius:50%;background:#f4c36d;box-shadow:0 0 0 4px #f4c36d18}.terminal-status.live{background:#70e1bb;box-shadow:0 0 0 4px #70e1bb18}.terminal-status.error{background:#ff8e8e;box-shadow:0 0 0 4px #ff8e8e18}
        .terminal-tags{display:flex;gap:7px;flex-wrap:wrap}.terminal-tags span{border:1px solid #304150;border-radius:7px;padding:6px 8px;color:#91a6b5;font-size:9px;letter-spacing:.08em;font-weight:800}
        .terminal-panel .market-controls select{background:#121d27;border-color:#304150;color:#e8eef4}.terminal-panel .tick-stat{background:#141e28;border-color:#2a3946}.terminal-panel .digit-card{background:#141e28}.terminal-panel .digit-progress{background:#26313c}.terminal-panel .recent-tick{background:#141e28;border-color:#2a3946}.terminal-panel .market-error{background:#321f22;color:#ffb3b3;border-color:#653238}
        .bot-studio-grid{display:grid;grid-template-columns:minmax(0,1.7fr) minmax(270px,.8fr);gap:16px;align-items:start}.bot-canvas{padding:20px;background:radial-gradient(ellipse at 15% 0%,#17332f 0%,#111820 42%);border-color:#2c403f!important;min-width:0}.bot-canvas-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:18px}.bot-canvas-head h2{margin:5px 0 0}.canvas-zoom{border:1px solid #304150;border-radius:8px;padding:7px 10px;color:#9badba;font-size:11px}
        .bot-name-row{display:grid;grid-template-columns:1fr 1fr;gap:12px;padding:14px;background:#0d141b;border:1px solid #293a43;border-radius:12px;margin-bottom:18px}.bot-name-row label,.strategy-block label{display:flex;flex-direction:column;gap:7px;font-size:11px;color:#aebbc6;font-weight:700}.bot-name-row input,.bot-name-row select,.strategy-block input,.strategy-block select{min-width:0;width:100%;min-height:38px;padding:8px 10px;background:#111b24;color:#e8eef4;border:1px solid #344653;border-radius:8px}.block-workspace{padding:16px 12px;background-color:#0b1117;background-image:radial-gradient(#2a3a44 1px,transparent 1px);background-size:18px 18px;border:1px solid #263642;border-radius:12px;overflow:hidden}
        .flow-start,.flow-end{width:max-content;max-width:100%;margin:0 auto;padding:9px 18px;border-radius:99px;background:#1b5b4a;border:1px solid #317e68;color:#b5ffe6;font-size:10px;font-weight:900;letter-spacing:.1em;text-align:center}.flow-end{background:#1a2630;border-color:#3a4b58;color:#b5c2cd}.flow-connector{width:2px;height:22px;margin:0 auto;background:#526b78;position:relative}.flow-connector:after{content:"";position:absolute;bottom:-1px;left:-4px;border-left:5px solid transparent;border-right:5px solid transparent;border-top:6px solid #526b78}
        .strategy-block{max-width:480px;margin:0 auto;padding:14px;border:1px solid #36514f;border-left:4px solid #70e1bb;border-radius:10px;background:#14211f;box-shadow:0 8px 22px #0002}.block-condition{border-color:#4b4261;border-left-color:#bba0ff;background:#1c1a29}.block-entry{border-color:#4d4530;border-left-color:#f4c36d;background:#211f18}.block-risk{border-color:#354e65;border-left-color:#86b9ff;background:#15202b}.block-label{display:flex;align-items:center;gap:10px;margin-bottom:13px}.block-label>div{display:flex;flex-direction:column;gap:4px;min-width:0}.block-label small{font-size:9px;letter-spacing:.09em;color:#94a7b2}.block-label b{font-size:13px;color:#f1f5f8}.block-icon{display:grid;place-items:center;flex:0 0 31px;width:31px;height:31px;border-radius:8px;background:#70e1bb1b;color:#70e1bb;font-size:16px}.block-condition .block-icon{background:#bba0ff1b;color:#bba0ff}.block-entry .block-icon{background:#f4c36d1b;color:#f4c36d}.block-risk .block-icon{background:#86b9ff1b;color:#86b9ff}.block-menu{margin-left:auto;color:#7f929e;letter-spacing:2px}.block-fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.block-hint{font-size:10px;color:#91a4af;line-height:1.5;margin-top:11px}.bot-canvas-actions{display:flex;justify-content:flex-end;gap:10px;flex-wrap:wrap;margin-top:16px}.bot-studio-aside{display:grid;gap:14px;min-width:0}.bot-ai-panel,.bot-status-panel,.bot-library-panel{padding:18px;background:#111820;border-color:#263642!important}.bot-ai-icon{display:grid;place-items:center;width:38px;height:38px;border-radius:11px;background:#70e1bb20;color:#70e1bb;font-size:20px;margin-bottom:14px}.bot-ai-panel h2{margin:7px 0}.bot-ai-panel p,.bot-library-panel p{font-size:12px;color:#9aabb7;line-height:1.65}.bot-ai-panel .secondary-button{width:100%;margin-top:7px}.bot-status-line{display:flex;justify-content:space-between;gap:12px;padding:12px 0;border-bottom:1px solid #25323d;font-size:11px}.bot-status-line span{color:#8b9aa8}.bot-status-line b{font-size:11px;text-align:right}.locked-text{color:#f4c36d}.bot-state-dot{width:9px;height:9px;border-radius:50%;background:#637381}.bot-state-dot.on{background:#70e1bb;box-shadow:0 0 0 4px #70e1bb18}.bot-status-panel>button{width:100%;margin-top:16px}.bot-disclaimer{display:block;color:#8295a2;line-height:1.5;font-size:10px;margin-top:10px}.bot-library-panel h3{margin:0}.library-chip{padding:9px 10px;border-radius:8px;border:1px solid #344653;background:#141e28;margin-top:7px;font-size:11px;font-weight:700}.market-chip{color:#70e1bb}.condition-chip{color:#bba0ff}.entry-chip{color:#f4c36d}.risk-chip{color:#86b9ff}.ai-chip{color:#e3d5ff}.bot-sharing-panel{margin-top:16px;padding:18px;display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap}.bot-sharing-panel h2{margin:0 0 6px}.bot-sharing-panel p{margin:0;color:#91a1ad;font-size:12px}.bot-sharing-panel label{display:flex;align-items:center;gap:8px;font-size:12px}
        @media(max-width:900px){.bot-studio-grid{grid-template-columns:1fr}.bot-studio-aside{grid-template-columns:repeat(2,minmax(0,1fr))}.bot-library-panel{grid-column:1/-1}}
        @media(max-width:760px){.sidebar-nav{display:flex!important;flex-direction:row!important;gap:7px!important;overflow-x:auto!important;overflow-y:hidden!important;white-space:nowrap;padding:0 0 7px!important;scrollbar-width:thin;-webkit-overflow-scrolling:touch}.sidebar-nav .nav-item{flex:0 0 auto!important;width:auto!important;min-width:max-content;padding:10px 12px!important}.workspace-label{white-space:nowrap}.terminal-toolbar{align-items:flex-start;flex-direction:column}.bot-studio-aside{grid-template-columns:1fr}.bot-library-panel{grid-column:auto}.bot-name-row{grid-template-columns:1fr}.bot-canvas{padding:13px}.block-workspace{padding:12px 7px}.strategy-block{padding:11px}.bot-canvas-actions>*{flex:1 1 100%}}
        @media(max-width:420px){.block-fields{grid-template-columns:1fr}.terminal-tags span{font-size:8px}.bot-sharing-panel label{align-items:flex-start}}
      `}</style>
    </main>
  );
}

function Metric({ label, value, foot, icon, positive = false }: { label: string; value: string; foot: string; icon: string; positive?: boolean }) {
  return <div className="metric-card panel"><div className="metric-top"><span>{label}</span><i>{icon}</i></div><div className={`metric-value ${positive ? "positive" : ""}`}>{value}</div><div className="metric-foot">{foot}</div></div>;
}

function PlaceholderPage({ title, description, icon, action, onAction }: { title: string; description: string; icon: string; action?: string; onAction?: () => void }) {
  return <section><div className="page-heading-row"><div><div className="eyebrow">SUPA AI WORKSPACE</div><h1>{title}</h1><p className="subtitle">{description}</p></div></div><div className="panel placeholder-panel"><div className="placeholder-icon">{icon}</div><h2>{title}</h2><p>{description}</p>{action && <button className="primary-button" onClick={onAction}>{action} →</button>}</div></section>;
}
