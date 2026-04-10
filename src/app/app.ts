import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { BinanceSocketService } from './services/binance';
import { forkJoin, map, catchError, of } from 'rxjs';
import { TradeStorageService } from './services/trade-storage.service';
import { FormsModule } from '@angular/forms';
import { HistoricalLog, OpenPosition, ScannerSettings, TradeSignal } from './models/models';
import { Header } from './components/header/header';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, FormsModule, Header],
  templateUrl: './app.html',
  styleUrls: ['./app.scss']
})
export class App implements OnInit {
  activeSignals: Map<string, TradeSignal> = new Map();
  signalsList: TradeSignal[] = [];
  processedTicks = 0;
  lastSignalsHistory: HistoricalLog[] = [];
  openPositions: OpenPosition[] = [];

  klineHistory: Map<string, any[]> = new Map();
  volumeAverages: Map<string, number> = new Map();
  liquidationsCurrentMin: Map<string, number> = new Map();
  private removalTimeouts: Map<string, any> = new Map();
  private socketSub: any;

  // ЄДИНИЙ ОБ'ЄКТ НАЛАШТУВАНЬ
  settings: ScannerSettings = {
    marketType: 'futures',
    timeframe: '1m',
    volumeThreshold: 2.5,
    swingPeriod: 10,
    minLiquidation: 1000,
    minRR: 1.5,
    soundEnabled: true,
    holdStale: true
  };

  constructor(
    private socketService: BinanceSocketService,
    private cdr: ChangeDetectorRef,
    private storage: TradeStorageService,
  ) {}

  ngOnInit() {
    this.lastSignalsHistory = this.storage.loadHistory();
    this.openPositions = this.storage.loadOpenPositions();
    this.startScanner();
    this.initHeartbeat();
  }

  // МЕТОД ДЛЯ ПРИЙОМУ ЗМІН З ХЕДЕРА
  onSettingsUpdated(newSettings: ScannerSettings) {
    this.settings = newSettings;

    if (this.socketSub) this.socketSub.unsubscribe();
    this.activeSignals.clear();
    this.signalsList = [];
    this.klineHistory.clear();
    this.volumeAverages.clear();
    this.liquidationsCurrentMin.clear();

    this.startScanner();
  }

  startScanner() {
    this.socketService.getTopPairs(this.settings.marketType).subscribe(pairs => {
      const historyRequests = pairs.map(p =>
        this.socketService.getKlinesHistory(p, this.settings.timeframe, this.settings.marketType).pipe(
          map(data => ({ symbol: p.toUpperCase(), data })),
          catchError(() => of(null))
        )
      );

      forkJoin(historyRequests).subscribe(results => {
        results.filter(r => r !== null).forEach((res: any) => {
          const formatted = res.data.map((k: any) => ({
            close: parseFloat(k[4]), high: parseFloat(k[2]), low: parseFloat(k[3]), open: parseFloat(k[1]), volume: parseFloat(k[5])
          }));
          this.klineHistory.set(res.symbol, formatted);
          const avg = formatted.reduce((a: any, b: any) => a + b.volume, 0) / formatted.length;
          this.volumeAverages.set(res.symbol, avg);
        });

        this.socketSub = this.socketService.connectKlines(pairs, this.settings.timeframe, this.settings.marketType).subscribe(data => {
          this.analyzeData(data);
        });
      });
    });
  }

  private analyzeData(data: any) {
    if (data.type === 'liquidation') {
      const current = this.liquidationsCurrentMin.get(data.symbol) || 0;
      this.liquidationsCurrentMin.set(data.symbol, current + (data.amount || 0));
      return;
    }

    const kline = data;
    this.processedTicks++;

    if (kline.isClosed) {
      this.updateTrailingStops(kline);
      const signal = this.activeSignals.get(kline.symbol);
      if (signal && !signal.isStale) {
        this.addToHistory(kline.symbol, signal.type, kline.close!, signal.liqAmount, signal.pattern);
      }

      this.activeSignals.delete(kline.symbol);
      this.liquidationsCurrentMin.delete(kline.symbol);

      let history = this.klineHistory.get(kline.symbol) || [];
      history.push({ close: kline.close, high: kline.high, low: kline.low, open: kline.open, volume: kline.volume });
      if (history.length > 250) history.shift();
      this.klineHistory.set(kline.symbol, history);

      const currentAvg = this.volumeAverages.get(kline.symbol) || kline.volume!;
      this.volumeAverages.set(kline.symbol, (currentAvg * 2 + kline.volume!) / 3);

      this.updateUI();
      return;
    }

    const history = this.klineHistory.get(kline.symbol) || [];
    if (history.length < this.settings.swingPeriod) return;

    const lastCandle = history[history.length - 1];
    const body = Math.abs(kline.close! - kline.open!);
    const prevBody = Math.abs(lastCandle.close - lastCandle.open);
    const lowerShadow = Math.min(kline.open!, kline.close!) - kline.low!;
    const upperShadow = kline.high! - Math.max(kline.open!, kline.close!);
    const avgBody = history.slice(-10).reduce((acc, k) => acc + Math.abs(k.close - k.open), 0) / 10;

    const elapsed = (Date.now() - kline.startTime!) / 60000;
    const projectedVol = elapsed > 0.1 ? kline.volume! * (1 / elapsed) : kline.volume!;
    const avgVol = this.volumeAverages.get(kline.symbol) || kline.volume!;
    const volMult = projectedVol / avgVol;
    const liqAmount = this.liquidationsCurrentMin.get(kline.symbol) || 0;

    const last10 = history.slice(-this.settings.swingPeriod);
    const isLocalBottom = kline.low! <= Math.min(...last10.map(k => k.low));
    const isLocalPeak = kline.high! >= Math.max(...last10.map(k => k.high));

    const isSpike = volMult > this.settings.volumeThreshold ||
      (volMult > 3 && liqAmount > this.settings.minLiquidation);

    let signal: TradeSignal | null = null;

    if (isLocalBottom && isSpike) {
      if (lowerShadow > body * 2 && upperShadow < body * 0.5) signal = this.createSignal(kline, 'LONG', 'Hammer', volMult, liqAmount, history);
      else if (kline.close! > kline.open! && lastCandle.close < lastCandle.open && body > prevBody * 1.2) signal = this.createSignal(kline, 'LONG', 'Engulfing', volMult, liqAmount, history);
      else if (kline.close! > kline.open! && body > avgBody * 2.5) signal = this.createSignal(kline, 'LONG', 'Momentum', volMult, liqAmount, history);
    }
    else if (isLocalPeak && isSpike) {
      if (upperShadow > body * 2 && lowerShadow < body * 0.5) signal = this.createSignal(kline, 'SHORT', 'Star', volMult, liqAmount, history);
      else if (kline.close! < kline.open! && lastCandle.close > lastCandle.open && body > prevBody * 1.2) signal = this.createSignal(kline, 'SHORT', 'Engulfing', volMult, liqAmount, history);
      else if (kline.close! < kline.open! && body > avgBody * 2.5) signal = this.createSignal(kline, 'SHORT', 'Momentum', volMult, liqAmount, history);
    }

    if (signal && signal.rr < this.settings.minRR) signal = null;

    if (signal) {
      if (!this.activeSignals.has(kline.symbol) || this.activeSignals.get(kline.symbol)?.isStale) {
        this.playAlertSound();
      }
      this.cancelRemoval(kline.symbol);
      this.activeSignals.set(kline.symbol, signal);
    } else {
      if (!this.settings.holdStale) {
        this.activeSignals.delete(kline.symbol);
      } else {
        this.scheduleRemoval(kline.symbol);
      }
    }

    this.updateUI();
  }

  private playAlertSound() {
    if (!this.settings.soundEnabled) return;
    try {
      const audio = new Audio('https://actions.google.com/sounds/v1/alarms/beep_short.ogg');
      audio.volume = 0.5;
      audio.play();
    } catch (e) {
      console.warn("Autoplay blocked for sound.");
    }
  }

  private scheduleRemoval(symbol: string) {
    const existing = this.activeSignals.get(symbol);
    if (!existing || this.removalTimeouts.has(symbol)) return;

    existing.isStale = true;
    const timeout = setTimeout(() => {
      this.activeSignals.delete(symbol);
      this.removalTimeouts.delete(symbol);
      this.updateUI();
    }, 15000);

    this.removalTimeouts.set(symbol, timeout);
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
    const sl = type === 'LONG' ? kline.low * 0.999 : kline.high * 1.001;
    const tp = type === 'LONG' ? Math.max(...history.slice(-20).map(k => k.high)) : Math.min(...history.slice(-20).map(k => k.low));
    const risk = Math.abs(kline.close - sl);
    const profit = Math.abs(tp - kline.close);

    return {
      symbol: kline.symbol, type, pattern, currentPrice: kline.close, stopLoss: sl, takeProfit: tp,
      profitPercent: (profit / kline.close) * 100, volumeMultiplier: vol, liqAmount: liq, timestamp: Date.now(),
      rr: profit / (risk || 0.000001)
    };
  }

  openTrade(sig: TradeSignal) {
    const newPos: OpenPosition = { symbol: sig.symbol, type: sig.type, entryPrice: sig.currentPrice, currentSL: sig.stopLoss, takeProfit: sig.takeProfit, pattern: sig.pattern, openedAt: Date.now() };
    this.openPositions.push(newPos);
    this.storage.saveOpenPositions(this.openPositions);
  }

  private updateTrailingStops(kline: any) {
    let changed = false;
    this.openPositions = this.openPositions.map(pos => {
      if (pos.symbol !== kline.symbol) return pos;
      const history = this.klineHistory.get(pos.symbol) || [];
      if (history.length < 5) return pos;
      const last5 = history.slice(-5);
      if (pos.type === 'LONG') {
        const lowest5 = Math.min(...last5.map(k => k.low));
        if (lowest5 > pos.currentSL) { pos.currentSL = lowest5; changed = true; }
        if (kline.low <= pos.currentSL) { this.closePosition(pos, 'STOP-LOSS', kline.close); return null; }
      } else {
        const highest5 = Math.max(...last5.map(k => k.high));
        if (highest5 < pos.currentSL) { pos.currentSL = highest5; changed = true; }
        if (kline.high >= pos.currentSL) { this.closePosition(pos, 'STOP-LOSS', kline.close); return null; }
      }
      return pos;
    }).filter(p => p !== null) as OpenPosition[];
    if (changed) this.storage.saveOpenPositions(this.openPositions);
  }

  closePosition(pos: OpenPosition, reason: string, price: number) {
    this.addToHistory(pos.symbol, pos.type, price, 0, `${pos.pattern} (${reason})`);
    this.openPositions = this.openPositions.filter(p => p !== pos);
    this.storage.saveOpenPositions(this.openPositions);
    this.storage.saveHistory(this.lastSignalsHistory);
  }

  private addToHistory(symbol: string, type: string, price: number, liq: number, pattern: string) {
    this.lastSignalsHistory.unshift({ time: new Date().toLocaleTimeString(), symbol, type, pattern, price, liq });
    if (this.lastSignalsHistory.length > 20) this.lastSignalsHistory.pop();
  }

  getBinanceLink(symbol: string): string { return `https://www.binance.com/uk-UA/futures/${symbol.toUpperCase()}`; }
  private updateUI() { this.signalsList = Array.from(this.activeSignals.values()).sort((a, b) => b.liqAmount - a.liqAmount); this.cdr.detectChanges(); }
  private initHeartbeat() { setInterval(() => { this.processedTicks = 0; }, 60000); }
}