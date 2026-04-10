import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { BinanceSocketService } from './services/binance';
import { forkJoin, map, catchError, of } from 'rxjs';
import { TradeStorageService } from './services/trade-storage.service';
import { FormsModule } from '@angular/forms';
import { HistoricalLog, OpenPosition, PatternContext, ScannerSettings, TradeSignal } from './models/models';
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
    // 1. ОБРОБКА ЛІКВІДАЦІЙ (накопичуємо суму в реальному часі)
    if (data.type === 'liquidation') {
      const current = this.liquidationsCurrentMin.get(data.symbol) || 0;
      this.liquidationsCurrentMin.set(data.symbol, current + (data.amount || 0));
      return;
    }

    // 2. ПІДГОТОВКА ДАНИХ СВІЧКИ
    const kline = data;
    this.processedTicks++;

    // 3. ОБРОБКА ЗАКРИТОЇ СВІЧКИ (Фіксація результатів)
    if (kline.isClosed) {
      this.updateTrailingStops(kline);

      const signal = this.activeSignals.get(kline.symbol);
      // Якщо свічка закрилася і був активний сигнал (не привид) — додаємо в лог
      if (signal && !signal.isStale) {
        this.addToHistory(kline.symbol, signal.type, kline.close!, signal.liqAmount, signal.pattern);
      }

      // Очищуємо тимчасові дані для цієї пари
      this.activeSignals.delete(kline.symbol);
      this.liquidationsCurrentMin.delete(kline.symbol);
      this.cancelRemoval(kline.symbol);

      // Оновлюємо масив історії для технічного аналізу
      let history = this.klineHistory.get(kline.symbol) || [];
      history.push({
        close: kline.close,
        high: kline.high,
        low: kline.low,
        open: kline.open,
        volume: kline.volume
      });
      if (history.length > 250) history.shift();
      this.klineHistory.set(kline.symbol, history);

      // Оновлюємо середній об'єм (адаптивне середнє)
      const currentAvg = this.volumeAverages.get(kline.symbol) || kline.volume!;
      this.volumeAverages.set(kline.symbol, (currentAvg * 2 + kline.volume!) / 3);

      this.updateUI();
      return;
    }

    // 4. АНАЛІЗ LIVE-СВІЧКИ (Пошук точок входу)
    const history = this.klineHistory.get(kline.symbol) || [];
    if (history.length < this.settings.swingPeriod) return;

    // Розрахунок об'єму (проєкція до кінця хвилини)
    const elapsed = (Date.now() - kline.startTime!) / 60000;
    const projectedVol = elapsed > 0.1 ? kline.volume! * (1 / elapsed) : kline.volume!;
    const avgVol = this.volumeAverages.get(kline.symbol) || kline.volume!;
    const volMult = projectedVol / avgVol;
    const liqAmount = this.liquidationsCurrentMin.get(kline.symbol) || 0;

    // Фільтри екстремумів (Swing Low / High)
    const lastN = history.slice(-this.settings.swingPeriod);
    const isLocalBottom = kline.low! <= Math.min(...lastN.map(k => k.low));
    const isLocalPeak = kline.high! >= Math.max(...lastN.map(k => k.high));

    // Критерій аномальної активності ( Spike )
    const isSpike = volMult > this.settings.volumeThreshold ||
      (volMult > 3 && liqAmount > this.settings.minLiquidation);

    // Створюємо контекст для зовнішніх детекторів
    const ctx: PatternContext = {
      kline,
      lastCandle: history[history.length - 1],
      history: history,
      avgBody: history.slice(-10).reduce((acc, k) => acc + Math.abs(k.close - k.open), 0) / 10
    };

    let signal: TradeSignal | null = null;

    // ПЕРЕВІРКА ПАТЕРНІВ ЧЕРЕЗ РЕЄСТР
    if (isLocalBottom && isSpike) {
      for (const detect of Detectors.LONG_DETECTORS) {
        const patternName = detect(ctx);
        if (patternName) {
          signal = this.createSignal(kline, 'LONG', patternName, volMult, liqAmount, history);
          break;
        }
      }
    }
    else if (isLocalPeak && isSpike) {
      for (const detect of Detectors.SHORT_DETECTORS) {
        const patternName = detect(ctx);
        if (patternName) {
          signal = this.createSignal(kline, 'SHORT', patternName, volMult, liqAmount, history);
          break;
        }
      }
    }

    // 5. ФІЛЬТРАЦІЯ ТА ВІДОБРАЖЕННЯ

    // Фільтр Risk/Reward (PRO налаштування)
    if (signal && signal.rr < this.settings.minRR) {
      signal = null;
    }

    if (signal) {
      // Якщо сигнал з'явився вперше (або оновився з привида) — граємо звук
      const currentActive = this.activeSignals.get(kline.symbol);
      if (!currentActive || currentActive.isStale) {
        this.playAlertSound();
      }

      this.cancelRemoval(kline.symbol); // Зупиняємо видалення, якщо ціна повернулася в паттерн
      this.activeSignals.set(kline.symbol, signal);
    } else {
      // Якщо паттерн зламався — або видаляємо, або робимо "привидом"
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
      audio.volume = 1;
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
    this.lastSignalsHistory.unshift({
      id: Date.now() + Math.random(), // Гарантована унікальність навіть при миттєвих записах
      time: new Date().toLocaleTimeString(),
      symbol,
      type,
      pattern,
      price,
      liq
    });

    if (this.lastSignalsHistory.length > 20) this.lastSignalsHistory.pop();
    this.storage.saveHistory(this.lastSignalsHistory); // Не забувай зберігати
  }

  getBinanceLink(symbol: string): string { return `https://www.binance.com/uk-UA/futures/${symbol.toUpperCase()}`; }
  private updateUI() { this.signalsList = Array.from(this.activeSignals.values()).sort((a, b) => b.liqAmount - a.liqAmount); this.cdr.detectChanges(); }
  private initHeartbeat() { setInterval(() => { this.processedTicks = 0; }, 60000); }
}