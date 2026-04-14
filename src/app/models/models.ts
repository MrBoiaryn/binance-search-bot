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
  openTime?: number;
  side?: string;
  amount?: number;
}

export interface TradeSignal {
  symbol: string;
  type: 'LONG' | 'SHORT';
  pattern: string;
  entryPrice: number;    // ✅ Додано: чітка ціна входу (пробій)
  currentPrice: number;
  stopLoss: number;
  takeProfit: number;
  profitPercent: number;
  volumeMultiplier: number;
  liqAmount: number;
  timestamp: number;
  rr: number;
  isStale?: boolean;
  quoteAsset: string;
  swingStrength: number;
  timeframe: string;
  lvlStrength: number;
  hasDivergence: boolean; // ✅ Додано: для відображення 💎
}

export interface HistoricalLog {
  id: number;
  time: string;
  symbol: string;
  quoteAsset: string;
  type: string;
  pattern: string;
  price: number;         // Це entryPrice
  sl: number;
  tp: number;
  rr: number;
  liq: number;

  // --- Супровід позиції ---
  status?: 'PENDING' | 'OPENED' | 'CANCELLED' | 'SL' | 'TP';
  isOpened?: boolean;
  pnl?: number;
  initialSl?: number;    // Для візуалізації трейлінгу

  // --- Метрики ---
  volMult: number;
  swingStrength: number;
  timeframe: string;
  lvlStrength: number;
  hasDivergence?: boolean; // ✅ Додано: збереження 💎 в історії
}

export interface ScannerSettings {
  marketType: 'spot' | 'futures';
  timeframes: string[];

  // --- Параметри періоду ---
  swingPeriod: number;
  trailingBars: number;

  // --- Фільтри діапазонів ---
  minVolMult: number;
  maxVolMult: number;
  minSwing: number;
  maxSwing: number;
  minLvlStrength: number;
  minRR: number;
  maxRR: number;

  // --- Захист та Профіт ---
  maxClusterSize: number;
  minProfitThreshold: number;

  // --- UI та Опції ---
  soundEnabled: boolean;
  holdStale: boolean;
  showLong: boolean;
  showShort: boolean;
  useDivergence: boolean;
}

export interface PatternContext {
  kline: any;
  lastCandle: any;
  history: any[];
  avgBody: number;
  atr: number;             // ✅ Додано: Average True Range для стопів
  isLocalBottom: boolean;
  isLocalPeak: boolean;
  isMotherBarBottom?: boolean; // ✅ Додано: Для патерну Inside Bar
  isMotherBarPeak?: boolean;   // ✅ Додано: Для патерну Inside Bar
  hasDivergence: boolean;  // ✅ Додано: Стан дивергенції AO
}