// src/app/models/models.ts

export interface KlineData {
  type: 'kline' | 'liquidation';
  symbol: string;
  isClosed?: boolean;
  open?: number;
  high?: number;
  low?: number;
  close?: number;
  volume?: number;
  openTime?: number; // Змінено з startTime на openTime для відповідності логіці
  side?: string;
  amount?: number;
}

export interface TradeSignal {
  symbol: string;
  type: 'LONG' | 'SHORT';
  pattern: string;
  currentPrice: number;
  stopLoss: number;
  takeProfit: number;
  profitPercent: number;
  volumeMultiplier: number;
  liqAmount: number;
  timestamp: number;
  rr: number;
  isStale?: boolean; // Для "режиму привидів"
  quoteAsset: string; // ДОДАТИ
  swingStrength: number; // Додано
  timeframe: string;    // ✅ Додано
  lvlStrength: number;  // ✅ Додано
}

export interface HistoricalLog {
  id: number;
  time: string;
  symbol: string;
  quoteAsset: string;
  type: string;
  pattern: string;
  price: number;
  sl: number;
  tp: number;
  rr: number;
  liq: number;
  // ✅ НОВІ ПОЛЯ ДЛЯ ВІДСТЕЖЕННЯ ПОЗИЦІЙ
  status?: 'PENDING' | 'OPENED' | 'CANCELLED' | 'SL' | 'TP';
  isOpened?: boolean;
  pnl?: number;
  volMult: number;       // Додано
  swingStrength: number; // Додано
  timeframe: string;    // ✅ Додано
  lvlStrength: number;  // ✅ Додано
  initialSl?: number; // ✅ ДОДАЙ ЦЕЙ РЯДОК (опціональне поле)
}

// НОВИЙ ІНТЕРФЕЙС НАЛАШТУВАНЬ

export interface ScannerSettings {
  marketType: 'spot' | 'futures';
  timeframes: string[];

  // --- ПАРАМЕТРИ ПЕРІОДУ ---
  swingPeriod: number;      // Swing (Бари) - глибина пошуку рівня
  trailingBars: number;     // Trailing (Бари)

  // --- ДІАПАЗОНИ (MIN / MAX) ---
  minVolMult: number;       // Об'єм Min
  maxVolMult: number;       // Об'єм Max

  minSwing: number;         // Swing % Min (відхилення від середньої)
  maxSwing: number;         // Swing % Max (захист від перегріву)

  minLvlStrength: number;   // Сила рівня L (тільки мінімум)

  minRR: number;            // RR Min
  maxRR: number;            // RR Max

  maxClusterSize: number;   // Щільність (макс. однакових сигналів за хв)

  minProfitThreshold: number;

  // --- ВІЗУАЛ ТА ІНШЕ ---
  soundEnabled: boolean;
  holdStale: boolean;
  showLong: boolean;
  showShort: boolean;
  useDivergence: boolean;
}

export interface PatternContext {
  kline: any;          // Поточна свічка (live)
  lastCandle: any;     // Попередня закрита свічка
  history: any[];      // Історія свічок
  avgBody: number;     // Середнє тіло за останні N свічок
  isLocalBottom: boolean; // ✅ Додай це
  isLocalPeak: boolean;   // ✅ І це
}