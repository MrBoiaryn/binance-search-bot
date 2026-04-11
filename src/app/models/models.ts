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
  id: number;      // ДОДАНО: унікальний ID (Date.now())
  time: string;
  symbol: string;
  type: string;
  pattern: string;
  price: number;
  liq: number;
  quoteAsset: string; // ДОДАТИ
}

// НОВИЙ ІНТЕРФЕЙС НАЛАШТУВАНЬ
export interface ScannerSettings {
  marketType: 'spot' | 'futures';
  timeframe: string;
  volumeThreshold: number;
  swingPeriod: number;
  minLiquidation: number;
  minRR: number;         // Мінімальний Risk/Reward
  soundEnabled: boolean; // Звукові сповіщення
  holdStale: boolean;    // Чи показувати "привидів" 15 сек
}

export interface PatternContext {
  kline: any;          // Поточна свічка (live)
  lastCandle: any;     // Попередня закрита свічка
  history: any[];      // Історія свічок
  avgBody: number;     // Середнє тіло за останні N свічок
}