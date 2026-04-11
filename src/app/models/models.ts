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
  startTime?: number;
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
}

export interface HistoricalLog {
  id: number;
  time: string;
  symbol: string;
  quoteAsset: string;
  type: string;
  pattern: string;
  price: number; // Це буде наша Точка Входу (Entry)
  sl: number;    // Додано
  tp: number;    // Додано
  liq: number;
  rr: number; // ✅ ДОДАЛИ ПОЛЕ R/R
}

// НОВИЙ ІНТЕРФЕЙС НАЛАШТУВАНЬ
export interface ScannerSettings {
  marketType: 'spot' | 'futures';
  timeframe: string;
  volumeThreshold: number;
  swingPeriod: number;
  minLiquidation: number;
  minRR: number;
  soundEnabled: boolean;
  holdStale: boolean;
  showLong: boolean;  // Додано
  showShort: boolean; // Додано
}
export interface PatternContext {
  kline: any;          // Поточна свічка (live)
  lastCandle: any;     // Попередня закрита свічка
  history: any[];      // Історія свічок
  avgBody: number;     // Середнє тіло за останні N свічок
}