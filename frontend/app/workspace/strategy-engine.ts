export type Digit = 0|1|2|3|4|5|6|7|8|9;
export type ContractSide = "ODD" | "EVEN";
export type Tick = { quote: number; digit: Digit; epoch: number };
export type MarketDefinition = { symbol: string; label: string };
export type MarketAnalysis = {
  symbol: string; label: string; sampleSize: number;
  digitCounts: number[]; digitPercents: number[];
  oddPercent: number; evenPercent: number;
  leastFrequentEvenDigit: Digit | null;
  qualifyingOddDigits: Digit[];
  eligible: boolean; reasons: string[];
};
export type StrategyConfig = {
  window: number;
  evenDigitMaxPercent: number; // every even digit must be strictly below this
  oddDigitMinPercent: number;  // at least qualifyingOddCount odd digits must meet this
  qualifyingOddCount: number;
  sequenceWindow: number;      // ticks after least-frequent even digit appears
  consecutiveOddCount: number; // adjacent odd digits required
  contract: ContractSide;
  stake: number;
  maxStake: number;
  stopLoss: number;             // session loss limit in account currency
  takeProfit: number;           // session profit target in account currency
  maxConsecutiveLosses: number;
  martingaleEnabled: boolean;
  martingaleMultiplier: number;
  maxMartingaleSteps: number;
  virtualHookEnabled: boolean;
  maxTradesPerSession: number;
};
export type TradeSignal = {
  id: string; symbol: string; label: string; contract: ContractSide;
  stake: number; triggeredAt: number; triggerDigit: Digit;
  explanation: string; mode: "VIRTUAL" | "LIVE_CANDIDATE";
};
export type EngineState = {
  status: "STOPPED" | "SCANNING" | "PAUSED_RISK" | "WAITING_VIRTUAL";
  activeSymbol: string | null;
  sessionProfit: number;
  consecutiveLosses: number;
  tradesThisSession: number;
  martingaleStep: number;
  virtualGateOpen: boolean;
  lastSignal: TradeSignal | null;
  log: string[];
};
export const DEFAULT_CONFIG: StrategyConfig = {
  window: 1000,
  evenDigitMaxPercent: 10,
  oddDigitMinPercent: 10.5,
  qualifyingOddCount: 3,
  sequenceWindow: 5,
  consecutiveOddCount: 2,
  contract: "ODD",
  stake: 0.5,
  maxStake: 10,
  stopLoss: 5,
  takeProfit: 5,
  maxConsecutiveLosses: 3,
  martingaleEnabled: false,
  martingaleMultiplier: 2,
  maxMartingaleSteps: 3,
  virtualHookEnabled: true,
  maxTradesPerSession: 50
};

export function normalizeLastDigit(quote: string | number, pipSize: number): Digit | null {
  const value = Number(quote);
  if (!Number.isFinite(value) || !Number.isInteger(pipSize) || pipSize < 0 || pipSize > 10) return null;
  const fixed = value.toFixed(pipSize);
  const fractional = fixed.includes(".") ? fixed.split(".")[1] : "";
  const character = fractional.length ? fractional[fractional.length - 1] : fixed.slice(-1);
  const digit = Number(character);
  return Number.isInteger(digit) && digit >= 0 && digit <= 9 ? digit as Digit : null;
}

export function analyzeMarket(
  market: MarketDefinition,
  ticks: Tick[],
  config: StrategyConfig
): MarketAnalysis {
  const windowTicks = ticks.slice(-Math.min(1000, Math.max(1, config.window)));
  const counts = Array(10).fill(0) as number[];
  for (const tick of windowTicks) counts[tick.digit] += 1;
  const n = windowTicks.length;
  const percentages = counts.map(count => n ? (count / n) * 100 : 0);
  const evenDigits = [0, 2, 4, 6, 8] as const;
  const oddDigits = [1, 3, 5, 7, 9] as const;
  const evenPercent = n ? windowTicks.filter(t => t.digit % 2 === 0).length / n * 100 : 0;
  const oddPercent = n ? 100 - evenPercent : 0;
  const leastEven = [...evenDigits].sort((a,b) => counts[a] - counts[b] || a - b)[0];
  const qualifyingOddDigits = oddDigits.filter(digit => percentages[digit] >= config.oddDigitMinPercent);
  const evenRule = n >= config.window && evenDigits.every(digit => percentages[digit] < config.evenDigitMaxPercent);
  const oddRule = n >= config.window && qualifyingOddDigits.length >= config.qualifyingOddCount;
  const reasons: string[] = [];
  if (n < config.window) reasons.push(`Need ${config.window - n} more ticks before evaluating the full window.`);
  if (n >= config.window && !evenRule) reasons.push(`Not all even digits are below ${config.evenDigitMaxPercent}%.`);
  if (n >= config.window && !oddRule) reasons.push(`Only ${qualifyingOddDigits.length} odd digits meet ${config.oddDigitMinPercent}%; need ${config.qualifyingOddCount}.`);
  if (n >= config.window && evenRule && oddRule) reasons.push("All frequency requirements currently match.");
  return {
    symbol: market.symbol, label: market.label, sampleSize: n,
    digitCounts: counts, digitPercents: percentages, oddPercent, evenPercent,
    leastFrequentEvenDigit: n ? leastEven : null,
    qualifyingOddDigits, eligible: Boolean(n >= config.window && evenRule && oddRule), reasons
  };
}

type SequenceWatch = { digit: Digit; ticksRemaining: number; previousWasOdd: boolean; startedAt: number };
export class StrategyEngine {
  readonly config: StrategyConfig;
  private histories = new Map<string, Tick[]>();
  private markets = new Map<string, MarketDefinition>();
  private sequenceWatches = new Map<string, SequenceWatch | null>();
  private lastTickKey = new Map<string, string>();
  private pendingVirtualSignal: TradeSignal | null = null;
  private state: EngineState = {
    status: "STOPPED", activeSymbol: null, sessionProfit: 0, consecutiveLosses: 0,
    tradesThisSession: 0, martingaleStep: 0, virtualGateOpen: true, lastSignal: null, log: []
  };
  constructor(config: StrategyConfig = DEFAULT_CONFIG) {
    this.config = { ...config };
    this.validateConfig();
  }
  private validateConfig() {
    const c = this.config;
    if (!Number.isFinite(c.stake) || c.stake <= 0) throw new Error("Stake must be greater than zero.");
    if (!Number.isFinite(c.maxStake) || c.maxStake < c.stake) throw new Error("Maximum stake must be at least the initial stake.");
    if (!Number.isFinite(c.stopLoss) || c.stopLoss <= 0) throw new Error("Stop-loss must be greater than zero.");
    if (!Number.isFinite(c.takeProfit) || c.takeProfit <= 0) throw new Error("Take-profit must be greater than zero.");
    if (c.window < 1 || c.window > 1000) throw new Error("Tick window must be between 1 and 1,000.");
    if (c.evenDigitMaxPercent <= 0 || c.evenDigitMaxPercent > 100) throw new Error("Even-digit threshold is invalid.");
    if (c.oddDigitMinPercent < 0 || c.oddDigitMinPercent > 100) throw new Error("Odd-digit threshold is invalid.");
    if (c.sequenceWindow < c.consecutiveOddCount || c.sequenceWindow > 100) throw new Error("Sequence window must be at least the consecutive-digit count.");
    if (c.maxConsecutiveLosses < 1 || c.maxTradesPerSession < 1) throw new Error("Trade and loss limits must be positive.");
    if (c.martingaleMultiplier < 1 || c.maxMartingaleSteps < 0) throw new Error("Martingale configuration is invalid.");
  }
  getState(): EngineState { return { ...this.state, log: [...this.state.log] }; }
  getHistory(symbol: string): Tick[] { return [...(this.histories.get(symbol) || [])]; }
  getAnalyses(): MarketAnalysis[] {
    return [...this.markets.values()].map(m => analyzeMarket(m, this.histories.get(m.symbol) || [], this.config))
      .sort((a,b) => Number(b.eligible)-Number(a.eligible) || b.qualifyingOddDigits.length-a.qualifyingOddDigits.length || b.sampleSize-a.sampleSize);
  }
  start(markets: MarketDefinition[]) {
    this.markets = new Map(markets.map(m => [m.symbol,m]));
    this.state.status = "SCANNING";
    this.state.activeSymbol = null;
    this.addLog(`Scanner started for ${markets.length} markets. Waiting for ${this.config.window} valid ticks per candidate.`);
  }
  stop(reason = "Scanner stopped by trader.") {
    this.state.status = "STOPPED";
    this.addLog(reason);
  }
  seedHistory(symbol: string, ticks: Tick[]) {
    this.histories.set(symbol, ticks.slice(-1000));
    this.sequenceWatches.set(symbol, null);
    if (ticks.length) this.lastTickKey.set(symbol, `${ticks[ticks.length-1].epoch}:${ticks[ticks.length-1].quote}`);
  }
  onTick(symbol: string, tick: Tick): TradeSignal | null {
    if (this.state.status === "STOPPED" || this.state.status === "PAUSED_RISK") return null;
    const key = `${tick.epoch}:${tick.quote}`;
    if (this.lastTickKey.get(symbol) === key) return null;
    this.lastTickKey.set(symbol,key);
    // Virtual Hook contracts are settled against the next observed tick for the selected market.
    // This is a directional simulation only; it is not a broker-confirmed payout.
    if (this.pendingVirtualSignal && this.pendingVirtualSignal.symbol === symbol &&
        tick.epoch > this.pendingVirtualSignal.triggeredAt) {
      const won = this.pendingVirtualSignal.contract === "ODD" ? tick.digit % 2 === 1 : tick.digit % 2 === 0;
      this.pendingVirtualSignal = null;
      this.recordResult(won ? 1 : -1, true);
    }
    const history = [...(this.histories.get(symbol) || []), tick].slice(-1000);
    this.histories.set(symbol, history);
    const market = this.markets.get(symbol);
    if (!market) return null;
    const analysis = analyzeMarket(market, history, this.config);

    // While a contract is open, caller must not switch market mid-contract.
    // This engine emits entry candidates only; a connected executor must manage open contracts.
    if (!analysis.eligible) {
      this.sequenceWatches.set(symbol, null);
      if (this.state.activeSymbol === symbol) {
        this.state.activeSymbol = null;
        this.addLog(`${market.label} no longer meets the frequency filters. Stop new entries here; let any open contract settle, then rescan.`);
      }
      return null;
    }

    if (this.state.activeSymbol !== symbol) {
      // Deterministic first eligible market; do not change market while another contract is open.
      if (this.state.activeSymbol) return null;
      this.state.activeSymbol = symbol;
      this.addLog(`${market.label} currently satisfies the configured frequency filters.`);
    }

    let watch = this.sequenceWatches.get(symbol) || null;
    if (watch) {
      if (tick.epoch <= watch.startedAt) return null;
      watch.ticksRemaining -= 1;
      if (tick.digit % 2 === 1) {
        if (watch.previousWasOdd) {
          this.sequenceWatches.set(symbol, null);
          if (this.state.tradesThisSession >= this.config.maxTradesPerSession) {
            this.state.status = "PAUSED_RISK";
            this.addLog("Maximum trades per session reached.");
            return null;
          }
          if (this.state.sessionProfit <= -Math.abs(this.config.stopLoss)) {
            this.state.status = "PAUSED_RISK"; this.addLog("Stop-loss reached; no new entries."); return null;
          }
          if (this.state.sessionProfit >= Math.abs(this.config.takeProfit)) {
            this.state.status = "PAUSED_RISK"; this.addLog("Take-profit reached; no new entries."); return null;
          }
          const virtualMode = this.config.virtualHookEnabled && !this.state.virtualGateOpen;
          const step = this.config.martingaleEnabled ? Math.min(this.state.martingaleStep,this.config.maxMartingaleSteps) : 0;
          const stake = Math.min(this.config.maxStake, this.config.martingaleEnabled ? this.config.stake * Math.pow(this.config.martingaleMultiplier,step) : this.config.stake);
          const signal: TradeSignal = {
            id: `${symbol}-${tick.epoch}-${tick.digit}`, symbol, label: market.label,
            contract: this.config.contract, stake, triggeredAt: tick.epoch, triggerDigit: tick.digit,
            explanation: `Frequency rules met; least-frequent even digit ${watch.digit} appeared, then ${this.config.consecutiveOddCount} consecutive odd digits appeared within ${this.config.sequenceWindow} ticks.`,
            mode: virtualMode ? "VIRTUAL" : "LIVE_CANDIDATE"
          };
          this.state.lastSignal = signal;
          this.state.tradesThisSession += 1;
          if (virtualMode) this.pendingVirtualSignal = signal;
          this.addLog(`${virtualMode ? "VIRTUAL signal" : "LIVE candidate"} on ${market.label}; stake plan ${stake.toFixed(2)}.`);
          return signal;
        }
        watch.previousWasOdd = true;
      } else watch.previousWasOdd = false;
      if (watch.ticksRemaining <= 0) {
        this.sequenceWatches.set(symbol,null);
        this.addLog(`Sequence window expired on ${market.label}; waiting for the least-frequent even digit again.`);
      } else this.sequenceWatches.set(symbol,watch);
      return null;
    }

    const leastEven = analysis.leastFrequentEvenDigit;
    if (leastEven !== null && tick.digit === leastEven) {
      this.sequenceWatches.set(symbol, { digit: leastEven, ticksRemaining: this.config.sequenceWindow, previousWasOdd: false, startedAt: tick.epoch });
      this.addLog(`${market.label}: least-frequent even digit ${leastEven} appeared; watching the next ${this.config.sequenceWindow} ticks.`);
    }
    return null;
  }
  recordResult(profit: number, isVirtual: boolean) {
    if (!Number.isFinite(profit)) return;
    if (isVirtual) {
      // Virtual results only operate the hook gate; they never change real session P/L,
      // the real loss streak, or the real martingale progression.
      if (this.config.virtualHookEnabled && !this.state.virtualGateOpen) {
        if (profit > 0) {
          this.state.virtualGateOpen = true;
          this.state.status = "SCANNING";
          this.addLog("Virtual Hook recorded a simulated win; live-candidate gate re-opened. No broker balance changed.");
        } else {
          this.addLog("Virtual Hook recorded a simulated loss; remain in virtual-only mode.");
        }
      } else {
        this.addLog(`Virtual result recorded (${profit > 0 ? "win" : profit < 0 ? "loss" : "break-even"}); real session P/L unchanged.`);
      }
      return;
    }
    this.state.sessionProfit += profit;
    if (profit < 0) {
      this.state.consecutiveLosses += 1;
      if (this.config.martingaleEnabled) this.state.martingaleStep = Math.min(this.state.martingaleStep + 1,this.config.maxMartingaleSteps);
      if (this.config.virtualHookEnabled) {
        this.state.virtualGateOpen = false;
        this.state.status = "WAITING_VIRTUAL";
        this.addLog("Loss recorded. Virtual Hook is active: next signals are simulated until a virtual win.");
      }
    } else if (profit > 0) {
      this.state.consecutiveLosses = 0;
      this.state.martingaleStep = 0;
    }
    if (this.state.consecutiveLosses >= this.config.maxConsecutiveLosses) {
      this.state.status = "PAUSED_RISK";
      this.addLog(`Stopped after ${this.config.maxConsecutiveLosses} consecutive losses.`);
    }
    if (this.state.sessionProfit <= -Math.abs(this.config.stopLoss)) {
      this.state.status = "PAUSED_RISK"; this.addLog("Session stop-loss reached.");
    }
    if (this.state.sessionProfit >= Math.abs(this.config.takeProfit)) {
      this.state.status = "PAUSED_RISK"; this.addLog("Session take-profit reached.");
    }
  }
  resumeAfterReview() {
    if (this.state.status === "PAUSED_RISK") {
      this.state.status = "SCANNING";
      this.addLog("Scanner resumed manually after risk review.");
    }
  }
  private addLog(message: string) {
    this.state.log = [`${new Date().toLocaleTimeString()} · ${message}`, ...this.state.log].slice(0,100);
  }
}
