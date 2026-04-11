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
      this.mapSymbolQuotes(info.symbols);
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

    // ✅ ВІДСТЕЖУЄМО ЖИВІ ПОЗИЦІЇ НА КОЖНОМУ ТІКУ
    const isHistoryUpdated = this.tracker.processTick(kline, this.lastSignalsHistory);
    if (isHistoryUpdated) {
      this.storage.saveHistory(this.lastSignalsHistory); // Зберігаємо новий статус
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

    if (signal && !signal.isStale) {
      // Розрахунок правильної точки входу (на пробій)
      // Для LONG - на 0.05% вище хая свічки. Для SHORT - на 0.05% нижче лоу.
      const entryPrice = signal.type === 'LONG'
        ? kline.high * 1.0005
        : kline.low * 0.9995;

      this.addToHistory(symbol, signal.type, entryPrice, signal.liqAmount, signal.pattern, signal.stopLoss, signal.takeProfit, signal.rr);
    }

    this.cleanupKlineData(symbol);

    // ✅ ВЖИВАЄМО ІСНУЮЧІ МЕТОДИ ЗАМІСТЬ updateHistoryBuffers
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

    // 1. ВИЗНАЧАЄМО РЕАЛЬНУ ТОЧКУ ВХОДУ (на пробій патерну)
    const entryPrice = type === 'LONG' ? kline.high * 1.0005 : kline.low * 0.9995;

    // 2. STOP LOSS
    const patternCandles = history.slice(-3);
    let sl = 0;
    if (type === 'LONG') {
      const lowestPoint = Math.min(...patternCandles.map(k => k.low), kline.low);
      sl = lowestPoint * 0.9995;
    } else {
      const highestPoint = Math.max(...patternCandles.map(k => k.high), kline.high);
      sl = highestPoint * 1.0005;
    }

    // 3. РОЗУМНИЙ TAKE PROFIT (передаємо entryPrice замість kline.close)
    const lookback = history.slice(-100);
    let tp = 0;

    if (type === 'LONG') {
      const trueResistance = this.findTrueLevel(lookback, 'RESISTANCE', entryPrice);
      // Захист: TP має бути мінімум на 0.5% вище ЦІНИ ВХОДУ
      tp = Math.max(trueResistance * 0.999, entryPrice * 1.005);
    } else {
      const trueSupport = this.findTrueLevel(lookback, 'SUPPORT', entryPrice);
      // Захист: TP має бути мінімум на 0.5% нижче ЦІНИ ВХОДУ
      tp = Math.min(trueSupport * 1.001, entryPrice * 0.995);
    }

    // 4. ПРАВИЛЬНА МАТЕМАТИКА (Рахуємо від entryPrice, а не від kline.close!)
    const risk = Math.abs(entryPrice - sl) || 0.000001;
    const reward = Math.abs(tp - entryPrice);

    return {
      symbol, type, pattern,
      currentPrice: kline.close, // Поточну ціну залишаємо для відображення в UI
      stopLoss: sl,
      takeProfit: tp,
      quoteAsset: this.symbolQuotes.get(symbol) || 'USDT',
      profitPercent: (reward / entryPrice) * 100, // Відсоток профіту теж від ціни входу
      volumeMultiplier: vol,
      liqAmount: liq,
      timestamp: Date.now(),
      rr: reward / risk // Тепер це буде збігатися з Binance на 100%
    };
  }

  private addToHistory(symbol: string, type: string, entryPrice: number, liq: number, pattern: string, sl: number, tp: number, rr: number) {
    this.lastSignalsHistory.unshift({
      id: Date.now() + Math.random(),
      time: new Date().toLocaleTimeString(),
      symbol,
      quoteAsset: this.symbolQuotes.get(symbol) || 'USDT',
      type,
      pattern,
      price: entryPrice,
      sl: sl,
      tp: tp,
      rr: rr, // ✅ ЗБЕРІГАЄМО R/R
      liq,
      status: 'PENDING', // ✅ ДОДАЛИ СТАТУС ПРИ СТВОРЕННІ
      isOpened: false    // ✅ ДОДАЛИ ПРАПОРЕЦЬ
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

  /**
   * Професійний пошук рівнів (Фрактальна кластеризація)
   * @param history Масив свічок для аналізу (наприклад, 80-100 штук)
   * @param type 'SUPPORT' (Дно) або 'RESISTANCE' (Вершина)
   */
  private findTrueLevel(history: any[], type: 'SUPPORT' | 'RESISTANCE', currentPrice: number): number {
    const swings: number[] = [];

    // 1. Шукаємо фрактали, які мають логічний сенс (тільки ВИЩЕ для опору, ТІЛЬКИ НИЖЧЕ для підтримки)
    for (let i = 2; i < history.length - 2; i++) {
      if (type === 'RESISTANCE') {
        if (history[i].high > currentPrice) { // ФІЛЬТР: Опір має бути вище ціни входу
          const isFractalHigh = history[i].high > history[i-1].high && history[i].high > history[i-2].high &&
            history[i].high > history[i+1].high && history[i].high > history[i+2].high;
          if (isFractalHigh) swings.push(history[i].high);
        }
      } else {
        if (history[i].low < currentPrice) { // ФІЛЬТР: Підтримка має бути нижче ціни входу
          const isFractalLow = history[i].low < history[i-1].low && history[i].low < history[i-2].low &&
            history[i].low < history[i+1].low && history[i].low < history[i+2].low;
          if (isFractalLow) swings.push(history[i].low);
        }
      }
    }

    // Fallback: якщо ми на абсолютному Хаї або Лоу і фракталів попереду немає
    if (swings.length === 0) {
      if (type === 'RESISTANCE') {
        const above = history.filter(k => k.high > currentPrice);
        if (above.length === 0) return currentPrice * 1.015; // Якщо це абсолютний перехай, цілимось на +1.5%
        const sorted = [...above].sort((a, b) => b.high - a.high);
        return sorted[1]?.high || sorted[0].high;
      } else {
        const below = history.filter(k => k.low < currentPrice);
        if (below.length === 0) return currentPrice * 0.985; // Якщо абсолютне дно, цілимось на -1.5%
        const sorted = [...below].sort((a, b) => a.low - b.low);
        return sorted[1]?.low || sorted[0].low;
      }
    }

    // 2. Кластеризація (Шукаємо зону з найбільшою кількістю дотиків)
    let bestLevel = swings[0];
    let maxTouches = 0;
    const tolerance = 0.002;

    for (const s of swings) {
      const touches = swings.filter(x => Math.abs(x - s) / s <= tolerance).length;

      if (touches > maxTouches) {
        maxTouches = touches;
        bestLevel = s;
      } else if (touches === maxTouches) {
        // Якщо дотиків однаково: для тейку беремо НАЙБЛИЖЧИЙ рівень (щоб 100% виконався ордер)
        if (type === 'RESISTANCE') bestLevel = Math.min(bestLevel, s);
        else bestLevel = Math.max(bestLevel, s);
      }
    }

    return bestLevel;
  }}