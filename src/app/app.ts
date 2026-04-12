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
import { PositionTrackerService } from './services/position-tracker.service';

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
  private symbolTickSizes: Map<string, number> = new Map(); // ✅ ДОДАЛИ СЛОВНИК ТІКІВ

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
    useDivergence: false,
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
      this.processExchangeInfo(info.symbols);
      this.loadMarketData();
    });
  }

  onClearHistory() {
    // Питаємо підтвердження, щоб кент випадково не стер профіти
    if (window.confirm('Ви впевнені, що хочете видалити всю історію угод?')) {
      this.lastSignalsHistory = []; // Очищаємо масив у пам'яті
      this.storage.saveHistory([]); // Перезаписуємо LocalStorage порожнім масивом
      this.cdr.detectChanges();     // Оновлюємо інтерфейс
    }
  }

// ✅ ПЕРЕЙМЕНОВАНО НА БІЛЬШ ЛОГІЧНУ НАЗВУ
  private processExchangeInfo(symbols: any[]) {
    symbols.forEach(s => {
      const symbol = s.symbol.toUpperCase();
      this.symbolQuotes.set(symbol, s.quoteAsset.toUpperCase());

      // Дістаємо правильний крок ціни (tickSize) з налаштувань Binance
      const priceFilter = s.filters.find((f: any) => f.filterType === 'PRICE_FILTER');
      if (priceFilter) {
        this.symbolTickSizes.set(symbol, parseFloat(priceFilter.tickSize));
      }
    });
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
    const isHistoryUpdated = this.tracker.processTick(kline, this.lastSignalsHistory);

    if (isHistoryUpdated) {
      this.storage.saveHistory(this.lastSignalsHistory);
      this.updateUI();
    }

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
    const tickSize = this.symbolTickSizes.get(symbol) || 0.0001;

    if (signal && !signal.isStale) {
      // Розрахунок точки входу по тіках для історії
      const entryPrice = signal.type === 'LONG'
        ? this.roundToTick(kline.high + tickSize, tickSize)
        : this.roundToTick(kline.low - tickSize, tickSize);

      this.addToHistory(
        symbol,
        signal.type,
        entryPrice,
        signal.liqAmount,
        signal.pattern,
        signal.stopLoss,
        signal.takeProfit,
        signal.rr,
        signal.volumeMultiplier, // Передаємо для статистики
        signal.swingStrength     // Передаємо для статистики
      );
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

    // Dual-Mode: Аномальний об'єм = х2 від порогу (наприклад 2.5 * 2 = 5.0)
    const isAnomalousVolume = m.volMult >= (this.settings.volumeThreshold * 2);
    const hasLongDiv = this.checkAODivergence(history, 'LONG');
    const hasShortDiv = this.checkAODivergence(history, 'SHORT');

    // Якщо увімкнена дивергенція - пропускаємо або з дивером, або з аномальним об'ємом
    const canEnterLong = this.settings.useDivergence ? (hasLongDiv || isAnomalousVolume) : true;
    const canEnterShort = this.settings.useDivergence ? (hasShortDiv || isAnomalousVolume) : true;

    if (m.isLocalBottom && this.settings.showLong && canEnterLong) {
      for (const detect of Detectors.LONG_DETECTORS) {
        const name = detect(ctx);
        if (name) {
          const suffix = isAnomalousVolume ? '🔥' : (hasLongDiv ? '💎' : '');
          return this.createSignal(kline, 'LONG', `${name} ${suffix}`, m.volMult, m.liqAmount, history);
        }
      }
    }

    if (m.isLocalPeak && this.settings.showShort && canEnterShort) {
      for (const detect of Detectors.SHORT_DETECTORS) {
        const name = detect(ctx);
        if (name) {
          const suffix = isAnomalousVolume ? '🔥' : (hasShortDiv ? '💎' : '');
          return this.createSignal(kline, 'SHORT', `${name} ${suffix}`, m.volMult, m.liqAmount, history);
        }
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
    const tickSize = this.symbolTickSizes.get(symbol) || 0.0001;

    const entryPrice = type === 'LONG'
      ? this.roundToTick(kline.high + tickSize, tickSize)
      : this.roundToTick(kline.low - tickSize, tickSize);

    // ✅ РОЗРАХУНОК SWING STRENGTH (суто для статистики)
    const avgPrice = history.slice(-20).reduce((acc, k) => acc + k.close, 0) / 20;
    const swingStrength = Math.abs((entryPrice - avgPrice) / avgPrice) * 100;

    // Stop Loss (1 тік за патерн)
    const patternCandles = history.slice(-3);
    let sl = 0;
    if (type === 'LONG') {
      sl = this.roundToTick(Math.min(...patternCandles.map(k => k.low), kline.low) - tickSize, tickSize);
    } else {
      sl = this.roundToTick(Math.max(...patternCandles.map(k => k.high), kline.high) + tickSize, tickSize);
    }

    // Take Profit (Bins - 500 свічок)
    const lookback = history.slice(-500);
    const rawTp = this.findTrueLevel(lookback, type === 'LONG' ? 'RESISTANCE' : 'SUPPORT', entryPrice);
    const tp = this.roundToTick(rawTp, tickSize);

    const risk = Math.abs(entryPrice - sl) || tickSize;
    const reward = Math.abs(tp - entryPrice);

    return {
      symbol, type, pattern,
      currentPrice: kline.close,
      stopLoss: sl, takeProfit: tp,
      quoteAsset: this.symbolQuotes.get(symbol) || 'USDT',
      profitPercent: (reward / entryPrice) * 100,
      volumeMultiplier: vol,
      liqAmount: liq,
      timestamp: Date.now(),
      rr: reward / risk,
      swingStrength: swingStrength // Передаємо далі
    };
  }

  private addToHistory(symbol: string, type: string, entryPrice: number, liq: number, pattern: string, sl: number, tp: number, rr: number, vol: number, swing: number) {
    this.lastSignalsHistory.unshift({
      id: Date.now() + Math.random(),
      time: new Date().toLocaleTimeString(),
      symbol,
      quoteAsset: this.symbolQuotes.get(symbol) || 'USDT',
      type, pattern, price: entryPrice, sl, tp, rr, liq,
      volMult: vol,        // ✅ Для статистики
      swingStrength: swing, // ✅ Для статистики
      status: 'PENDING',
      isOpened: false
    });
    if (this.lastSignalsHistory.length > 1000) this.lastSignalsHistory.pop();
    this.storage.saveHistory(this.lastSignalsHistory);
  }

  private updateUI() {
    this.signalsList = Array.from(this.activeSignals.values())
      .filter(s => (s.type === 'LONG' && this.settings.showLong) || (s.type === 'SHORT' && this.settings.showShort))
      .sort((a, b) => b.liqAmount - a.liqAmount);
    this.cdr.detectChanges();
  }

  /**
   * Професійний пошук рівнів (Фрактальна кластеризація)
   * @param history Масив свічок для аналізу (наприклад, 80-100 штук)
   * @param type 'SUPPORT' (Дно) або 'RESISTANCE' (Вершина)
   */
  private findTrueLevel(history: any[], type: 'SUPPORT' | 'RESISTANCE', currentPrice: number): number {
    if (history.length === 0) return currentPrice * (type === 'RESISTANCE' ? 1.02 : 0.98);

    // 1. Визначаємо діапазон аналізу
    const highs = history.map(k => k.high);
    const lows = history.map(k => k.low);
    const minPrice = Math.min(...lows);
    const maxPrice = Math.max(...highs);

    // Створюємо 50 "кошиків" (зон) між мінімумом і максимумом
    const binCount = 50;
    const binSize = (maxPrice - minPrice) / binCount;
    const bins = new Array(binCount).fill(0);

    // 2. Наповнюємо кошики "вагою"
    // Кожна свічка додає вагу в кошик, через який вона проходила
    history.forEach(k => {
      const startBin = Math.floor((k.low - minPrice) / binSize);
      const endBin = Math.floor((k.high - minPrice) / binSize);

      for (let i = startBin; i <= endBin; i++) {
        if (i >= 0 && i < binCount) {
          // Додаємо вагу (можна додавати 1 як дотик, або k.volume для точності)
          bins[i] += 1;
        }
      }
    });

    // 3. Шукаємо найкращий кошик (Зону)
    let bestBinIndex = -1;
    let maxWeight = 0;

    for (let i = 0; i < binCount; i++) {
      const binPrice = minPrice + (i * binSize);

      // Фільтр: для LONG шукаємо тільки ВИЩЕ поточної ціни, для SHORT - НИЖЧЕ
      if (type === 'RESISTANCE' && binPrice <= currentPrice) continue;
      if (type === 'SUPPORT' && binPrice >= currentPrice) continue;

      if (bins[i] > maxWeight) {
        maxWeight = bins[i];
        bestBinIndex = i;
      }
    }

    // 4. Якщо нічого не знайшли в потрібному напрямку - беремо екстремум
    if (bestBinIndex === -1) {
      return type === 'RESISTANCE' ? maxPrice : minPrice;
    }

    // Повертаємо центр "найважчого" кошика
    if (type === 'RESISTANCE') {
      // Для Long тейк має бути на НИЖНІЙ межі кошика (куди ціна підніметься спочатку)
      return minPrice + (bestBinIndex * binSize);
    } else {
      // Для Short тейк має бути на ВЕРХНІЙ межі кошика (куди ціна впаде спочатку)
      return minPrice + (bestBinIndex * binSize) + binSize;
    }
  }
  /**
   * Розрахунок Awesome Oscillator (AO)
   * Формула: SMA(High+Low/2, 5) - SMA(High+Low/2, 34)
   */
  private calculateAO(history: any[], index: number): number {
    if (index < 33) return 0; // Для AO потрібно мінімум 34 свічки

    let sum5 = 0;
    for (let i = index - 4; i <= index; i++) {
      sum5 += (history[i].high + history[i].low) / 2;
    }
    const sma5 = sum5 / 5;

    let sum34 = 0;
    for (let i = index - 33; i <= index; i++) {
      sum34 += (history[i].high + history[i].low) / 2;
    }
    const sma34 = sum34 / 34;

    return sma5 - sma34;
  }

  private checkAODivergence(history: any[], type: 'LONG' | 'SHORT'): boolean {
    const len = history.length;
    if (len < 50) return false;

    // Рахуємо AO для всієї доступної історії
    const ao = history.map((_, i) => this.calculateAO(history, i));

    const currentAO = ao[len - 1];
    const prevAO = ao[len - 2];

    if (type === 'LONG') {
      // 1. ЗАХИСТ ВІД "ПАДАЮЧОГО НОЖА" (Колір гістограми)
      // Якщо АО падає (червона гістограма) - імпульс продавців сильний, входити ЗАБОРОНЕНО!
      if (currentAO <= prevAO) return false;
      if (currentAO >= 0) return false; // Дно має бути тільки під нульовою лінією

      // 2. Шукаємо дно "поточної" хвилі
      let recentMinPrice = Infinity, recentMinAO = Infinity;
      let i = len - 1;
      // Йдемо назад, поки хвиля не закінчиться (не перетне нуль вгору) або не пройдемо 20 свічок
      for (; i >= len - 20; i--) {
        if (history[i].low < recentMinPrice) recentMinPrice = history[i].low;
        if (ao[i] < recentMinAO) recentMinAO = ao[i];
        if (ao[i] > 0) break; // Хвиля продавців закінчилась
      }

      // 3. Шукаємо дно "попередньої" хвилі
      let pastMinPrice = Infinity, pastMinAO = Infinity;
      // Йдемо ще далі в минуле (від кінця першої хвилі)
      for (; i >= len - 50; i--) {
        if (history[i].low < pastMinPrice) pastMinPrice = history[i].low;
        if (ao[i] < pastMinAO) pastMinAO = ao[i];
      }

      // Запобіжник, якщо історія неповна
      if (recentMinAO === Infinity || pastMinAO === Infinity) return false;

      // 4. КЛАСИЧНА ДИВЕРГЕНЦІЯ:
      // Ціна зробила нижчий мінімум (падає), а AO зробив вищий мінімум (імпульс згас)
      return (recentMinPrice < pastMinPrice) && (recentMinAO > pastMinAO);
    }

    else { // Для SHORT (Ведмежа дивергенція)
      // 1. ЗАХИСТ ВІД "РАКЕТИ" (Колір гістограми)
      // Якщо АО росте (зелена гістограма) - імпульс покупців сильний, шортити ЗАБОРОНЕНО!
      if (currentAO >= prevAO) return false;
      if (currentAO <= 0) return false; // Вершина має бути тільки над нульовою лінією

      // 2. Шукаємо вершину "поточної" хвилі
      let recentMaxPrice = -Infinity, recentMaxAO = -Infinity;
      let i = len - 1;
      for (; i >= len - 20; i--) {
        if (history[i].high > recentMaxPrice) recentMaxPrice = history[i].high;
        if (ao[i] > recentMaxAO) recentMaxAO = ao[i];
        if (ao[i] < 0) break; // Хвиля покупців закінчилась
      }

      // 3. Шукаємо вершину "попередньої" хвилі
      let pastMaxPrice = -Infinity, pastMaxAO = -Infinity;
      for (; i >= len - 50; i--) {
        if (history[i].high > pastMaxPrice) pastMaxPrice = history[i].high;
        if (ao[i] > pastMaxAO) pastMaxAO = ao[i];
      }

      if (recentMaxAO === -Infinity || pastMaxAO === -Infinity) return false;

      // 4. КЛАСИЧНА ДИВЕРГЕНЦІЯ:
      // Ціна зробила вищий максимум (росте), а AO зробив нижчий максимум (покупці видихлись)
      return (recentMaxPrice > pastMaxPrice) && (recentMaxAO < pastMaxAO);
    }
  }

  /**
   * Округлює ціну до найближчого дозволеного кроку (tickSize)
   */
  private roundToTick(price: number, tickSize: number): number {
    if (!tickSize) return price;
    // Рахуємо кількість знаків після коми в tickSize (наприклад, 0.001 -> 3)
    const precision = Math.max(0, -Math.floor(Math.log10(tickSize)));
    // Округлюємо математично
    const rounded = Math.round(price / tickSize) * tickSize;
    // Повертаємо чисте число без артефактів JS
    return parseFloat(rounded.toFixed(precision));
  }
}