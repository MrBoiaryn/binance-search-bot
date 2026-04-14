import { Component, OnInit, ChangeDetectorRef, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { from, of, delay, mergeMap, map, toArray, catchError, Subject, auditTime, takeUntil, Subscription } from 'rxjs';

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
  private uiUpdate$ = new Subject<void>();

  // --- НАЛАШТУВАННЯ ---
  settings: ScannerSettings = {
    marketType: 'futures',
    timeframes: ['1m'],
    minVolMult: 1.5,
    maxVolMult: 4.0,   // Додано
    swingPeriod: 10,
    minSwing: 0.3,     // Змінено назву
    maxSwing: 2.2,     // Додано
    minLvlStrength: 2.5, // Додано
    minRR: 1.5,
    maxRR: 3.0,        // Додано
    maxClusterSize: 4, // Додано
    soundEnabled: true,
    holdStale: false,
    showLong: true,
    showShort: true,
    useDivergence: false,
    trailingBars: 5,
    minProfitThreshold: 0.7,
  };

  constructor(
    private socketService: BinanceSocketService,
    private cdr: ChangeDetectorRef,
    private storage: TradeStorageService,
    private tracker: PositionTrackerService,
  ) {
    setInterval(() => this.clusterTracker.clear(), 60000);
    // UI Тротлінг: оновлюємо екран не частіше 2 разів на секунду
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
    this.resetScannerState();
  }

  // --- ІНІЦІАЛІЗАЦІЯ ТА ПІДКЛЮЧЕННЯ ---

  private loadInitialConfig() {
    const saved = this.storage.loadSettings();
    if (saved) this.settings = { ...this.settings, ...saved };
    this.lastSignalsHistory = this.storage.loadHistory();
    console.log(this.settings);
  }

  startScanner() {
    console.log(`📡 [SYSTEM] Starting Multi-TF Scanner...`);

    this.socketService.getExchangeInfo(this.settings.marketType)
      .pipe(takeUntil(this.destroy$))
      .subscribe(info => {
        this.processExchangeInfo(info.symbols);

        this.socketService.getTopPairs(this.settings.marketType)
          .pipe(takeUntil(this.destroy$))
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
    console.log(`⏳ [TF ${tf}] Loading history...`);

    from(pairs).pipe(
      mergeMap(p => this.socketService.getKlinesHistory(p, tf, this.settings.marketType).pipe(
        map(data => ({ symbol: p.toUpperCase(), tf, data })),
        catchError(() => of(null)),
        delay(200)
      ), 5),
      toArray(),
      takeUntil(this.destroy$)
    ).subscribe(results => {
      results.filter(r => r !== null).forEach(res => {
        const key = `${res.symbol}_${res.tf}`;
        const formatted = res.data.map((k: any) => ({
          close: parseFloat(k[4]), 
          high: parseFloat(k[2]), 
          low: parseFloat(k[3]), 
          open: parseFloat(k[1]), 
          volume: parseFloat(k[5]),
          ao: 0 // Для кешування
        }));

        // Попередній розрахунок AO для завантаженої історії
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
      .pipe(takeUntil(this.destroy$))
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

  // --- ЯДРО АНАЛІЗУ ---

// App.ts -> analyzeData

  private analyzeData(data: any, tf: string) {
    // Пропускаємо, якщо прийшли дані про ліквідацію (якщо ти їх не обробляєш окремо)
    if (data.type === 'liquidation') return;

    const kline = data;
    const symbol = kline.symbol.toUpperCase();
    const key = `${symbol}_${tf}`;

    // 1. ОТРИМУЄМО ДАНІ ДЛЯ АНАЛІЗУ
    const history = this.klineHistory.get(key) || [];
    const avgVol = this.volumeAverages.get(key) || kline.volume!;
    const tickSize = this.symbolTickSizes.get(symbol) || 0.0001;

    // 2. РАХУЄМО АДАПТИВНИЙ ОБ'ЄМ (з проекцією після 50% часу свічки)
    const volMult = this.calculateVolMult(kline, tf, avgVol);

    // 3. СУПРОВІД ВІДКРИТИХ ПОЗИЦІЙ (Trailing Stop та перевірка SL/TP)
    // Передаємо: поточну свічку, всю історію угод, історію свічок монети, параметр трейлінгу та тік-сайз
    const isHistoryUpdated = this.tracker.processTick(
      { ...kline, tf },
      this.lastSignalsHistory,
      history,
      this.settings.trailingBars,
      tickSize
    );

    // Якщо трекер щось змінив (відкрив угоду, підтягнув стоп або закрив по TP/SL) — оновлюємо сховище та UI
    if (isHistoryUpdated) {
      this.storage.saveHistory(this.lastSignalsHistory);
      this.uiUpdate$.next();
    }

    // 4. ОБРОБКА ЗАКРИТТЯ СВІЧКИ ТА ПОШУК НОВИХ СИГНАЛІВ
    if (kline.isClosed) {
      // Фінальний аналіз закритої свічки
      this.processTick(kline, tf, key);

      // Якщо за результатами аналізу з'явився валідний сигнал — додаємо його в журнал
      const validFinalSignal = this.activeSignals.get(key);
      if (validFinalSignal) {
        this.addSignalToHistory(kline, validFinalSignal, tf);
      }

      // Оновлюємо кеш історії свічок (додаємо нову закриту свічку)
      this.updateKlineHistory(key, kline);

      // Оновлюємо середній об'єм (Moving Average об'єму)
      this.updateVolumeAverage(key, kline.volume!);

      // Очищуємо тимчасовий активний сигнал, бо свічка закрита
      this.activeSignals.delete(key);
      this.uiUpdate$.next();
    }

    // 5. АНАЛІЗ ПОТОЧНОГО ТІКА (поки свічка ще формується)
    else {
      // Шукаємо патерни в реальному часі
      this.processTick(kline, tf, key);
    }
  }
  private processTick(kline: any, tf: string, key: string) {
    const history = this.klineHistory.get(key) || [];
    if (history.length < 50) return;

    const avgVol = this.volumeAverages.get(key) || kline.volume!;
    
    // ✅ ВИДАЛЕНО VOLUME PROJECTION: беремо тільки реальний об'єм свічки на даний момент
    const volMult = this.calculateVolMult(kline, tf, avgVol);

    const ctx = this.createPatternContext(kline, history);
    const signal = this.detectTradeSignal(kline, volMult, ctx, history, tf);

    if (signal) {
      const isNew = !this.activeSignals.has(key);
      this.activeSignals.set(key, signal);

      if (isNew && this.settings.soundEnabled) {
        this.playAlertSound();
      }
    } else {
      this.activeSignals.delete(key);
    }

    this.uiUpdate$.next();
  }

  // --- ЛОГІКА СИГНАЛІВ ТА ПАТЕРНІВ ---

  private detectTradeSignal(kline: any, volMult: number, ctx: PatternContext, history: any[], tf: string): TradeSignal | null {
    // 1. ПЕРЕВІРКА ОБ'ЄМУ (Min/Max)
    if (volMult < this.settings.minVolMult || volMult > this.settings.maxVolMult) return null;

    const currentAO = this.calculateAOForTick(history, kline);

    // Функція для перевірки щільності (кластера)
    const isTooDense = (name: string, type: string) => {
      const key = `${name}_${type}_${tf}`;
      const count = this.clusterTracker.get(key) || 0;
      return count >= this.settings.maxClusterSize;
    };

    // LONG
    if (ctx.isLocalBottom && this.settings.showLong) {
      for (const detect of Detectors.LONG_DETECTORS) {
        const name = detect(ctx);
        if (name) {
          if (isTooDense(name, 'LONG')) return null; // Фільтр кластера

          const signal = this.createSignal(kline, 'LONG', name, volMult, tf, history);
          if (this.isValidSignal(signal)) {
            // Реєструємо в кластері
            const key = `${name}_LONG_${tf}`;
            this.clusterTracker.set(key, (this.clusterTracker.get(key) || 0) + 1);
            return signal;
          }
        }
      }
    }

    // SHORT
    if (ctx.isLocalPeak && this.settings.showShort) {
      for (const detect of Detectors.SHORT_DETECTORS) {
        const name = detect(ctx);
        if (name) {
          if (isTooDense(name, 'SHORT')) return null; // Фільтр кластера

          const signal = this.createSignal(kline, 'SHORT', name, volMult, tf, history);
          if (this.isValidSignal(signal)) {
            const key = `${name}_SHORT_${tf}`;
            this.clusterTracker.set(key, (this.clusterTracker.get(key) || 0) + 1);
            return signal;
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
      // && sig.rr <= this.settings.maxRR
    );
  }

  private createSignal(kline: any, type: 'LONG' | 'SHORT', pattern: string, vol: number, tf: string, history: any[]): TradeSignal | null {
    const symbol = kline.symbol.toUpperCase();
    const tickSize = this.symbolTickSizes.get(symbol) || 0.0001;

    // 1. Розрахунок точки входу (на пробій екстремуму)
    const entryPrice = type === 'LONG'
      ? this.roundToTick(kline.high + tickSize, tickSize)
      : this.roundToTick(kline.low - tickSize, tickSize);

    // 2. Перевірка натягу (відхилення від MA20)
    const typicalPrice = (kline.high + kline.low + kline.close) / 3;
    const avgPrice = history.slice(-20).reduce((acc, k) => acc + k.close, 0) / 20;
    const maDeviation = Math.abs((typicalPrice - avgPrice) / avgPrice) * 100;

    // ✅ Використовуємо нове поле minSwing для швидкої перевірки
    if (maDeviation < this.settings.minSwing) return null;

    // 3. Розрахунок ризику (Стоп-Лосс)
    const sl = this.calculateSL(kline, history, type, tickSize);
    const actualRisk = Math.abs(entryPrice - sl) || tickSize;

    const recentCandles = history.slice(-10);
    const avgCandleRange = recentCandles.reduce((acc, k) => acc + (k.high - k.low), 0) / 10;
    const minAllowedRisk = Math.max(avgCandleRange, entryPrice * 0.001);
    const effectiveRiskForTP = Math.max(actualRisk, minAllowedRisk);

    // 4. Розрахунок цілі (Тейк-Профіт)
// 4. Розрахунок цілі (Тейк-Профіт)
    const levelData = this.findTrueLevel(history.slice(-500), type === 'LONG' ? 'RESISTANCE' : 'SUPPORT', entryPrice, tickSize);

    let tpPrice = levelData.price;
    const { minRR, maxRR, minLvlStrength } = this.settings; // Деструктуризація для чистоти

    const requiredReward = effectiveRiskForTP * minRR;
    const maxAllowedReward = effectiveRiskForTP * maxRR;

    // Перевірка напрямку та мінімального порогу RR
    let naturalReward = Math.abs(tpPrice - entryPrice);

    if (naturalReward < requiredReward || (type === 'LONG' ? tpPrice <= entryPrice : tpPrice >= entryPrice)) {
      // Якщо рівень занадто близько або він слабкий
      if (levelData.strength < minLvlStrength) {
        tpPrice = type === 'LONG' ? entryPrice + requiredReward : entryPrice - requiredReward;
      } else {
        // Сильний рівень стоїть на заваді профіту - скасовуємо сигнал
        return null;
      }
    }

    // ✅ ТВОЄ ЗРІЗАННЯ: Обмеження максимальної жадібності
    if (Math.abs(tpPrice - entryPrice) > maxAllowedReward) {
      tpPrice = type === 'LONG' ? entryPrice + maxAllowedReward : entryPrice - maxAllowedReward;
    }

    const precision = Math.max(0, -Math.floor(Math.log10(tickSize)));
    let tp: number;

    if (type === 'LONG') {
      tp = parseFloat((Math.ceil(tpPrice / tickSize) * tickSize).toFixed(precision));
    } else {
      tp = parseFloat((Math.floor(tpPrice / tickSize) * tickSize).toFixed(precision));
    }

    const finalReward = Math.abs(tp - entryPrice);
    const finalRR = finalReward / actualRisk;

    let verifiedTp = tp;
    if (finalRR < minRR) {
      verifiedTp = type === 'LONG'
        ? parseFloat((tp + tickSize).toFixed(precision))
        : parseFloat((tp - tickSize).toFixed(precision));
    }

    return {
      symbol,
      type,
      pattern,
      timeframe: tf,
      currentPrice: kline.close,
      stopLoss: sl,
      takeProfit: verifiedTp,
      lvlStrength: levelData.strength,
      swingStrength: maDeviation,
      volumeMultiplier: vol,
      liqAmount: 0,
      timestamp: Date.now(),
      quoteAsset: this.symbolQuotes.get(symbol) || 'USDT',
      profitPercent: (Math.abs(verifiedTp - entryPrice) / entryPrice) * 100,
      rr: Math.abs(verifiedTp - entryPrice) / actualRisk
    };
  }

  // --- МАТЕМАТИЧНІ УТИЛІТИ ---

  private findTrueLevel(history: any[], type: 'SUPPORT' | 'RESISTANCE', currentPrice: number, tickSize: number) {
    if (history.length === 0) return { price: currentPrice, strength: 0, zoneMin: currentPrice, zoneMax: currentPrice };

    const minP = Math.min(...history.map(k => k.low));
    const maxP = Math.max(...history.map(k => k.high));
    if (maxP === minP) return { price: currentPrice, strength: 0, zoneMin: currentPrice, zoneMax: currentPrice };

    const binSize = Math.max((maxP - minP) / 100, tickSize * 2);
    const actualBinCount = Math.ceil((maxP - minP) / binSize) + 1;
    const bins = new Array(actualBinCount).fill(0);

    let totalVolume = 0;
    history.forEach(k => {
      const s = Math.floor((k.low - minP) / binSize);
      const e = Math.floor((k.high - minP) / binSize);
      const span = (e - s) + 1;
      const volPerBin = k.volume / span;
      for (let i = s; i <= e; i++) {
        if (i >= 0 && i < actualBinCount) {
          bins[i] += volPerBin;
          totalVolume += volPerBin;
        }
      }
    });

    const avgVolumePerBin = totalVolume / actualBinCount;
    const smoothedBins = [...bins];
    for (let i = 1; i < actualBinCount - 1; i++) {
      smoothedBins[i] = (bins[i - 1] + bins[i] * 2 + bins[i + 1]) / 4;
    }

    let bestPeakIndex = -1;
    let maxWeight = 0;

    for (let i = 1; i < actualBinCount - 1; i++) {
      const priceAtBin = minP + (i * binSize);
      if (type === 'RESISTANCE' && priceAtBin <= currentPrice) continue;
      if (type === 'SUPPORT' && priceAtBin >= currentPrice) continue;
      if (smoothedBins[i] > smoothedBins[i - 1] && smoothedBins[i] > smoothedBins[i + 1]) {
        if (smoothedBins[i] > maxWeight) {
          maxWeight = smoothedBins[i];
          bestPeakIndex = i;
        }
      }
    }

    if (bestPeakIndex === -1) return { price: type === 'RESISTANCE' ? maxP : minP, strength: 0, zoneMin: 0, zoneMax: 0 };

    let leftBound = bestPeakIndex;
    while (leftBound > 0 && smoothedBins[leftBound - 1] > maxWeight * 0.5) leftBound--;
    let rightBound = bestPeakIndex;
    while (rightBound < actualBinCount - 1 && smoothedBins[rightBound + 1] > maxWeight * 0.5) rightBound++;

    const zoneMin = minP + (leftBound * binSize);
    const zoneMax = minP + (rightBound * binSize) + binSize;
    const strength = maxWeight / (avgVolumePerBin || 1);

    return {
      price: type === 'RESISTANCE' ? zoneMin : zoneMax,
      strength, zoneMin, zoneMax
    };
  }

  private checkAODivergence(history: any[], type: 'LONG' | 'SHORT', currentAO: number): boolean {
    const len = history.length;
    if (len < 50) return false;
    
    // Використовуємо кешовані значення AO з історії
    const getAO = (i: number) => (i === len) ? currentAO : (history[i].ao || 0);
    const curr = currentAO, prev = getAO(len - 1);

    if (type === 'LONG') {
      if (curr <= prev || curr >= 0) return false;
      let recM = Infinity, recAO = Infinity, i = len;
      for (; i >= len - 20; i--) {
        const low = i === len ? history[len-1].low : history[i].low;
        const ao = getAO(i);
        if (low < recM) recM = low;
        if (ao < recAO) recAO = ao;
        if (ao > 0) break;
      }
      let pastM = Infinity, pastAO = Infinity;
      for (; i >= len - 50; i--) {
        if (history[i].low < pastM) pastM = history[i].low;
        if (getAO(i) < pastAO) pastAO = getAO(i);
      }
      return (recM < pastM) && (recAO > pastAO);
    } else {
      if (curr >= prev || curr <= 0) return false;
      let recM = -Infinity, recAO = -Infinity, i = len;
      for (; i >= len - 20; i--) {
        const high = i === len ? history[len-1].high : history[i].high;
        const ao = getAO(i);
        if (high > recM) recM = high;
        if (ao > recAO) recAO = ao;
        if (ao < 0) break;
      }
      let pastM = -Infinity, pastAO = -Infinity;
      for (; i >= len - 50; i--) {
        if (history[i].high > pastM) pastM = history[i].high;
        if (getAO(i) > pastAO) pastAO = getAO(i);
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

  private getTfMs(tf: string): number {
    const unit = tf.slice(-1);
    const value = parseInt(tf);
    switch (unit) {
      case 'm': return value * 60 * 1000;
      case 'h': return value * 60 * 60 * 1000;
      case 'd': return value * 24 * 60 * 60 * 1000;
      default: return 60 * 1000;
    }
  }

  private calculateVolMult(kline: any, tf: string, avgVol: number): number {
    if (!kline.openTime || avgVol === 0) return kline.volume / (avgVol || 1);

    const now = Date.now();
    const elapsed = now - kline.openTime;
    const total = this.getTfMs(tf);

    // Динамічний поріг: 50% від тривалості таймфрейму
    const projectionThreshold = total / 2;

    // Якщо свічка закрита або ми ще не пройшли "екватор" свічки — беремо факт
    if (kline.isClosed || elapsed < projectionThreshold) {
      return kline.volume / avgVol;
    }

    // Розраховуємо прогрес (Ratio) від 0.5 до 1.0
    const ratio = Math.min(0.99, elapsed / total);

    // Проектуємо фінальний об'єм на основі темпу
    const projectedVol = kline.volume / ratio;

    return projectedVol / avgVol;
  }

  // --- УПРАВЛІННЯ UI ТА ІСТОРІЄЮ ---

  private addSignalToHistory(kline: any, sig: TradeSignal, tf: string) {
    const tick = this.symbolTickSizes.get(kline.symbol.toUpperCase()) || 0.0001;
    const entryPrice = sig.type === 'LONG'
      ? this.roundToTick(kline.high + tick, tick)
      : this.roundToTick(kline.low - tick, tick);

    this.lastSignalsHistory.unshift({
      id: Date.now() + Math.random(),
      time: kline.openTime ? new Date(kline.openTime).toLocaleTimeString() : new Date().toLocaleTimeString(),
      symbol: kline.symbol,
      timeframe: tf,
      type: sig.type,
      pattern: sig.pattern,
      price: entryPrice,
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

  private createPatternContext(kline: any, history: any[]): PatternContext {
    // Використовуємо swingPeriod для визначення локальності піка/дна
    const lookback = this.settings.swingPeriod || 10;
    const lastN = history.slice(-lookback);

    return {
      kline,
      lastCandle: history[history.length - 1],
      history: history,
      avgBody: history.slice(-10).reduce((acc, k) => acc + Math.abs(k.close - k.open), 0) / 10,
      // Якщо поточний лоу нижчий за всі лоу в періоді swingPeriod
      isLocalBottom: kline.low! <= Math.min(...lastN.map(k => k.low)),
      // Якщо поточний хай вищий за всі хаї в періоді swingPeriod
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
    const newCandle = { 
      close: kline.close, 
      high: kline.high, 
      low: kline.low, 
      open: kline.open, 
      volume: kline.volume,
      ao: 0
    };
    h.push(newCandle);
    if (h.length > 600) h.shift();
    
    // Кешуємо AO тільки для нової закритої свічки
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
