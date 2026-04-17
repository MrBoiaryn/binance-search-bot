import { Component, OnInit, ChangeDetectorRef, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { from, of, delay, mergeMap, map, toArray, catchError, Subject, auditTime, takeUntil, Subscription, interval } from 'rxjs';

// Сервіси та константи
import { BinanceSocketService } from './services/binance';
import { TradeStorageService } from './services/trade-storage.service';
import { MarketType, PositionStatus, SignalSide, BinanceEventType, BinanceFilterType } from './core/constants/trade-enums';

// Core
import * as Indicators from './core/math/indicators';
import * as PositionManager from './core/managers/position-manager';
import * as ScannerContext from './core/engine/scanner-context';
import * as Strategy from './core/strategies/counter-trend.strategy';

// Моделі та компоненти
import { HistoricalLog, ScannerSettings, TradeSignal } from './models/models';
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
  activeHistoryFilter: PositionStatus | string = PositionStatus.ALL;

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
    marketType: MarketType.FUTURES,
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
    useDivergence: false,
    trailingBars: 5,
    minProfitThreshold: 0.7,
    useBE: true,
    beLevelPct: 50
  };

  constructor(
    private socketService: BinanceSocketService,
    private cdr: ChangeDetectorRef,
    private storage: TradeStorageService,
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

  get displayHistory(): HistoricalLog[] {
    if (this.activeHistoryFilter === PositionStatus.ALL) {
      return this.lastSignalsHistory;
    }
    return this.lastSignalsHistory.filter(log => log.timeframe === this.activeHistoryFilter);
  }

  get displayPnL(): number {
    return this.displayHistory.reduce((acc, log) => acc + (log.pnl || 0), 0);
  }

  setHistoryFilter(tf: string) {
    this.activeHistoryFilter = tf;
    this.cdr.detectChanges();
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
        delay(300)
      ), 3),
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
          formatted[i].ao = Indicators.calculateAO(formatted, i);
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
    if (data.type === BinanceEventType.LIQUIDATION) return;

    const kline = data;
    const symbol = kline.symbol.toUpperCase();
    const key = `${symbol}_${tf}`;

    const history = this.klineHistory.get(key) || [];
    const tickSize = this.symbolTickSizes.get(symbol) || 0.0001;

    const isHistoryUpdated = PositionManager.processTick(
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
    const volMult = Indicators.calculateVolMult(kline, tf, avgVol);
    const lastCandle = history[history.length - 1];
    const prevVolMult = Indicators.calculateVolMult(lastCandle, tf, avgVol);

    const ctx = ScannerContext.createPatternContext(kline, history, this.settings);
    const signal = Strategy.detectTradeSignal(kline, volMult, prevVolMult, ctx, history, tf, this.settings, this.clusterTracker, this.symbolTickSizes, this.symbolQuotes);

    if (signal) {
      const isNew = !this.activeSignals.has(key);
      // Розрахунок Volume ($) для поточного сигналу
      signal.volumeUsd = kline.volume * kline.close;
      this.activeSignals.set(key, signal);
      if (isNew && this.settings.soundEnabled) this.playAlertSound();
    } else {
      this.activeSignals.delete(key);
    }
    this.uiUpdate$.next();
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
      status: PositionStatus.PENDING,
      quoteAsset: sig.quoteAsset,
      isOpened: false,
      hasDivergence: sig.hasDivergence,
      useBE: this.settings.useBE,
      beLevelPct: this.settings.beLevelPct,
      volumeUsd: sig.volumeUsd
    });
    if (this.lastSignalsHistory.length > 3000) this.lastSignalsHistory.pop();
    this.storage.saveHistory(this.lastSignalsHistory);
  }

  private performUIUpdate() {
    this.signalsList = Array.from(this.activeSignals.values())
      .filter(s => (s.type === SignalSide.LONG && this.settings.showLong) || (s.type === SignalSide.SHORT && this.settings.showShort))
      .sort((a, b) => b.timestamp - a.timestamp);
    this.cdr.detectChanges();
  }

  private processExchangeInfo(symbols: any[]) {
    symbols.forEach(s => {
      const sym = s.symbol.toUpperCase();
      this.symbolQuotes.set(sym, s.quoteAsset.toUpperCase());
      const f = s.filters.find((f: any) => f.filterType === BinanceFilterType.PRICE_FILTER);
      if (f) this.symbolTickSizes.set(sym, parseFloat(f.tickSize));
    });
  }

  private updateKlineHistory(key: string, kline: any) {
    let h = this.klineHistory.get(key) || [];
    const newCandle = {
      close: kline.close, high: kline.high, low: kline.low, open: kline.open, volume: kline.volume, ao: 0
    };
    h.push(newCandle);
    if (h.length > 600) h.shift();
    newCandle.ao = Indicators.calculateAO(h, h.length - 1);
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
