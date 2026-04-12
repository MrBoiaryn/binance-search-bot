import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { from, of, delay, mergeMap, map, toArray, catchError } from 'rxjs';

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
export class App implements OnInit {
  // --- СХОВИЩА ДАНИХ (Ключ завжди "SYMBOL_TF") ---
  activeSignals: Map<string, TradeSignal> = new Map(); // Живі сигнали на екрані
  signalsList: TradeSignal[] = [];                    // Відфільтрований масив для UI
  lastSignalsHistory: HistoricalLog[] = [];           // Історія для таблиці (LocalStorage)

  klineHistory: Map<string, any[]> = new Map();       // Історія свічок (500+ для кожного ТФ)
  volumeAverages: Map<string, number> = new Map();    // Середній об'єм для розрахунку сплесків
  symbolTickSizes: Map<string, number> = new Map();   // Крок ціни для кожної монети з ExchangeInfo
  private symbolQuotes: Map<string, string> = new Map();

  private removalTimeouts: Map<string, any> = new Map();
  private socketSubscriptions: Map<string, any> = new Map(); // Підписки для кожного ТФ

  // --- НАЛАШТУВАННЯ ЗА ЗАМОВЧУВАННЯМ ---
  settings: ScannerSettings = {
    marketType: 'futures',
    timeframes: ['1m'], // Тепер це масив
    volumeThreshold: 1.5, // Для збору статистики ставимо низький
    swingPeriod: 10,
    minLiquidation: 0,
    minRR: 0.1,           // Беремо все для аналізу
    soundEnabled: true,
    holdStale: true,
    showLong: true,
    showShort: true,
    useDivergence: false, // Для "сирого" збору вимикаємо, або вмикаємо для снайпінгу
  };

  constructor(
    private socketService: BinanceSocketService,
    private cdr: ChangeDetectorRef,
    private storage: TradeStorageService,
    private tracker: PositionTrackerService,
  ) {}

  ngOnInit() {
    this.loadInitialConfig();
    this.startScanner();
  }

  // --- ІНІЦІАЛІЗАЦІЯ ТА ПІДКЛЮЧЕННЯ ---

  private loadInitialConfig() {
    const saved = this.storage.loadSettings();
    if (saved) this.settings = { ...this.settings, ...saved };
    this.lastSignalsHistory = this.storage.loadHistory();
  }

  startScanner() {
    console.log(`📡 [SYSTEM] Starting Multi-TF Scanner...`);

    this.socketService.getExchangeInfo(this.settings.marketType).subscribe(info => {
      this.processExchangeInfo(info.symbols);

      this.socketService.getTopPairs(this.settings.marketType).subscribe(pairs => {
        // Запускаємо окремий потік для кожного обраного таймфрейму
        this.settings.timeframes.forEach(tf => {
          this.initTimeframe(pairs, tf);
        });
      });
    });
  }

  onSettingsUpdated(newSettings: ScannerSettings) {
    // Перевіряємо, чи змінилися критичні параметри, що потребують перезавантаження
    const needsRestart =
      JSON.stringify(newSettings.timeframes) !== JSON.stringify(this.settings.timeframes) ||
      newSettings.marketType !== this.settings.marketType;

    this.settings = newSettings;
    this.storage.saveSettings(newSettings);

    if (needsRestart) {
      this.resetScannerState();
      this.startScanner();
    } else {
      this.updateUI();
    }
  }

  onClearHistory() {
    if (window.confirm('Ви впевнені, що хочете видалити всю історію угод?')) {
      this.lastSignalsHistory = [];
      this.storage.saveHistory([]);
      this.cdr.detectChanges();
    }
  }

  private initTimeframe(pairs: string[], tf: string) {
    console.log(`⏳ [TF ${tf}] Loading history...`);

    from(pairs).pipe(
      mergeMap(p => this.socketService.getKlinesHistory(p, tf, this.settings.marketType).pipe(
        map(data => ({ symbol: p.toUpperCase(), tf, data })),
        catchError(() => of(null)),
        delay(50) // Захист від бана по IP при масових запитах
      ), 5),
      toArray()
    ).subscribe(results => {
      results.filter(r => r !== null).forEach(res => {
        const key = `${res.symbol}_${res.tf}`;
        const formatted = res.data.map((k: any) => ({
          close: parseFloat(k[4]), high: parseFloat(k[2]), low: parseFloat(k[3]), open: parseFloat(k[1]), volume: parseFloat(k[5])
        }));

        this.klineHistory.set(key, formatted);
        const avg = formatted.reduce((acc: number, c: any) => acc + c.volume, 0) / formatted.length;
        this.volumeAverages.set(key, avg);
      });

      this.connectWebSocket(pairs, tf);
    });
  }

  private connectWebSocket(pairs: string[], tf: string) {
    const sub = this.socketService.connectKlines(pairs, tf, this.settings.marketType)
      .subscribe({
        next: (data) => this.analyzeData(data, tf),
        error: (err) => console.error(`🚨 [WS ${tf}] Error:`, err)
      });
    this.socketSubscriptions.set(tf, sub);
  }

  private resetScannerState() {
    this.socketSubscriptions.forEach(sub => sub.unsubscribe());
    this.socketSubscriptions.clear();
    this.activeSignals.clear();
    this.signalsList = [];
    this.klineHistory.clear();
    this.volumeAverages.clear();
  }

  // --- ЯДРО АНАЛІЗУ (MULTI-TF) ---

  private analyzeData(data: any, tf: string) {
    if (data.type === 'liquidation') return; // Ліквідації обробляються окремо (глобально)

    const kline = data;
    const key = `${kline.symbol}_${tf}`;

    // 1. Відстежуємо Paper Trading (Тейки/Стопи в реальному часі)
    const isHistoryUpdated = this.tracker.processTick(kline, this.lastSignalsHistory);
    if (isHistoryUpdated) {
      this.storage.saveHistory(this.lastSignalsHistory);
      this.updateUI();
    }

    // 2. Обробка закриття свічки
    if (kline.isClosed) {
      const activeSignal = this.activeSignals.get(key);
      if (activeSignal && !activeSignal.isStale) {
        this.addSignalToHistory(kline, activeSignal, tf);
      }
      this.updateKlineHistory(key, kline);
      this.updateVolumeAverage(key, kline.volume!);
      this.activeSignals.delete(key);
      this.updateUI();
    }
    // 3. Аналіз поточного Тіка
    else {
      this.processTick(kline, tf, key);
    }
  }

  private processTick(kline: any, tf: string, key: string) {
    const history = this.klineHistory.get(key) || [];
    if (history.length < 50) return;

    // Рахуємо динамічні метрики
    const avgVol = this.volumeAverages.get(key) || kline.volume!;
    const volMult = kline.volume! / avgVol;

    const ctx = this.createPatternContext(kline, history);
    const signal = this.detectTradeSignal(kline, volMult, ctx, history, tf);

    if (signal) {
      this.manageSignalLifecycle(key, signal);
    } else if (!this.settings.holdStale) {
      this.activeSignals.delete(key);
    }

    this.updateUI();
  }

  // --- ЛОГІКА СИГНАЛІВ ТА ПАТЕРНІВ ---

  private detectTradeSignal(kline: any, volMult: number, ctx: PatternContext, history: any[], tf: string): TradeSignal | null {
    // Dual-Mode логіка
    const isAnomalousVol = volMult >= (this.settings.volumeThreshold * 2);
    const hasLongDiv = this.checkAODivergence(history, 'LONG');
    const hasShortDiv = this.checkAODivergence(history, 'SHORT');

    const canEnterLong = this.settings.useDivergence ? (hasLongDiv || isAnomalousVol) : (volMult >= this.settings.volumeThreshold);
    const canEnterShort = this.settings.useDivergence ? (hasShortDiv || isAnomalousVol) : (volMult >= this.settings.volumeThreshold);

    // Пошук Long патернів
    if (ctx.isLocalBottom && this.settings.showLong && canEnterLong) {
      for (const detect of Detectors.LONG_DETECTORS) {
        const name = detect(ctx);
        if (name) {
          const suffix = isAnomalousVol ? '🔥' : (hasLongDiv ? '💎' : '');
          return this.createSignal(kline, 'LONG', `${name} ${suffix}`, volMult, tf, history);
        }
      }
    }

    // Пошук Short патернів
    if (ctx.isLocalPeak && this.settings.showShort && canEnterShort) {
      for (const detect of Detectors.SHORT_DETECTORS) {
        const name = detect(ctx);
        if (name) {
          const suffix = isAnomalousVol ? '🔥' : (hasShortDiv ? '💎' : '');
          return this.createSignal(kline, 'SHORT', `${name} ${suffix}`, volMult, tf, history);
        }
      }
    }

    return null;
  }

  private createSignal(kline: any, type: 'LONG' | 'SHORT', pattern: string, vol: number, tf: string, history: any[]): TradeSignal {
    const symbol = kline.symbol.toUpperCase();
    const tickSize = this.symbolTickSizes.get(symbol) || 0.0001;

    // Вхід на пробій (±1 тік)
    const entryPrice = type === 'LONG'
      ? this.roundToTick(kline.high + tickSize, tickSize)
      : this.roundToTick(kline.low - tickSize, tickSize);

    // Розрахунок SwingStrength (Відхилення від середньої за 20 свічок)
    const avgPrice = history.slice(-20).reduce((acc, k) => acc + k.close, 0) / 20;
    const swingStrength = Math.abs((entryPrice - avgPrice) / avgPrice) * 100;

    // Сила рівня (Bins - аналіз 500 свічок)
    const lookback = history.slice(-500);
    const levelData = this.findTrueLevel(lookback, type === 'LONG' ? 'RESISTANCE' : 'SUPPORT', entryPrice);

    // Stop Loss (1 тік за локальний екстремум)
    const sl = this.calculateSL(kline, history, type, tickSize);
    const tp = this.roundToTick(levelData.price, tickSize);

    const risk = Math.abs(entryPrice - sl) || tickSize;
    const reward = Math.abs(tp - entryPrice);

    return {
      symbol, type, pattern, timeframe: tf,
      currentPrice: kline.close,
      stopLoss: sl, takeProfit: tp,
      lvlStrength: levelData.strength,
      swingStrength: swingStrength,
      volumeMultiplier: vol,
      liqAmount: 0, // Заповнюється окремо якщо треба
      timestamp: Date.now(),
      quoteAsset: this.symbolQuotes.get(symbol) || 'USDT',
      profitPercent: (reward / entryPrice) * 100,
      rr: reward / risk
    };
  }

  // --- МАТЕМАТИЧНІ УТИЛІТИ ---

  /**
   * Розрахунок рівнів через кошики щільності (Bins)
   */
  private findTrueLevel(history: any[], type: 'SUPPORT' | 'RESISTANCE', currentPrice: number): { price: number, strength: number } {
    const minP = Math.min(...history.map(k => k.low));
    const maxP = Math.max(...history.map(k => k.high));
    const binSize = (maxP - minP) / 50;
    const bins = new Array(50).fill(0);

    history.forEach(k => {
      const s = Math.floor((k.low - minP) / binSize);
      const e = Math.floor((k.high - minP) / binSize);
      for (let i = s; i <= e; i++) if (i >= 0 && i < 50) bins[i]++;
    });

    const avgWeight = bins.reduce((a, b) => a + b, 0) / 50;
    let bestI = -1, maxW = 0;

    for (let i = 0; i < 50; i++) {
      const p = minP + (i * binSize);
      if (type === 'RESISTANCE' && p <= currentPrice) continue;
      if (type === 'SUPPORT' && p >= currentPrice) continue;
      if (bins[i] > maxW) { maxW = bins[i]; bestI = i; }
    }

    const strength = maxW / (avgWeight || 1);
    const price = bestI === -1
      ? (type === 'RESISTANCE' ? maxP : minP)
      : (type === 'RESISTANCE' ? minP + (bestI * binSize) : minP + (bestI * binSize) + binSize);

    return { price, strength };
  }

  /**
   * Дивергенція AO (з захистом від ножів та нульовою лінією)
   */
  private checkAODivergence(history: any[], type: 'LONG' | 'SHORT'): boolean {
    const len = history.length;
    if (len < 50) return false;
    const ao = history.map((_, i) => this.calculateAO(history, i));
    const curr = ao[len - 1], prev = ao[len - 2];

    if (type === 'LONG') {
      if (curr <= prev || curr >= 0) return false; // Гістограма має бути зеленою і під нулем
      let recM = Infinity, recAO = Infinity, i = len - 1;
      for (; i >= len - 20; i--) {
        if (history[i].low < recM) recM = history[i].low;
        if (ao[i] < recAO) recAO = ao[i];
        if (ao[i] > 0) break;
      }
      let pastM = Infinity, pastAO = Infinity;
      for (; i >= len - 50; i--) {
        if (history[i].low < pastM) pastM = history[i].low;
        if (ao[i] < pastAO) pastAO = ao[i];
      }
      return (recM < pastM) && (recAO > pastAO);
    } else {
      if (curr >= prev || curr <= 0) return false;
      let recM = -Infinity, recAO = -Infinity, i = len - 1;
      for (; i >= len - 20; i--) {
        if (history[i].high > recM) recM = history[i].high;
        if (ao[i] > recAO) recAO = ao[i];
        if (ao[i] < 0) break;
      }
      let pastM = -Infinity, pastAO = -Infinity;
      for (; i >= len - 50; i--) {
        if (history[i].high > pastM) pastM = history[i].high;
        if (ao[i] > pastAO) pastAO = ao[i];
      }
      return (recM > pastM) && (recAO < pastAO);
    }
  }

  private calculateAO(history: any[], index: number): number {
    if (index < 33) return 0;
    const mid = (i: number) => (history[i].high + history[i].low) / 2;
    let s5 = 0; for (let i = index - 4; i <= index; i++) s5 += mid(i);
    let s34 = 0; for (let i = index - 33; i <= index; i++) s34 += mid(i);
    return (s5 / 5) - (s34 / 34);
  }

  private roundToTick(price: number, tick: number): number {
    const p = Math.max(0, -Math.floor(Math.log10(tick)));
    return parseFloat((Math.round(price / tick) * tick).toFixed(p));
  }

  // --- УПРАВЛІННЯ UI ТА ІСТОРІЄЮ ---

  private addSignalToHistory(kline: any, sig: TradeSignal, tf: string) {
    // ✅ Отримуємо правильний тік для конкретної монети
    const tick = this.symbolTickSizes.get(kline.symbol.toUpperCase()) || 0.0001;

    // ✅ Розраховуємо вхід правильно (1 тік від хая/лоу)
    const entryPrice = sig.type === 'LONG'
      ? this.roundToTick(kline.high + tick, tick)
      : this.roundToTick(kline.low - tick, tick);

    this.lastSignalsHistory.unshift({
      id: Date.now() + Math.random(),
      time: new Date().toLocaleTimeString(),
      symbol: kline.symbol,
      timeframe: tf,
      type: sig.type,
      pattern: sig.pattern,
      price: entryPrice, // Використовуємо розрахований entryPrice
      sl: sig.stopLoss,
      tp: sig.takeProfit,
      rr: sig.rr,
      volMult: sig.volumeMultiplier,
      swingStrength: sig.swingStrength,
      lvlStrength: sig.lvlStrength,
      liq: sig.liqAmount,
      status: 'PENDING',
      quoteAsset: sig.quoteAsset,
      isOpened: false
    });

    if (this.lastSignalsHistory.length > 2000) this.lastSignalsHistory.pop(); // Збільшив до 2к для Big Data
    this.storage.saveHistory(this.lastSignalsHistory);
  }

  updateUI() {
    this.signalsList = Array.from(this.activeSignals.values())
      .filter(s => (s.type === 'LONG' && this.settings.showLong) || (s.type === 'SHORT' && this.settings.showShort))
      .sort((a, b) => b.timestamp - a.timestamp);
    this.cdr.detectChanges();
  }

  // --- ДОПОМІЖНІ МЕТОДИ ---

  private processExchangeInfo(symbols: any[]) {
    symbols.forEach(s => {
      const sym = s.symbol.toUpperCase();
      this.symbolQuotes.set(sym, s.quoteAsset.toUpperCase());
      const f = s.filters.find((f: any) => f.filterType === 'PRICE_FILTER');
      if (f) this.symbolTickSizes.set(sym, parseFloat(f.tickSize));
    });
  }

  private createPatternContext(kline: any, history: any[]): PatternContext {
    const lastN = history.slice(-this.settings.swingPeriod);
    return {
      kline,
      lastCandle: history[history.length - 1],
      history: history,
      avgBody: history.slice(-10).reduce((acc, k) => acc + Math.abs(k.close - k.open), 0) / 10,
      isLocalBottom: kline.low! <= Math.min(...lastN.map(k => k.low)),
      isLocalPeak: kline.high! >= Math.max(...lastN.map(k => k.high))
    };
  }

  private calculateSL(kline: any, history: any[], type: 'LONG' | 'SHORT', tick: number): number {
    const candles = history.slice(-3);
    return type === 'LONG'
      ? this.roundToTick(Math.min(...candles.map(k => k.low), kline.low) - tick, tick)
      : this.roundToTick(Math.max(...candles.map(k => k.high), kline.high) + tick, tick);
  }

  private updateKlineHistory(key: string, kline: any) {
    let h = this.klineHistory.get(key) || [];
    h.push({ close: kline.close, high: kline.high, low: kline.low, open: kline.open, volume: kline.volume });
    if (h.length > 600) h.shift();
    this.klineHistory.set(key, h);
  }

  private updateVolumeAverage(key: string, vol: number) {
    const a = this.volumeAverages.get(key) || vol;
    this.volumeAverages.set(key, (a * 19 + vol) / 20);
  }

  private cleanupKlineData(symbol: string) {
    // В мульти-ТФ очистка йде по конкретному ключу SYMBOL_TF в handleClosedKline
  }

  private manageSignalLifecycle(key: string, signal: TradeSignal) {
    if (signal.rr >= this.settings.minRR) {
      this.cancelRemoval(key);
      this.activeSignals.set(key, signal);
      if (this.settings.soundEnabled) this.playAlertSound();
    }
  }

  private cancelRemoval(key: string) {
    if (this.removalTimeouts.has(key)) {
      clearTimeout(this.removalTimeouts.get(key));
      this.removalTimeouts.delete(key);
    }
  }

  private playAlertSound() {
    new Audio('https://actions.google.com/sounds/v1/alarms/beep_short.ogg').play().catch(() => {});
  }
}