import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { BinanceSocketService } from './services/binance';
import { forkJoin, map, catchError, of } from 'rxjs';
import { TradeStorageService } from './services/trade-storage.service';
import { FormsModule } from '@angular/forms';
import { HistoricalLog, OpenPosition, TradeSignal } from './models/models';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './app.html',
  styleUrls: ['./app.scss']
})
export class App implements OnInit {
  activeSignals: Map<string, TradeSignal> = new Map();
  signalsList: TradeSignal[] = [];
  processedTicks = 0;
  lastSignalsHistory: HistoricalLog[] = [];
  openPositions: OpenPosition[] = []; // Твої реальні заходи в ринок

  // Історія та середні показники
  klineHistory: Map<string, any[]> = new Map();
  volumeAverages: Map<string, number> = new Map();
  liquidationsCurrentMin: Map<string, number> = new Map();

  // ПАРАМЕТРИ СКАНЕРА
  SWING_PERIOD = 10;           // Період для визначення локальних піків/днів
  VOLUME_THRESHOLD = 2;        // Поріг аномального об'єму (х5)
  MIN_LIQUIDATION = 0;      // Поріг ліквідацій ($) для підтвердження

  marketType: 'spot' | 'futures' = 'futures';
  timeframe = '1m';

  private socketSub: any;

  constructor(
    private socketService: BinanceSocketService,
    private cdr: ChangeDetectorRef,
    private storage: TradeStorageService, // Додаємо сервіс
  ) {}

  ngOnInit() {
    console.log("🚀 [SYSTEM] Sniper Scanner Started (1m Futures)...");
    this.lastSignalsHistory = this.storage.loadHistory();
    this.openPositions = this.storage.loadOpenPositions();
    this.startScanner();
    this.initHeartbeat();
  }

  restartScanner() {
    console.log("♻️ Перезапуск сканера...");
    if (this.socketSub) this.socketSub.unsubscribe();

    // Очищуємо старі дані
    this.activeSignals.clear();
    this.signalsList = [];
    this.klineHistory.clear();
    this.volumeAverages.clear();
    this.liquidationsCurrentMin.clear();

    this.startScanner();
  }

  openTrade(sig: TradeSignal) {
    const newPos: OpenPosition = {
      symbol: sig.symbol,
      type: sig.type,
      entryPrice: sig.currentPrice,
      // Початковий стоп: крайня точка свічки +/- 1 пункт
      currentSL: sig.type === 'LONG' ? sig.stopLoss : sig.stopLoss,
      takeProfit: sig.takeProfit,
      pattern: sig.pattern,
      openedAt: Date.now()
    };

    this.openPositions.push(newPos);
    this.storage.saveOpenPositions(this.openPositions);
    console.log(`🚀 Позицію по ${sig.symbol} відкрито!`);
  }

  startScanner() {
    this.socketService.getTopPairs(this.marketType).subscribe(pairs => {
      const historyRequests = pairs.map(p =>
        this.socketService.getKlinesHistory(p, this.timeframe, this.marketType).pipe(
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

        this.socketSub = this.socketService.connectKlines(pairs, this.timeframe, this.marketType).subscribe(data => {
          this.analyzeData(data);
        });
      });
    });
  }

  private analyzeData(data: any) {
    // 1. Обробка Ліквідацій (накопичуємо суму)
    if (data.type === 'liquidation') {
      const current = this.liquidationsCurrentMin.get(data.symbol) || 0;
      this.liquidationsCurrentMin.set(data.symbol, current + (data.amount || 0));
      return;
    }

    // 2. Обробка Свічок
    const kline = data;
    this.processedTicks++;

    if (kline.isClosed) {
      // Якщо свічка закрилася з активним сигналом - в лог
      this.updateTrailingStops(kline);
      const signal = this.activeSignals.get(kline.symbol);
      if (signal) this.addToHistory(kline.symbol, signal.type, kline.close!, signal.liqAmount, signal.pattern);

      this.activeSignals.delete(kline.symbol);
      this.liquidationsCurrentMin.delete(kline.symbol);

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

      // Адаптивне середнє (швидке для 1хв)
      const currentAvg = this.volumeAverages.get(kline.symbol) || kline.volume!;
      this.volumeAverages.set(kline.symbol, (currentAvg * 2 + kline.volume!) / 3);

      this.updateUI();
      return;
    }

    // --- АЛГОРИТМ АНАЛІЗУ В РЕАЛЬНОМУ ЧАСІ ---
    const history = this.klineHistory.get(kline.symbol) || [];
    if (history.length < this.SWING_PERIOD) return;

    // Параметри свічки
    const lastCandle = history[history.length - 1]; // Попередня закрита
    const body = Math.abs(kline.close! - kline.open!);
    const prevBody = Math.abs(lastCandle.close - lastCandle.open);
    const lowerShadow = Math.min(kline.open!, kline.close!) - kline.low!;
    const upperShadow = kline.high! - Math.max(kline.open!, kline.close!);

    // Середнє тіло (для детекції аномально великих свічок)
    const avgBody = history.slice(-10).reduce((acc, k) => acc + Math.abs(k.close - k.open), 0) / 10;

    // Об'єм та ліквідації
    const elapsed = (Date.now() - kline.startTime!) / 60000;
    const projectedVol = elapsed > 0.1 ? kline.volume! * (1 / elapsed) : kline.volume!;
    const avgVol = this.volumeAverages.get(kline.symbol) || kline.volume!;
    const volMult = projectedVol / avgVol;
    const liqAmount = this.liquidationsCurrentMin.get(kline.symbol) || 0;

    // Фільтр екстремумів
    const last10 = history.slice(-this.SWING_PERIOD);
    const isLocalBottom = kline.low! <= Math.min(...last10.map(k => k.low));
    const isLocalPeak = kline.high! >= Math.max(...last10.map(k => k.high));

    // Критерій аномальності (х5 об'єм АБО х3 + ліквідації)
    const isSpike = volMult > this.VOLUME_THRESHOLD || (volMult > 3 && liqAmount > this.MIN_LIQUIDATION);

    let signal: TradeSignal | null = null;

    // --- ПЕРЕВІРКА ПАТЕРНІВ (LONG) ---
    if (isLocalBottom && isSpike) {
      // 1. Hammer (Пін-бар)
      if (lowerShadow > body * 2 && upperShadow < body * 0.5) {
        signal = this.createSignal(kline, 'LONG', 'Hammer', volMult, liqAmount, history);
      }
      // 2. Bullish Engulfing (Поглинання)
      else if (kline.close! > kline.open! && lastCandle.close < lastCandle.open && body > prevBody * 1.2) {
        signal = this.createSignal(kline, 'LONG', 'Engulfing', volMult, liqAmount, history);
      }
      // 3. Momentum Bar (Сильний імпульс)
      else if (kline.close! > kline.open! && body > avgBody * 2.5) {
        signal = this.createSignal(kline, 'LONG', 'Momentum', volMult, liqAmount, history);
      }
    }

    // --- ПЕРЕВІРКА ПАТЕРНІВ (SHORT) ---
    else if (isLocalPeak && isSpike) {
      // 1. Shooting Star (Шип)
      if (upperShadow > body * 2 && lowerShadow < body * 0.5) {
        signal = this.createSignal(kline, 'SHORT', 'Star', volMult, liqAmount, history);
      }
      // 2. Bearish Engulfing
      else if (kline.close! < kline.open! && lastCandle.close > lastCandle.open && body > prevBody * 1.2) {
        signal = this.createSignal(kline, 'SHORT', 'Engulfing', volMult, liqAmount, history);
      }
      // 3. Momentum Bar
      else if (kline.close! < kline.open! && body > avgBody * 2.5) {
        signal = this.createSignal(kline, 'SHORT', 'Momentum', volMult, liqAmount, history);
      }
    }

    // Оновлення стану
    if (signal) {
      this.activeSignals.set(kline.symbol, signal);
    } else {
      this.activeSignals.delete(kline.symbol);
    }

    this.updateUI();
  }

  private createSignal(kline: any, type: 'LONG' | 'SHORT', pattern: string, vol: number, liq: number, history: any[]): TradeSignal {
    const sl = type === 'LONG' ? kline.low * 0.999 : kline.high * 1.001;
    const tp = type === 'LONG'
      ? Math.max(...history.slice(-20).map(k => k.high))
      : Math.min(...history.slice(-20).map(k => k.low));

    const risk = Math.abs(kline.close - sl);
    const profit = Math.abs(tp - kline.close);

    return {
      symbol: kline.symbol,
      type,
      pattern,
      currentPrice: kline.close,
      stopLoss: sl,
      takeProfit: tp,
      profitPercent: (profit / kline.close) * 100,
      volumeMultiplier: vol,
      liqAmount: liq,
      timestamp: Date.now(),
      rr: profit / (risk || 0.000001)
    };
  }

  getBinanceLink(symbol: string): string {
    return `https://www.binance.com/uk-UA/futures/${symbol.toUpperCase()}`;
  }

  private updateUI() {
    // Сортуємо: спочатку ті, де найбільші ліквідації
    this.signalsList = Array.from(this.activeSignals.values())
      .sort((a, b) => b.liqAmount - a.liqAmount);
    this.cdr.detectChanges();
  }

  private initHeartbeat() {
    setInterval(() => {
      console.log(`💓 [${new Date().toLocaleTimeString()}] Ticks: ${this.processedTicks} | Active: ${this.activeSignals.size}`);
      this.processedTicks = 0;
    }, 60000);
  }

  private addToHistory(symbol: string, type: string, price: number, liq: number, pattern: string) {
    this.lastSignalsHistory.unshift({
      time: new Date().toLocaleTimeString(),
      symbol,
      type,
      pattern, // Зберігаємо назву патерна
      price,
      liq
    });
    if (this.lastSignalsHistory.length > 20) this.lastSignalsHistory.pop();
  }

  private updateTrailingStops(kline: any) {
    let changed = false;

    this.openPositions = this.openPositions.map(pos => {
      if (pos.symbol !== kline.symbol) return pos;

      const history = this.klineHistory.get(pos.symbol) || [];
      if (history.length < 5) return pos;

      const last5 = history.slice(-5);

      if (pos.type === 'LONG') {
        // Трейлінг для Лонга: найнижча точка за останні 5 свічок
        const lowest5 = Math.min(...last5.map(k => k.low));
        if (lowest5 > pos.currentSL) {
          pos.currentSL = lowest5;
          changed = true;
          console.log(`📈 SL для ${pos.symbol} піднято до ${lowest5}`);
        }
        // Перевірка на закриття по стопу
        if (kline.low <= pos.currentSL) {
          this.closePosition(pos, 'STOP-LOSS', kline.close);
          return null;
        }
      } else {
        // Трейлінг для Шорта: найвища точка за 5 свічок
        const highest5 = Math.max(...last5.map(k => k.high));
        if (highest5 < pos.currentSL) {
          pos.currentSL = highest5;
          changed = true;
          console.log(`📉 SL для ${pos.symbol} опущено до ${highest5}`);
        }
        if (kline.high >= pos.currentSL) {
          this.closePosition(pos, 'STOP-LOSS', kline.close);
          return null;
        }
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
}