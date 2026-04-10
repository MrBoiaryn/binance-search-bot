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
  side?: string; // для ліквідацій
  amount?: number; // для ліквідацій
}

export interface TradeSignal {
  symbol: string;
  type: 'LONG' | 'SHORT';
  pattern: string;      // Назва патерна: "Hammer", "Engulfing", "Momentum"
  currentPrice: number;
  stopLoss: number;
  takeProfit: number;
  profitPercent: number;
  volumeMultiplier: number;
  liqAmount: number;    // Сума ліквідацій за хвилину
  timestamp: number;
  rr: number;           // Співвідношення Ризик/Прибуток
}

export interface HistoricalLog {
  time: string;
  symbol: string;
  type: string;
  pattern: string; // ДОДАНО
  price: number;
  liq: number;
}

export interface OpenPosition {
  symbol: string;
  type: 'LONG' | 'SHORT';
  entryPrice: number;
  currentSL: number;
  takeProfit: number;
  pattern: string;
  openedAt: number;
}