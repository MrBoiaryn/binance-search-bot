import { PatternContext, TradeSignal } from '../models/models';

// Інтерфейс даних, які отримує кожен детектор


// Тип для функції-детектора
export type DetectorFn = (ctx: PatternContext) => string | null;

/**
 * --- LONG PATTERNS ---
 */
export const hammerDetector: DetectorFn = ({ kline }) => {
  const body = Math.abs(kline.close - kline.open);
  const lowerShadow = Math.min(kline.open, kline.close) - kline.low;
  const upperShadow = kline.high - Math.max(kline.open, kline.close);

  return (lowerShadow > body * 2 && upperShadow < body * 0.5) ? 'Hammer' : null;
};

export const bullishEngulfingDetector: DetectorFn = ({ kline, lastCandle }) => {
  const body = Math.abs(kline.close - kline.open);
  const prevBody = Math.abs(lastCandle.close - lastCandle.open);

  const isBullish = kline.close > kline.open;
  const wasBearish = lastCandle.close < lastCandle.open;

  return (isBullish && wasBearish && body > prevBody * 1.2) ? 'Engulfing' : null;
};

export const bullishMomentumDetector: DetectorFn = ({ kline, avgBody }) => {
  const body = Math.abs(kline.close - kline.open);
  return (kline.close > kline.open && body > avgBody * 2.5) ? 'Momentum' : null;
};

/**
 * --- SHORT PATTERNS ---
 */
export const shootingStarDetector: DetectorFn = ({ kline }) => {
  const body = Math.abs(kline.close - kline.open);
  const lowerShadow = Math.min(kline.open, kline.close) - kline.low;
  const upperShadow = kline.high - Math.max(kline.open, kline.close);

  return (upperShadow > body * 2 && lowerShadow < body * 0.5) ? 'Star' : null;
};

export const bearishEngulfingDetector: DetectorFn = ({ kline, lastCandle }) => {
  const body = Math.abs(kline.close - kline.open);
  const prevBody = Math.abs(lastCandle.close - lastCandle.open);

  const isBearish = kline.close < kline.open;
  const wasBullish = lastCandle.close > lastCandle.open;

  return (isBearish && wasBullish && body > prevBody * 1.2) ? 'Engulfing' : null;
};

export const bearishMomentumDetector: DetectorFn = ({ kline, avgBody }) => {
  const body = Math.abs(kline.close - kline.open);
  return (kline.close < kline.open && body > avgBody * 2.5) ? 'Momentum' : null;
};

/**
 * Реєстр патернів для зручного перебору
 */
export const LONG_DETECTORS = [
  hammerDetector,
  bullishEngulfingDetector,
  bullishMomentumDetector
];

export const SHORT_DETECTORS = [
  shootingStarDetector,
  bearishEngulfingDetector,
  bearishMomentumDetector
];