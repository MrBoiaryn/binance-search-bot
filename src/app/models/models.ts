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
  quoteAsset: string;
  swingStrength: number;
  timeframe: string;
  lvlStrength: number;
  hasDivergence: boolean;
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
  liq: number;

  status?: PositionStatus;
  isOpened?: boolean;
  pnl?: number;
  initialSl?: number;

  volMult: number;
  swingStrength: number;
  timeframe: string;
  lvlStrength: number;
  hasDivergence?: boolean;

  beTriggered?: boolean;
  beTriggerPrice?: number;
  useBE?: boolean;
  beLevelPct?: number;
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

  maxClusterSize: number;
  minProfitThreshold: number;

  soundEnabled: boolean;
  holdStale: boolean;
  showLong: boolean;
  showShort: boolean;
  useDivergence: boolean;

  useBE: boolean;
  beLevelPct: number;
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
