import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { BinanceSocketService } from './services/binance';
import { forkJoin, map, catchError, of } from 'rxjs';
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
  activeSignals: Map<string, TradeSignal> = new Map(); // Поточні живі сигнали
  signalsList: TradeSignal[] = []; // Список для відображення в UI
  lastSignalsHistory: HistoricalLog[] = []; // Історія закритих сигналів

  klineHistory: Map<string, any[]> = new Map(); // Сховище свічок для аналізу
  volumeAverages: Map<string, number> = new Map(); // Середні об'єми по парах
  liquidationsCurrentMin: Map<string, number> = new Map(); // Накопичені ліквідації за поточну хвилину

  private removalTimeouts: Map<string, any> = new Map(); // Таймери для видалення "старих" сигналів
  private socketSub: any; // Підписка на WebSocket
  private symbolQuotes: Map<string, string> = new Map(); // Словник квот: BTCUSDT -> USDT

  // Налаштування сканера
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
    const savedSettings = this.storage.loadSettings();
    if (savedSettings) {
      // Об'єднуємо дефолтні налаштування зі збереженими, щоб не втратити нові поля (showLong/Short)
      this.settings = { ...this.settings, ...savedSettings };
    }
    this.lastSignalsHistory = this.storage.loadHistory();
    this.startScanner();
  }

  // Обробка зміни налаштувань з хедеру
  onSettingsUpdated(newSettings: ScannerSettings) {
    // Перевіряємо, чи потрібен повний перезапуск (зміна ринку або ТФ)
    const needsRestart =
      newSettings.marketType !== this.settings.marketType ||
      newSettings.timeframe !== this.settings.timeframe;

    this.settings = newSettings;
    this.storage.saveSettings(newSettings); // ✅ Зберігаємо в LocalStorage

    if (needsRestart) {
      console.log("🔄 Market or Timeframe changed. Restarting scanner...");
      if (this.socketSub) this.socketSub.unsubscribe();
      this.activeSignals.clear();
      this.signalsList = [];
      this.klineHistory.clear();
      this.volumeAverages.clear();
      this.liquidationsCurrentMin.clear();
      this.startScanner();
    } else {
      console.log("⚙️ Settings updated (Sound/Filters). No restart needed.");
      this.updateUI(); // Просто оновлюємо екран
    }
  }

  startScanner() {
    console.log(`📡 [SYSTEM] Initializing scanner for ${this.settings.marketType}...`);

    // 1. Отримуємо правила ринку, щоб правильно парсити пари
    this.socketService.getExchangeInfo(this.settings.marketType).subscribe({
      next: (info) => {
        info.symbols.forEach((s: any) => {
          this.symbolQuotes.set(s.symbol.toUpperCase(), s.quoteAsset.toUpperCase());
        });

        // 2. Беремо топ пар за об'ємом
        this.socketService.getTopPairs(this.settings.marketType).subscribe(pairs => {
          console.log(`✅ Loaded ${pairs.length} pairs. Fetching history...`);

          // 3. Завантажуємо історію свічок
          const historyRequests = pairs.map(p =>
            this.socketService.getKlinesHistory(p, this.settings.timeframe, this.settings.marketType).pipe(
              map(data => ({ symbol: p.toUpperCase(), data })),
              catchError(() => of(null))
            )
          );

          forkJoin(historyRequests).subscribe(results => {
            results.filter(r => r !== null).forEach((res: any) => {
              const formatted = res.data.map((k: any) => ({
                close: parseFloat(k[4]),
                high: parseFloat(k[2]),
                low: parseFloat(k[3]),
                open: parseFloat(k[1]),
                volume: parseFloat(k[5])
              }));

              this.klineHistory.set(res.symbol, formatted);
              const avg = formatted.reduce((acc: number, candle: any) => acc + candle.volume, 0) / formatted.length;
              this.volumeAverages.set(res.symbol, avg);
            });

            console.log("🚀 History loaded. Connecting to WebSocket...");

            // 4. Підключаємо Live-потік
            if (this.socketSub) this.socketSub.unsubscribe();
            this.socketSub = this.socketService.connectKlines(pairs, this.settings.timeframe, this.settings.marketType)
              .subscribe({
                next: (data) => this.analyzeData(data),
                error: (err) => console.error("🚨 WS Error:", err)
              });
          });
        });
      }
    });
  }

  private analyzeData(data: any) {
    // 1. ОБРОБКА ЛІКВІДАЦІЙ (Тільки для ф'ючерсів)
    if (data.type === 'liquidation') {
      const current = this.liquidationsCurrentMin.get(data.symbol) || 0;
      this.liquidationsCurrentMin.set(data.symbol, current + (data.amount || 0));
      return;
    }

    const kline = data;

    // 2. ОБРОБКА ЗАКРИТОЇ СВІЧКИ
    if (kline.isClosed) {
      const signal = this.activeSignals.get(kline.symbol);

      // Якщо на цій свічці був активний сигнал - переносимо його в історію
      if (signal && !signal.isStale) {
        this.addToHistory(kline.symbol, signal.type, kline.close!, signal.liqAmount, signal.pattern);
      }

      // Чистимо тимчасові дані по монеті
      this.activeSignals.delete(kline.symbol);
      this.liquidationsCurrentMin.delete(kline.symbol);
      this.cancelRemoval(kline.symbol);

      // Оновлюємо історію свічок (масив для аналізу патернів)
      let history = this.klineHistory.get(kline.symbol) || [];
      history.push({
        close: kline.close,
        high: kline.high,
        low: kline.low,
        open: kline.open,
        volume: kline.volume
      });

      if (history.length > 1000) history.shift(); // Тримаємо не більше 250 свічок
      this.klineHistory.set(kline.symbol, history);

      // Перераховуємо середній об'єм (згладжений)
      const currentAvg = this.volumeAverages.get(kline.symbol) || kline.volume!;
      const newAvg = (currentAvg * 19 + kline.volume!) / 20;

      this.volumeAverages.set(kline.symbol, newAvg);
      this.updateUI();
      return;
    }

    // 3. АНАЛІЗ В РЕАЛЬНОМУ ЧАСІ (Кожен тік всередині свічки)
    const history = this.klineHistory.get(kline.symbol) || [];
    if (history.length < this.settings.swingPeriod) return;

    // Розрахунок проектованого об'єму (скільки буде в кінці хвилини)
    const elapsed = (Date.now() - kline.startTime!) / 60000;
    const projectedVol = elapsed > 0.1 ? kline.volume! * (1 / elapsed) : kline.volume!;
    const avgVol = this.volumeAverages.get(kline.symbol) || kline.volume!;
    const volMult = projectedVol / avgVol;

    // Поточні ліквідації
    const liqAmount = this.liquidationsCurrentMin.get(kline.symbol) || 0;

    // Визначаємо локальні екстремуми (Swing Points)
    const lastN = history.slice(-this.settings.swingPeriod);
    const isLocalBottom = kline.low! <= Math.min(...lastN.map(k => k.low));
    const isLocalPeak = kline.high! >= Math.max(...lastN.map(k => k.high));

    // Умова аномального сплеску (або чистий об'єм, або об'єм + велика ліквідація)
    const isSpike = volMult > this.settings.volumeThreshold ||
      (volMult > 3 && liqAmount > this.settings.minLiquidation);

    // Контекст для детекторів
    const ctx: PatternContext = {
      kline,
      lastCandle: history[history.length - 1],
      history: history,
      avgBody: history.slice(-10).reduce((acc, k) => acc + Math.abs(k.close - k.open), 0) / 10
    };

    let signal: TradeSignal | null = null;

    // 4. ДЕТЕКТУВАННЯ ПАТЕРНІВ (З урахуванням фільтрів LONG/SHORT)
    if (isLocalBottom && isSpike && this.settings.showLong) {
      // Шукаємо LONG сигнали
      for (const detect of Detectors.LONG_DETECTORS) {
        const name = detect(ctx);
        if (name) {
          signal = this.createSignal(kline, 'LONG', name, volMult, liqAmount, history);
          break;
        }
      }
    } else if (isLocalPeak && isSpike && this.settings.showShort) {
      // Шукаємо SHORT сигнали
      for (const detect of Detectors.SHORT_DETECTORS) {
        const name = detect(ctx);
        if (name) {
          signal = this.createSignal(kline, 'SHORT', name, volMult, liqAmount, history);
          break;
        }
      }
    }

    // 5. КЕРУВАННЯ ЖИТТЄВИМ ЦИКЛОМ СИГНАЛУ
    if (signal && signal.rr >= this.settings.minRR) {
      const currentActive = this.activeSignals.get(kline.symbol);

      // Якщо це новий сигнал — граємо звук (якщо ввімкнено)
      if (!currentActive || currentActive.isStale) {
        this.playAlertSound();
      }

      this.cancelRemoval(kline.symbol);
      this.activeSignals.set(kline.symbol, signal);
    } else {
      // Якщо умови сигналу зникли — або видаляємо, або залишаємо як "привид" (holdStale)
      if (this.settings.holdStale) {
        this.scheduleRemoval(kline.symbol);
      } else {
        this.activeSignals.delete(kline.symbol);
      }
    }

    this.updateUI();
  }

  private playAlertSound() {
    if (!this.settings.soundEnabled) return;
    new Audio('https://actions.google.com/sounds/v1/alarms/beep_short.ogg').play().catch(() => {});
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
      symbol, type, pattern,
      currentPrice: kline.close,
      stopLoss: sl,
      takeProfit: tp,
      quoteAsset: this.symbolQuotes.get(symbol) || 'USDT',
      profitPercent: (Math.abs(tp - kline.close) / kline.close) * 100,
      volumeMultiplier: vol,
      liqAmount: liq,
      timestamp: Date.now(),
      rr: Math.abs(tp - kline.close) / (Math.abs(kline.close - sl) || 0.000001)
    };
  }

  private addToHistory(symbol: string, type: string, price: number, liq: number, pattern: string) {
    this.lastSignalsHistory.unshift({
      id: Date.now() + Math.random(),
      time: new Date().toLocaleTimeString(),
      symbol,
      quoteAsset: this.symbolQuotes.get(symbol) || 'USDT',
      type, pattern, price, liq
    });

    if (this.lastSignalsHistory.length > 20) this.lastSignalsHistory.pop();

    // ✅ Повертаємо збереження історії
    this.storage.saveHistory(this.lastSignalsHistory);
  }

  private updateUI() {
    // Фільтруємо список сигналів згідно з поточними налаштуваннями
    this.signalsList = Array.from(this.activeSignals.values())
      .filter(s => (s.type === 'LONG' && this.settings.showLong) || (s.type === 'SHORT' && this.settings.showShort))
      .sort((a, b) => b.liqAmount - a.liqAmount);

    this.cdr.detectChanges();
  }
}