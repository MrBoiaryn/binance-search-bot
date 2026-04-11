import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { BinanceSocketService } from './services/binance';
import { forkJoin, map, catchError, of, mergeMap, toArray, from, delay } from 'rxjs';
import { TradeStorageService } from './services/trade-storage.service';
import { FormsModule } from '@angular/forms';
import { HistoricalLog, PatternContext, ScannerSettings, TradeSignal } from './models/models';
import { Header } from './components/header/header';
import { SignalCard } from './components/signal-card/signal-card';
import { HistoryTable } from './components/history-table/history-table';
import * as Detectors from './constants/pattern-detectors';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, FormsModule, Header, SignalCard, HistoryTable],
  templateUrl: './app.html',
  styleUrls: ['./app.scss']
})
export class App implements OnInit {
  activeSignals: Map<string, TradeSignal> = new Map();
  signalsList: TradeSignal[] = [];
  lastSignalsHistory: HistoricalLog[] = [];

  klineHistory: Map<string, any[]> = new Map();
  volumeAverages: Map<string, number> = new Map();
  liquidationsCurrentMin: Map<string, number> = new Map();

  private removalTimeouts: Map<string, any> = new Map();
  private socketSub: any;
  private symbolQuotes: Map<string, string> = new Map();

  settings: ScannerSettings = {
    marketType: 'futures',
    timeframe: '1m',
    volumeThreshold: 2.5,
    swingPeriod: 10,
    minLiquidation: 1000,
    minRR: 1.5,
    soundEnabled: true,
    holdStale: true,
    showLong: true,
    showShort: true,
  };

  constructor(
    private socketService: BinanceSocketService,
    private cdr: ChangeDetectorRef,
    private storage: TradeStorageService,
  ) {}

  ngOnInit() {
    this.loadInitialConfig();
    this.startScanner();
  }

  private loadInitialConfig() {
    const saved = this.storage.loadSettings();
    if (saved) this.settings = { ...this.settings, ...saved };
    this.lastSignalsHistory = this.storage.loadHistory();
  }

  onSettingsUpdated(newSettings: ScannerSettings) {
    const needsRestart = newSettings.marketType !== this.settings.marketType ||
      newSettings.timeframe !== this.settings.timeframe;

    this.settings = newSettings;
    this.storage.saveSettings(newSettings);

    if (needsRestart) {
      this.resetScannerState();
      this.startScanner();
    } else {
      this.updateUI();
    }
  }

  private resetScannerState() {
    if (this.socketSub) this.socketSub.unsubscribe();
    this.activeSignals.clear();
    this.signalsList = [];
    this.klineHistory.clear();
    this.volumeAverages.clear();
    this.liquidationsCurrentMin.clear();
  }

  // --- ІНІЦІАЛІЗАЦІЯ СКАНЕРА ---

  startScanner() {
    console.log(`📡 [SYSTEM] Starting ${this.settings.marketType} scanner...`);

    this.socketService.getExchangeInfo(this.settings.marketType).subscribe(info => {
      this.mapSymbolQuotes(info.symbols);
      this.loadMarketData();
    });
  }

  private mapSymbolQuotes(symbols: any[]) {
    symbols.forEach(s => this.symbolQuotes.set(s.symbol.toUpperCase(), s.quoteAsset.toUpperCase()));
  }

  private loadMarketData() {
    this.socketService.getTopPairs(this.settings.marketType).subscribe(pairs => {
      console.log(`📡 [SYSTEM] Processing ${pairs.length} pairs in batches...`);

      // Перетворюємо масив пар у потік RxJS
      from(pairs).pipe(
        // mergeMap з лімітом (наприклад, 5) контролює кількість паралельних запитів
        mergeMap(p => this.createHistoryRequest(p).pipe(delay(100)), 5),
        toArray() // Збираємо все назад у масив після завершення
      ).subscribe(results => {
        this.processHistoryResults(results);
        this.connectWebSocket(pairs);
      });
    });
  }

  private createHistoryRequest(symbol: string) {
    return this.socketService.getKlinesHistory(symbol, this.settings.timeframe, this.settings.marketType).pipe(
      map(data => ({ symbol: symbol.toUpperCase(), data })),
      catchError(() => of(null))
    );
  }

  private processHistoryResults(results: any[]) {
    results.filter(r => r !== null).forEach(res => {
      const formatted = res.data.map((k: any) => ({
        close: parseFloat(k[4]), high: parseFloat(k[2]), low: parseFloat(k[3]), open: parseFloat(k[1]), volume: parseFloat(k[5])
      }));

      this.klineHistory.set(res.symbol, formatted);
      const avg = formatted.reduce((acc: number, c: any) => acc + c.volume, 0) / formatted.length;
      this.volumeAverages.set(res.symbol, avg);
    });
    console.log("✅ Market history loaded.");
  }

  private connectWebSocket(pairs: string[]) {
    if (this.socketSub) this.socketSub.unsubscribe();
    this.socketSub = this.socketService.connectKlines(pairs, this.settings.timeframe, this.settings.marketType)
      .subscribe({
        next: (data) => this.analyzeData(data),
        error: (err) => console.error("🚨 WS Error:", err)
      });
  }

  // --- ЯДРО АНАЛІЗУ (analyzeData Refactoring) ---

  private analyzeData(data: any) {
    if (data.type === 'liquidation') return this.handleLiquidation(data);

    const kline = data;
    if (kline.isClosed) return this.handleClosedKline(kline);

    this.processTick(kline);
  }

  private handleLiquidation(data: any) {
    const current = this.liquidationsCurrentMin.get(data.symbol) || 0;
    this.liquidationsCurrentMin.set(data.symbol, current + (data.amount || 0));
  }

  private handleClosedKline(kline: any) {
    const symbol = kline.symbol;
    const signal = this.activeSignals.get(symbol);

    if (signal && !signal.isStale) {
      this.addToHistory(symbol, signal.type, kline.close!, signal.liqAmount, signal.pattern);
    }

    this.cleanupKlineData(symbol);
    this.updateKlineHistory(symbol, kline);
    this.updateVolumeAverage(symbol, kline.volume!);
    this.updateUI();
  }

  private processTick(kline: any) {
    const history = this.klineHistory.get(kline.symbol) || [];
    if (history.length < this.settings.swingPeriod) return;

    const metrics = this.calculateMetrics(kline, history);
    const ctx = this.createPatternContext(kline, history);

    const signal = this.detectTradeSignal(kline, metrics, ctx, history);
    this.manageSignalLifecycle(kline.symbol, signal);

    this.updateUI();
  }

  // --- ДОПОМІЖНІ МЕТОДИ ОБРОБКИ ---

  private calculateMetrics(kline: any, history: any[]) {
    const elapsed = (Date.now() - kline.startTime!) / 60000;
    const projectedVol = elapsed > 0.1 ? kline.volume! * (1 / elapsed) : kline.volume!;
    const avgVol = this.volumeAverages.get(kline.symbol) || kline.volume!;
    const liqAmount = this.liquidationsCurrentMin.get(kline.symbol) || 0;

    const lastN = history.slice(-this.settings.swingPeriod);

    return {
      volMult: projectedVol / avgVol,
      liqAmount,
      isLocalBottom: kline.low! <= Math.min(...lastN.map(k => k.low)),
      isLocalPeak: kline.high! >= Math.max(...lastN.map(k => k.high)),
      isSpike: (projectedVol / avgVol) > this.settings.volumeThreshold ||
        ((projectedVol / avgVol) > 3 && liqAmount > this.settings.minLiquidation)
    };
  }

  private detectTradeSignal(kline: any, m: any, ctx: PatternContext, history: any[]): TradeSignal | null {
    if (!m.isSpike) return null;

    if (m.isLocalBottom && this.settings.showLong) {
      for (const detect of Detectors.LONG_DETECTORS) {
        const name = detect(ctx);
        if (name) return this.createSignal(kline, 'LONG', name, m.volMult, m.liqAmount, history);
      }
    }

    if (m.isLocalPeak && this.settings.showShort) {
      for (const detect of Detectors.SHORT_DETECTORS) {
        const name = detect(ctx);
        if (name) return this.createSignal(kline, 'SHORT', name, m.volMult, m.liqAmount, history);
      }
    }

    return null;
  }

  private manageSignalLifecycle(symbol: string, signal: TradeSignal | null) {
    if (signal && signal.rr >= this.settings.minRR) {
      const current = this.activeSignals.get(symbol);
      if (!current || current.isStale) this.playAlertSound();
      this.cancelRemoval(symbol);
      this.activeSignals.set(symbol, signal);
    } else {
      this.settings.holdStale ? this.scheduleRemoval(symbol) : this.activeSignals.delete(symbol);
    }
  }

  // --- ОНОВЛЕННЯ ДАНИХ ---

  private updateKlineHistory(symbol: string, kline: any) {
    let history = this.klineHistory.get(symbol) || [];
    history.push({ close: kline.close, high: kline.high, low: kline.low, open: kline.open, volume: kline.volume });
    if (history.length > 1000) history.shift();
    this.klineHistory.set(symbol, history);
  }

  private updateVolumeAverage(symbol: string, volume: number) {
    const currentAvg = this.volumeAverages.get(symbol) || volume;
    this.volumeAverages.set(symbol, (currentAvg * 19 + volume) / 20);
  }

  private cleanupKlineData(symbol: string) {
    this.activeSignals.delete(symbol);
    this.liquidationsCurrentMin.delete(symbol);
    this.cancelRemoval(symbol);
  }

  // --- UTILS ---

  private createPatternContext(kline: any, history: any[]): PatternContext {
    return {
      kline,
      lastCandle: history[history.length - 1],
      history: history,
      avgBody: history.slice(-10).reduce((acc, k) => acc + Math.abs(k.close - k.open), 0) / 10
    };
  }

  private playAlertSound() {
    if (this.settings.soundEnabled) {
      new Audio('https://actions.google.com/sounds/v1/alarms/beep_short.ogg').play().catch(() => {});
    }
  }

  private scheduleRemoval(symbol: string) {
    const existing = this.activeSignals.get(symbol);
    if (!existing || this.removalTimeouts.has(symbol)) return;
    existing.isStale = true;
    this.removalTimeouts.set(symbol, setTimeout(() => {
      this.activeSignals.delete(symbol);
      this.removalTimeouts.delete(symbol);
      this.updateUI();
    }, 15000));
  }

  private cancelRemoval(symbol: string) {
    const timeout = this.removalTimeouts.get(symbol);
    if (timeout) {
      clearTimeout(timeout);
      this.removalTimeouts.delete(symbol);
      const sig = this.activeSignals.get(symbol);
      if (sig) sig.isStale = false;
    }
  }

  private createSignal(kline: any, type: 'LONG' | 'SHORT', pattern: string, vol: number, liq: number, history: any[]): TradeSignal {
    const symbol = kline.symbol.toUpperCase();
    const sl = type === 'LONG' ? kline.low * 0.999 : kline.high * 1.001;
    const tp = type === 'LONG' ? Math.max(...history.slice(-20).map(k => k.high)) : Math.min(...history.slice(-20).map(k => k.low));

    return {
      symbol, type, pattern, currentPrice: kline.close,
      stopLoss: sl, takeProfit: tp,
      quoteAsset: this.symbolQuotes.get(symbol) || 'USDT',
      profitPercent: (Math.abs(tp - kline.close) / kline.close) * 100,
      volumeMultiplier: vol, liqAmount: liq, timestamp: Date.now(),
      rr: Math.abs(tp - kline.close) / (Math.abs(kline.close - sl) || 0.000001)
    };
  }

  private addToHistory(symbol: string, type: string, price: number, liq: number, pattern: string) {
    this.lastSignalsHistory.unshift({
      id: Date.now() + Math.random(),
      time: new Date().toLocaleTimeString(),
      symbol, quoteAsset: this.symbolQuotes.get(symbol) || 'USDT',
      type, pattern, price, liq
    });
    if (this.lastSignalsHistory.length > 20) this.lastSignalsHistory.pop();
    this.storage.saveHistory(this.lastSignalsHistory);
  }

  private updateUI() {
    this.signalsList = Array.from(this.activeSignals.values())
      .filter(s => (s.type === 'LONG' && this.settings.showLong) || (s.type === 'SHORT' && this.settings.showShort))
      .sort((a, b) => b.liqAmount - a.liqAmount);
    this.cdr.detectChanges();
  }
}