import { Component, OnInit, ChangeDetectorRef, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { from, of, delay, mergeMap, map, toArray, catchError, Subject, auditTime, takeUntil, Subscription, interval } from 'rxjs';

// Сервіси та константи
import { BinanceSocketService } from './services/binance';
import { TradeStorageService } from './services/trade-storage.service';
import { PositionTrackerService } from './services/position-tracker.service';
import * as Detectors from './constants/pattern-detectors';

// Моделі та компоненти
import { HistoricalLog, PatternContext, ScannerSettings, TradeSignal } from './models/models';
import { Header } from './components/header/header';
import { SignalCard } from './components/signal-card/signal-card';
import { HistoryTable } from './components/history-table/history-table';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, FormsModule, Header, SignalCard, HistoryTable],
  templateUrl: './app.html',
  styleUrls: ['./app.scss']
})
export class App implements OnInit, OnDestroy {
  // --- СХОВИЩА ДАНИХ ---
  activeSignals: Map<string, TradeSignal> = new Map();
  signalsList: TradeSignal[] = [];
  lastSignalsHistory: HistoricalLog[] = [];

  klineHistory: Map<string, any[]> = new Map();
  volumeAverages: Map<string, number> = new Map();
  symbolTickSizes: Map<string, number> = new Map();
  private symbolQuotes: Map<string, string> = new Map();
  private clusterTracker: Map<string, number> = new Map();

  private socketSubscriptions: Map<string, Subscription> = new Map();
  private destroy$ = new Subject<void>();
  private scannerStop$ = new Subject<void>();
  private uiUpdate$ = new Subject<void>();

  // --- НАЛАШТУВАННЯ ---
  settings: ScannerSettings = {
    marketType: 'futures',
    timeframes: ['1m'],
    minVolMult: 1.5,
    maxVolMult: 4.0,
    swingPeriod: 10,
    minSwing: 0.3,
    maxSwing: 2.2,
    minLvlStrength: 2.5,
    minRR: 1.5,
    maxRR: 3.0,
    maxClusterSize: 4,
    soundEnabled: true,
    holdStale: false,
    showLong: true,
    showShort: true,
    useDivergence: false, // Тільки з дивергенцією, якщо увімкнено
    trailingBars: 5,
    minProfitThreshold: 0.7,
  };

  constructor(
    private socketService: BinanceSocketService,
    private cdr: ChangeDetectorRef,
    private storage: TradeStorageService,
    private tracker: PositionTrackerService,
  ) {
    interval(60000).pipe(takeUntil(this.destroy$)).subscribe(() => this.clusterTracker.clear());
    this.uiUpdate$.pipe(
      auditTime(500),
      takeUntil(this.destroy$)
    ).subscribe(() => this.performUIUpdate());
  }

  ngOnInit() {
    this.loadInitialConfig();
    this.startScanner();
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
    this.scannerStop$.next();
    this.scannerStop$.complete();
    this.resetScannerState();
  }

  private loadInitialConfig() {
    const saved = this.storage.loadSettings();
    if (saved) this.settings = { ...this.settings, ...saved };
    this.lastSignalsHistory = this.storage.loadHistory();
  }

  startScanner() {
    this.scannerStop$.next();
    console.log(`📡 [SYSTEM] Starting Multi-TF Scanner...`);

    this.socketService.getExchangeInfo(this.settings.marketType)
      .pipe(takeUntil(this.destroy$), takeUntil(this.scannerStop$))
      .subscribe(info => {
        this.processExchangeInfo(info.symbols);

        this.socketService.getTopPairs(this.settings.marketType)
          .pipe(takeUntil(this.destroy$), takeUntil(this.scannerStop$))
          .subscribe(pairs => {
            this.settings.timeframes.forEach(tf => {
              this.initTimeframe(pairs, tf);
            });
          });
      });
  }

  onSettingsUpdated(newSettings: ScannerSettings) {
    const needsRestart =
      JSON.stringify(newSettings.timeframes) !== JSON.stringify(this.settings.timeframes) ||
      newSettings.marketType !== this.settings.marketType;

    this.settings = newSettings;
    this.storage.saveSettings(newSettings);

    if (needsRestart) {
      this.resetScannerState();
      this.startScanner();
    } else {
      this.uiUpdate$.next();
    }
  }

  onClearHistory() {
    if (window.confirm('Ви впевнені, що хочете видалити всю історію угод?')) {
      this.lastSignalsHistory = [];
      this.storage.saveHistory([]);
      this.uiUpdate$.next();
    }
  }

  private initTimeframe(pairs: string[], tf: string) {
    from(pairs).pipe(
      mergeMap(p => this.socketService.getKlinesHistory(p, tf, this.settings.marketType).pipe(
        map(data => ({ symbol: p.toUpperCase(), tf, data })),
        catchError(() => of(null)),
        delay(200)
      ), 5),
      toArray(),
      takeUntil(this.destroy$),
      takeUntil(this.scannerStop$)
    ).subscribe(results => {
      results.filter(r => r !== null).forEach(res => {
        const key = `${res.symbol}_${res.tf}`;
        const formatted = res.data.map((k: any) => ({
          close: parseFloat(k[4]),
          high: parseFloat(k[2]),
          low: parseFloat(k[3]),
          open: parseFloat(k[1]),
          volume: parseFloat(k[5]),
          ao: 0
        }));

        for (let i = 33; i < formatted.length; i++) {
          formatted[i].ao = this.calculateAO(formatted, i);
        }

        this.klineHistory.set(key, formatted);
        const avg = formatted.reduce((acc: number, c: any) => acc + c.volume, 0) / formatted.length;
        this.volumeAverages.set(key, avg);
      });

      this.connectWebSocket(pairs, tf);
    });
  }

  private connectWebSocket(pairs: string[], tf: string) {
    const sub = this.socketService.connectKlines(pairs, tf, this.settings.marketType)
      .pipe(takeUntil(this.destroy$), takeUntil(this.scannerStop$))
      .subscribe({
        next: (data) => this.analyzeData(data, tf),
        error: (err) => console.error(`🚨 [WS ${tf}] Error:`, err)
      });
    this.socketSubscriptions.set(tf, sub);
  }

  private resetScannerState() {
    this.scannerStop$.next();
    this.socketSubscriptions.forEach(sub => sub.unsubscribe());
    this.socketSubscriptions.clear();
    this.activeSignals.clear();
    this.signalsList = [];
    this.klineHistory.clear();
    this.volumeAverages.clear();
  }

  private analyzeData(data: any, tf: string) {
    if (data.type === 'liquidation') return;

    const kline = data;
    const symbol = kline.symbol.toUpperCase();
    const key = `${symbol}_${tf}`;

    const history = this.klineHistory.get(key) || [];
    const tickSize = this.symbolTickSizes.get(symbol) || 0.0001;

    const isHistoryUpdated = this.tracker.processTick(
      { ...kline, tf },
      this.lastSignalsHistory,
      history,
      this.settings.trailingBars,
      tickSize
    );

    if (isHistoryUpdated) {
      this.storage.saveHistory(this.lastSignalsHistory);
      this.uiUpdate$.next();
    }

    if (kline.isClosed) {
      this.processTick(kline, tf, key);
      const validFinalSignal = this.activeSignals.get(key);
      if (validFinalSignal) {
        this.addSignalToHistory(kline, validFinalSignal, tf);
      }
      this.updateKlineHistory(key, kline);
      this.updateVolumeAverage(key, kline.volume!);
      this.activeSignals.delete(key);
      this.uiUpdate$.next();
    } else {
      this.processTick(kline, tf, key);
    }
  }

  private processTick(kline: any, tf: string, key: string) {
    const history = this.klineHistory.get(key) || [];
    if (history.length < 50) return;

    const avgVol = this.volumeAverages.get(key) || kline.volume!;
    const volMult = this.calculateVolMult(kline, tf, avgVol);

    const ctx = this.createPatternContext(kline, history);
    const signal = this.detectTradeSignal(kline, volMult, ctx, history, tf);

    if (signal) {
      const isNew = !this.activeSignals.has(key);
      this.activeSignals.set(key, signal);
      if (isNew && this.settings.soundEnabled) this.playAlertSound();
    } else {
      this.activeSignals.delete(key);
    }
    this.uiUpdate$.next();
  }

  private detectTradeSignal(kline: any, volMult: number, ctx: PatternContext, history: any[], tf: string): TradeSignal | null {
    if (volMult < this.settings.minVolMult || volMult > this.settings.maxVolMult) return null;

    if (this.settings.useDivergence && !ctx.hasDivergence) return null;

    const isTooDense = (name: string, type: string) => {
      const key = `${name}_${type}_${tf}`;
      return (this.clusterTracker.get(key) || 0) >= this.settings.maxClusterSize;
    };

    const isAnomalousVol = volMult >= (this.settings.minVolMult * 2.5);

    // LONG
    if (this.settings.showLong) {
      for (const detect of Detectors.LONG_DETECTORS) {
        const name = detect(ctx);
        if (name) {
          const isAtBottom = (name === 'Inside') ? ctx.isMotherBarBottom : ctx.isLocalBottom;

          if (isAtBottom && !isTooDense(name, 'LONG')) {
            // ✅ Повертаємо візуальні емодзі
            const suffix = isAnomalousVol ? ' 🔥' : (ctx.hasDivergence ? ' 💎' : '');
            const signal = this.createSignal(kline, 'LONG', `${name}${suffix}`, volMult, tf, history, ctx.atr, ctx.hasDivergence);

            if (this.isValidSignal(signal)) {
              this.clusterTracker.set(`${name}_LONG_${tf}`, (this.clusterTracker.get(`${name}_LONG_${tf}`) || 0) + 1);
              return signal;
            }
          }
        }
      }
    }

    // SHORT
    if (this.settings.showShort) {
      for (const detect of Detectors.SHORT_DETECTORS) {
        const name = detect(ctx);
        if (name) {
          const isAtPeak = (name === 'Inside') ? ctx.isMotherBarPeak : ctx.isLocalPeak;

          if (isAtPeak && !isTooDense(name, 'SHORT')) {
            // ✅ Повертаємо візуальні емодзі
            const suffix = isAnomalousVol ? ' 🔥' : (ctx.hasDivergence ? ' 💎' : '');
            const signal = this.createSignal(kline, 'SHORT', `${name}${suffix}`, volMult, tf, history, ctx.atr, ctx.hasDivergence);

            if (this.isValidSignal(signal)) {
              this.clusterTracker.set(`${name}_SHORT_${tf}`, (this.clusterTracker.get(`${name}_SHORT_${tf}`) || 0) + 1);
              return signal;
            }
          }
        }
      }
    }
    return null;
  }

  private isValidSignal(sig: TradeSignal | null): boolean {
    if (!sig) return false;
    return (
      sig.lvlStrength >= this.settings.minLvlStrength &&
      sig.profitPercent >= this.settings.minProfitThreshold &&
      sig.swingStrength >= this.settings.minSwing &&
      sig.swingStrength <= this.settings.maxSwing &&
      sig.rr >= this.settings.minRR
    );
  }

  private createSignal(kline: any, type: 'LONG' | 'SHORT', pattern: string, vol: number, tf: string, history: any[], atr: number, hasDivergence: boolean): TradeSignal | null {
    const symbol = kline.symbol.toUpperCase();
    const tickSize = this.symbolTickSizes.get(symbol) || 0.0001;

    // 1. Точка входу (з ATR відступом)
    const entryOffset = atr * 0.1;
    const rawEntryPrice = type === 'LONG' ? kline.high + entryOffset : kline.low - entryOffset;
    const entryPrice = this.roundToTick(rawEntryPrice, tickSize);

    // 2. Відхилення
    const typicalPrice = (kline.high + kline.low + kline.close) / 3;
    const avgPrice = history.slice(-20).reduce((acc, k) => acc + k.close, 0) / 20;
    const maDeviation = Math.abs((typicalPrice - avgPrice) / avgPrice) * 100;
    if (maDeviation < this.settings.minSwing) return null;

    // 3. Стоп-Лосс
    const sl = this.calculateSL(kline, history, type, tickSize, pattern, atr);
    const actualRisk = Math.abs(entryPrice - sl) || tickSize;

    // 4. Тейк-Профіт (Жорстка математика)
    const levelData = this.findTrueLevel(history.slice(-500), type === 'LONG' ? 'RESISTANCE' : 'SUPPORT', entryPrice, tickSize);
    const { minRR, maxRR, minLvlStrength } = this.settings;

    const requiredReward = actualRisk * minRR;
    const maxAllowedReward = actualRisk * maxRR;

    // ✅ Жорстко математичний мінімальний Тейк (без милиць з додаванням тіків)
    const minMathTp = type === 'LONG'
      ? entryPrice + requiredReward
      : entryPrice - requiredReward;

    let tpPrice = levelData.price;
    let naturalReward = Math.abs(tpPrice - entryPrice);

    // Конфлікт рівня і RR
    if (naturalReward < requiredReward || (type === 'LONG' ? tpPrice <= entryPrice : tpPrice >= entryPrice)) {
      if (levelData.strength < minLvlStrength) {
        tpPrice = minMathTp; // Застосовуємо залізну математику
      } else {
        return null;
      }
    }

    // Зрізання максимальної жадібності
    if (Math.abs(tpPrice - entryPrice) > maxAllowedReward) {
      tpPrice = type === 'LONG' ? entryPrice + maxAllowedReward : entryPrice - maxAllowedReward;
    }

    const tp = this.roundToTick(tpPrice, tickSize);

    return {
      symbol, type, pattern, timeframe: tf,
      entryPrice,
      currentPrice: kline.close,
      stopLoss: sl,
      takeProfit: tp,
      lvlStrength: levelData.strength,
      swingStrength: maDeviation,
      volumeMultiplier: vol,
      liqAmount: 0,
      timestamp: Date.now(),
      quoteAsset: this.symbolQuotes.get(symbol) || 'USDT',
      profitPercent: (Math.abs(tp - entryPrice) / entryPrice) * 100,
      rr: Math.abs(tp - entryPrice) / actualRisk,
      hasDivergence
    };
  }

  private findTrueLevel(history: any[], type: 'SUPPORT' | 'RESISTANCE', currentPrice: number, tickSize: number) {
    if (history.length === 0) return { price: currentPrice, strength: 0 };
    const prices = history.map(k => type === 'RESISTANCE' ? k.high : k.low);
    const minP = Math.min(...prices, currentPrice);
    const maxP = Math.max(...prices, currentPrice);
    const binSize = Math.max((maxP - minP) / 100, tickSize * 2);
    const bins = new Array(Math.ceil((maxP - minP) / binSize) + 1).fill(0);

    history.forEach(k => {
      const idx = Math.floor(((type === 'RESISTANCE' ? k.high : k.low) - minP) / binSize);
      if (idx >= 0 && idx < bins.length) bins[idx] += k.volume;
    });

    let bestIdx = -1, maxVol = 0;
    bins.forEach((v, i) => {
      const p = minP + i * binSize;
      if (type === 'RESISTANCE' && p <= currentPrice) return;
      if (type === 'SUPPORT' && p >= currentPrice) return;
      if (v > maxVol) { maxVol = v; bestIdx = i; }
    });

    if (bestIdx === -1) return { price: type === 'RESISTANCE' ? maxP : minP, strength: 0 };
    const avgVol = bins.reduce((a, b) => a + b, 0) / bins.length;
    return { price: minP + bestIdx * binSize, strength: maxVol / (avgVol || 1) };
  }

  private calculateAO(history: any[], index: number): number {
    if (index < 33) return 0;
    const mid = (i: number) => (history[i].high + history[i].low) / 2;
    let s5 = 0; for (let i = index - 4; i <= index; i++) s5 += mid(i);
    let s34 = 0; for (let i = index - 33; i <= index; i++) s34 += mid(i);
    return (s5 / 5) - (s34 / 34);
  }

  private calculateAOForTick(history: any[], kline: any): number {
    const mid = (i: number) => (history[i].high + history[i].low) / 2;
    const currentMid = (kline.high + kline.low) / 2;
    let s5 = currentMid; for (let i = history.length - 1; i > history.length - 5; i--) s5 += mid(i);
    let s34 = currentMid; for (let i = history.length - 1; i > history.length - 34; i--) s34 += mid(i);
    return (s5 / 5) - (s34 / 34);
  }

  private roundToTick(price: number, tick: number): number {
    const p = Math.max(0, -Math.floor(Math.log10(tick)));
    return parseFloat((Math.round(price / tick) * tick).toFixed(p));
  }

  private calculateVolMult(kline: any, tf: string, avgVol: number): number {
    if (!kline.openTime || avgVol === 0) return kline.volume / (avgVol || 1);
    const elapsed = Date.now() - kline.openTime;
    const total = this.getTfMs(tf);
    if (kline.isClosed || elapsed < total / 2) return kline.volume / avgVol;
    return (kline.volume / Math.min(0.99, elapsed / total)) / avgVol;
  }

  private getTfMs(tf: string): number {
    const unit = tf.slice(-1), value = parseInt(tf);
    switch (unit) {
      case 'm': return value * 60 * 1000;
      case 'h': return value * 60 * 60 * 1000;
      case 'd': return value * 24 * 60 * 60 * 1000;
      default: return 60 * 1000;
    }
  }

  private addSignalToHistory(kline: any, sig: TradeSignal, tf: string) {
    this.lastSignalsHistory.unshift({
      id: Date.now() + Math.random(),
      time: new Date(kline.openTime || Date.now()).toLocaleTimeString(),
      symbol: sig.symbol,
      timeframe: tf,
      type: sig.type,
      pattern: sig.pattern,
      price: sig.entryPrice,
      sl: sig.stopLoss,
      tp: sig.takeProfit,
      rr: sig.rr,
      volMult: sig.volumeMultiplier,
      swingStrength: sig.swingStrength,
      lvlStrength: sig.lvlStrength,
      liq: sig.liqAmount,
      status: 'PENDING',
      quoteAsset: sig.quoteAsset,
      isOpened: false,
      hasDivergence: sig.hasDivergence
    });
    if (this.lastSignalsHistory.length > 2000) this.lastSignalsHistory.pop();
    this.storage.saveHistory(this.lastSignalsHistory);
  }

  private performUIUpdate() {
    this.signalsList = Array.from(this.activeSignals.values())
      .filter(s => (s.type === 'LONG' && this.settings.showLong) || (s.type === 'SHORT' && this.settings.showShort))
      .sort((a, b) => b.timestamp - a.timestamp);
    this.cdr.detectChanges();
  }

  private processExchangeInfo(symbols: any[]) {
    symbols.forEach(s => {
      const sym = s.symbol.toUpperCase();
      this.symbolQuotes.set(sym, s.quoteAsset.toUpperCase());
      const f = s.filters.find((f: any) => f.filterType === 'PRICE_FILTER');
      if (f) this.symbolTickSizes.set(sym, parseFloat(f.tickSize));
    });
  }

  private calculateATR(history: any[], period: number = 14): number {
    if (history.length < period) return 0;
    const slices = history.slice(-period);
    const ranges = slices.map(k => k.high - k.low);
    return ranges.reduce((a, b) => a + b, 0) / period;
  }

  private createPatternContext(kline: any, history: any[]): PatternContext {
    const lookback = this.settings.swingPeriod || 10;
    const lastN = history.slice(-lookback);
    const lastCandle = history[history.length - 1];

    const historyExclLast = history.slice(0, -1);
    const lastNExclLast = historyExclLast.slice(-lookback);

    const currentAO = this.calculateAOForTick(history, kline);
    const atr = this.calculateATR(history, 14);

    return {
      kline, lastCandle, history, atr,
      avgBody: history.slice(-10).reduce((acc, k) => acc + Math.abs(k.close - k.open), 0) / 10,
      isLocalBottom: kline.low! <= Math.min(...lastN.map(k => k.low)),
      isLocalPeak: kline.high! >= Math.max(...lastN.map(k => k.high)),
      isMotherBarBottom: lastCandle && lastCandle.low <= Math.min(...lastNExclLast.map(k => k.low)),
      isMotherBarPeak: lastCandle && lastCandle.high >= Math.max(...lastNExclLast.map(k => k.high)),
      hasDivergence: this.checkAODivergence(history, (kline.close > kline.open ? 'LONG' : 'SHORT'), currentAO)
    };
  }

  private checkAODivergence(history: any[], type: 'LONG' | 'SHORT', currentAO: number): boolean {
    const len = history.length;
    if (len < 50) return false;
    const getAO = (i: number) => history[i]?.ao || 0;

    if (type === 'LONG') {
      if (currentAO >= 0) return false;
      let recM = Infinity, recAO = Infinity, i = len - 1;
      for (; i >= len - 20; i--) {
        if (history[i].low < recM) recM = history[i].low;
        if (getAO(i) < recAO) recAO = getAO(i);
        if (getAO(i) > 0) break;
      }
      let pastM = Infinity, pastAO = Infinity;
      for (; i >= len - 50; i--) {
        if (history[i].low < pastM) pastM = history[i].low;
        if (getAO(i) < pastAO) pastAO = getAO(i);
      }
      return (recM < pastM) && (recAO > pastAO);
    } else {
      if (currentAO <= 0) return false;
      let recM = -Infinity, recAO = -Infinity, i = len - 1;
      for (; i >= len - 20; i--) {
        if (history[i].high > recM) recM = history[i].high;
        if (getAO(i) > recAO) recAO = getAO(i);
        if (getAO(i) < 0) break;
      }
      let pastM = -Infinity, pastAO = -Infinity;
      for (; i >= len - 50; i--) {
        if (history[i].high > pastM) pastM = history[i].high;
        if (getAO(i) > pastAO) pastAO = getAO(i);
      }
      return (recM > pastM) && (recAO < pastAO);
    }
  }

  private calculateSL(kline: any, history: any[], type: 'LONG' | 'SHORT', tick: number, pattern: string, atr: number): number {
    const slOffset = atr * 0.15;
    if (['PinBar', 'Hammer', 'Star'].includes(pattern)) {
      return type === 'LONG'
        ? this.roundToTick(kline.low - slOffset, tick)
        : this.roundToTick(kline.high + slOffset, tick);
    }
    const candles = history.slice(-3);
    return type === 'LONG'
      ? this.roundToTick(Math.min(...candles.map(k => k.low), kline.low) - slOffset, tick)
      : this.roundToTick(Math.max(...candles.map(k => k.high), kline.high) + slOffset, tick);
  }

  private updateKlineHistory(key: string, kline: any) {
    let h = this.klineHistory.get(key) || [];
    const newCandle = {
      close: kline.close, high: kline.high, low: kline.low, open: kline.open, volume: kline.volume, ao: 0
    };
    h.push(newCandle);
    if (h.length > 600) h.shift();
    newCandle.ao = this.calculateAO(h, h.length - 1);
    this.klineHistory.set(key, h);
  }

  private updateVolumeAverage(key: string, vol: number) {
    const a = this.volumeAverages.get(key) || vol;
    this.volumeAverages.set(key, (a * 19 + vol) / 20);
  }

  private playAlertSound() {
    new Audio('https://actions.google.com/sounds/v1/alarms/beep_short.ogg').play().catch(() => {});
  }
}