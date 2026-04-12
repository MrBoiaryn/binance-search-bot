import { PatternContext } from '../models/models';

export type DetectorFn = (ctx: PatternContext) => string | null;

/**
 * --- HELPERS ---
 */
const getBody = (k: any) => Math.abs(k.close - k.open);
const getUpperShadow = (k: any) => k.high - Math.max(k.open, k.close);
const getLowerShadow = (k: any) => Math.min(k.open, k.close) - k.low;
// ✅ Додали розмір всієї свічки від краю до краю
const getCandleSize = (k: any) => k.high - k.low;
const isBullish = (k: any) => k.close > k.open;
const isBearish = (k: any) => k.close < k.open;

/**
 * --- LONG PATTERNS ---
 */

// 1. Молот (Hammer)
export const hammerDetector: DetectorFn = ({ kline }) => {
  const size = getCandleSize(kline);
  if (size === 0) return null;
  const lowerShadow = getLowerShadow(kline);
  const upperShadow = getUpperShadow(kline);
  // Нижня тінь > 50% свічки, верхня тінь < 20%
  return (lowerShadow >= size * 0.50 && upperShadow <= size * 0.20) ? 'Hammer' : null;
};

// 2. Пін-бар (Справжній!)
export const pinBarLONG: DetectorFn = ({ kline }) => {
  const size = getCandleSize(kline);
  if (size === 0) return null;
  const lowerShadow = getLowerShadow(kline);
  const upperShadow = getUpperShadow(kline);
  // Жорстко: Нижня тінь > 65% свічки, закриття під самий хай (верхня тінь < 15%)
  return (lowerShadow >= size * 0.65 && upperShadow <= size * 0.15) ? 'PinBar' : null;
};

// 3. Поглинання
export const bullishEngulfing: DetectorFn = ({ kline, lastCandle }) => {
  const body = getBody(kline);
  const prevBody = getBody(lastCandle);
  // Має перекрити тіло і закритися ВИЩЕ відкриття попередньої
  return (isBullish(kline) && isBearish(lastCandle) && body > prevBody && kline.close > lastCandle.open) ? 'Engulfing' : null;
};

// 4. Поглинання всього діапазону (Absorption)
export const absorptionLONG: DetectorFn = ({ kline, lastCandle }) => {
  const isStrong = kline.close > lastCandle.high && kline.open < lastCandle.low;
  return (isStrong && isBullish(kline)) ? 'Absorption' : null;
};

// 5. Рельси
export const railsLONG: DetectorFn = ({ kline, lastCandle, avgBody }) => {
  const body = getBody(kline);
  const prevBody = getBody(lastCandle);
  const areLarge = body > avgBody * 1.5 && prevBody > avgBody * 1.5;
  const areEqual = Math.abs(body - prevBody) < body * 0.2;
  return (isBullish(kline) && isBearish(lastCandle) && areLarge && areEqual) ? 'Rails' : null;
};

// 6. Моментум
export const bullishMomentum: DetectorFn = ({ kline, avgBody }) => {
  const body = getBody(kline);
  const size = getCandleSize(kline);
  if (size === 0) return null;
  // Свічка велика І тіло займає > 80% її розміру (немає великих тіней)
  return (isBullish(kline) && body > avgBody * 2.0 && body >= size * 0.8) ? 'Momentum' : null;
};

// 7. Внутрішній бар
export const insideBar: DetectorFn = ({ kline, lastCandle }) => {
  return (kline.high < lastCandle.high && kline.low > lastCandle.low) ? 'Inside' : null;
};


/**
 * --- SHORT PATTERNS ---
 */

// 1. Падаюча зоря
export const shootingStarDetector: DetectorFn = ({ kline }) => {
  const size = getCandleSize(kline);
  if (size === 0) return null;
  const lowerShadow = getLowerShadow(kline);
  const upperShadow = getUpperShadow(kline);
  return (upperShadow >= size * 0.50 && lowerShadow <= size * 0.20) ? 'Star' : null;
};

// 2. Пін-бар (Справжній!)
export const pinBarSHORT: DetectorFn = ({ kline }) => {
  const size = getCandleSize(kline);
  if (size === 0) return null;
  const lowerShadow = getLowerShadow(kline);
  const upperShadow = getUpperShadow(kline);
  return (upperShadow >= size * 0.65 && lowerShadow <= size * 0.15) ? 'PinBar' : null;
};

// 3. Ведмеже поглинання
export const bearishEngulfing: DetectorFn = ({ kline, lastCandle }) => {
  const body = getBody(kline);
  const prevBody = getBody(lastCandle);
  return (isBearish(kline) && isBullish(lastCandle) && body > prevBody && kline.close < lastCandle.open) ? 'Engulfing' : null;
};

// 4. Ведмеже поглинання всього діапазону
export const absorptionSHORT: DetectorFn = ({ kline, lastCandle }) => {
  const isStrong = kline.close < lastCandle.low && kline.open > lastCandle.high;
  return (isStrong && isBearish(kline)) ? 'Absorption' : null;
};

// 5. Рельси SHORT
export const railsSHORT: DetectorFn = ({ kline, lastCandle, avgBody }) => {
  const body = getBody(kline);
  const prevBody = getBody(lastCandle);
  const areLarge = body > avgBody * 1.5 && prevBody > avgBody * 1.5;
  const areEqual = Math.abs(body - prevBody) < body * 0.2;
  return (isBearish(kline) && isBullish(lastCandle) && areLarge && areEqual) ? 'Rails' : null;
};

// 6. Ведмежий Моментум
export const bearishMomentum: DetectorFn = ({ kline, avgBody }) => {
  const body = getBody(kline);
  const size = getCandleSize(kline);
  if (size === 0) return null;
  return (isBearish(kline) && body > avgBody * 2.0 && body >= size * 0.8) ? 'Momentum' : null;
};

/**
 * Реєстр патернів для зручного перебору
 */
export const LONG_DETECTORS = [
  hammerDetector,
  pinBarLONG,
  bullishEngulfing,
  absorptionLONG,
  railsLONG,
  bullishMomentum,
  insideBar
];

export const SHORT_DETECTORS = [
  shootingStarDetector,
  pinBarSHORT,
  bearishEngulfing,
  absorptionSHORT,
  railsSHORT,
  bearishMomentum,
  insideBar
];