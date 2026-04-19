import { MarketType, PositionStatus, SignalSide, BinanceEventType } from '../core/constants/trade-enums';

export interface KlineData {
  type: BinanceEventType;
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

export interface TPGridLevel {
  level?: number;      // e.g., 0.5, 0.618
  price?: number;
  closePct?: number;   // e.g., 20
  movePercent: number; // For backward compatibility with previous steps
  volumePercent: number; // For backward compatibility with previous steps
  isHit?: boolean;
  triggerBE: boolean;
}

export interface TradeSignal {
  symbol: string;
  type: SignalSide;
  pattern: string;
  entryPrice: number;
  currentPrice: number;
  stopLoss: number;
  takeProfit: number;
  profitPercent: number;
  volumeMultiplier: number;
  liqAmount: number;
  timestamp: number;
  rr: number;
  isStale?: boolean;
  expiryTime?: number;
  quoteAsset: string;
  swingStrength: number;
  timeframe: string;
  lvlStrength: number;
  hasDivergence: boolean;
  volumeUsd?: number;
  tpGrid?: TPGridLevel[];
  tpZoneMin?: number;
  tpZoneMax?: number;
}

export interface HistoricalLog {
  id: number;
  time: string;
  symbol: string;
  quoteAsset: string;
  type: SignalSide | string;
  pattern: string;
  price: number;
  sl: number;
  tp: number;
  rr: number;

  status?: PositionStatus;
  isOpened?: boolean;
  pnl?: number;
  initialSl?: number;
  initialSlPercent?: number;

  volMult: number;
  swingStrength: number;
  timeframe: string;
  lvlStrength: number;
  hasDivergence?: boolean;

  beTriggered?: boolean;
  beTriggerPrice?: number;
  useBE?: boolean; // Legacy fallback
  beLevelPct?: number; // Legacy fallback
  useFibGrid?: boolean; // New field for grid activation
  exitGrid?: TPGridLevel[]; // Fibonacci Exit Grid
  tpGrid?: TPGridLevel[];
  useTPGrid?: boolean;
  marketType?: MarketType;
  volumeUsd?: number;
  tpZoneMin?: number;
  tpZoneMax?: number;
}

export interface ScannerSettings {
  marketType: MarketType;
  timeframes: string[];

  swingPeriod: number;
  trailingBars: number;

  minVolMult: number;
  maxVolMult: number;
  minSwing: number;
  maxSwing: number;
  minLvlStrength: number;
  minRR: number;
  maxRR: number;
  maxStopPercent: number;

  minProfitThreshold: number;

  soundEnabled: boolean;
  holdStale: boolean;
  showLong: boolean;
  showShort: boolean;
  useDivergence: boolean;

  useTPGrid: boolean;
  useFiboGrid: boolean;
  tpGrid: TPGridLevel[];
  tpGridSettings?: TPGridLevel[];
  fractalWindow: number;
}

export interface PatternContext {
  kline: any;
  lastCandle: any;
  history: any[];
  avgBody: number;
  atr: number;
  isLocalBottom: boolean;
  isLocalPeak: boolean;
  isMotherBarBottom?: boolean;
  isMotherBarPeak?: boolean;
  hasDivergence: boolean;
}
