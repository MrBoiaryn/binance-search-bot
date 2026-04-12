import { PatternContext } from '../models/models';

export type DetectorFn = (ctx: PatternContext) => string | null;

/**
 * --- БАЗОВІ МЕТРИКИ ---
 */
const getBody = (k: any) => Math.abs(k.close - k.open);
const getRange = (k: any) => k.high - k.low;
const getUpperShadow = (k: any) => k.high - Math.max(k.open, k.close);
const getLowerShadow = (k: any) => Math.min(k.open, k.close) - k.low;

const isBullish = (k: any) => k.close > k.open;
const isBearish = (k: any) => k.close < k.open;

/**
 * --- НЕЙТРАЛЬНІ ПАТЕРНИ (СТАН РИНКУ) ---
 */

// 1. DOJI (Доджі) - за Булковські
export const dojiDetector: DetectorFn = ({ kline }) => {
  const range = getRange(kline);
  if (range === 0) return null;
  // Тіло не більше 10% від всього діапазону свічки
  return (getBody(kline) <= range * 0.1) ? 'Doji' : null;
};

// 2. INSIDE BAR (Внутрішній бар)
export const insideBarDetector: DetectorFn = ({ kline, lastCandle }) => {
  return (kline.high < lastCandle.high && kline.low > lastCandle.low) ? 'Inside' : null;
};

/**
 * --- LONG PATTERNS (Бичачі) ---
 */

// 1. HAMMER (Молот) - за Нісоном
export const hammerDetector: DetectorFn = ({ kline }) => {
  const range = getRange(kline);
  const body = getBody(kline);
  if (range === 0) return null;

  const isSmallBody = body <= range * 0.3;
  const isLongLowerShadow = getLowerShadow(kline) >= body * 2;
  const isVeryShortUpperShadow = getUpperShadow(kline) <= range * 0.1;

  return (isSmallBody && isLongLowerShadow && isVeryShortUpperShadow) ? 'Hammer' : null;
};

// 2. PIN BAR LONG - за Прінгом
export const pinBarLONG: DetectorFn = ({ kline }) => {
  const range = getRange(kline);
  if (range === 0) return null;
  // Хвіст займає мінімум 66% свічки, тіло максимум 15%
  return (getLowerShadow(kline) >= range * 0.66 && getBody(kline) <= range * 0.15) ? 'PinBar' : null;
};

// 3. BULLISH ENGULFING (Бичаче поглинання)
export const bullishEngulfing: DetectorFn = ({ kline, lastCandle }) => {
  return (isBullish(kline) && isBearish(lastCandle) &&
    kline.open <= lastCandle.close &&
    kline.close >= lastCandle.open) ? 'Engulfing' : null;
};

// 4. RAILS LONG (Рельси) - з фільтром "чистих тіл"
export const railsLONG: DetectorFn = ({ kline, lastCandle, avgBody }) => {
  const b1 = getBody(lastCandle);
  const b2 = getBody(kline);
  const r1 = getRange(lastCandle);
  const r2 = getRange(kline);

  if (r1 === 0 || r2 === 0) return null;

  const areLarge = b1 > avgBody * 1.5 && b2 > avgBody * 1.5;
  const areEqual = Math.abs(b1 - b2) < b2 * 0.1; // Різниця тіл до 10%
  // ✅ Тіні майже відсутні (Тіло займає 85%+ свічки)
  const isClean = (b1 >= r1 * 0.85) && (b2 >= r2 * 0.85);

  return (isBullish(kline) && isBearish(lastCandle) && areLarge && areEqual && isClean) ? 'Rails' : null;
};

// 5. ABSORPTION LONG (Повне поглинання діапазону)
export const absorptionLONG: DetectorFn = ({ kline, lastCandle }) => {
  return (isBullish(kline) && kline.high > lastCandle.high && kline.low < lastCandle.low) ? 'Absorption' : null;
};

// 6. MOMENTUM LONG
export const bullishMomentum: DetectorFn = ({ kline, avgBody }) => {
  const b = getBody(kline);
  const r = getRange(kline);
  return (isBullish(kline) && b > avgBody * 2.0 && b >= r * 0.9) ? 'Momentum' : null;
};

/**
 * --- SHORT PATTERNS (Ведмежі - Дзеркальні) ---
 */

// 1. SHOOTING STAR (Падаюча зоря)
export const shootingStarDetector: DetectorFn = ({ kline }) => {
  const range = getRange(kline);
  const body = getBody(kline);
  if (range === 0) return null;

  const isSmallBody = body <= range * 0.3;
  const isLongUpperShadow = getUpperShadow(kline) >= body * 2;
  const isVeryShortLowerShadow = getLowerShadow(kline) <= range * 0.1;

  return (isSmallBody && isLongUpperShadow && isVeryShortLowerShadow) ? 'Star' : null;
};

// 2. PIN BAR SHORT
export const pinBarSHORT: DetectorFn = ({ kline }) => {
  const range = getRange(kline);
  if (range === 0) return null;
  return (getUpperShadow(kline) >= range * 0.66 && getBody(kline) <= range * 0.15) ? 'PinBar' : null;
};

// 3. BEARISH ENGULFING (Ведмеже поглинання)
export const bearishEngulfing: DetectorFn = ({ kline, lastCandle }) => {
  return (isBearish(kline) && isBullish(lastCandle) &&
    kline.open >= lastCandle.close &&
    kline.close <= lastCandle.open) ? 'Engulfing' : null;
};

// 4. RAILS SHORT
export const railsSHORT: DetectorFn = ({ kline, lastCandle, avgBody }) => {
  const b1 = getBody(lastCandle);
  const b2 = getBody(kline);
  const r1 = getRange(lastCandle);
  const r2 = getRange(kline);

  if (r1 === 0 || r2 === 0) return null;

  const areLarge = b1 > avgBody * 1.5 && b2 > avgBody * 1.5;
  const areEqual = Math.abs(b1 - b2) < b2 * 0.1;
  const isClean = (b1 >= r1 * 0.85) && (b2 >= r2 * 0.85);

  return (isBearish(kline) && isBullish(lastCandle) && areLarge && areEqual && isClean) ? 'Rails' : null;
};

// 5. ABSORPTION SHORT
export const absorptionSHORT: DetectorFn = ({ kline, lastCandle }) => {
  return (isBearish(kline) && kline.low < lastCandle.low && kline.high > lastCandle.high) ? 'Absorption' : null;
};

// 6. MOMENTUM SHORT
export const bearishMomentum: DetectorFn = ({ kline, avgBody }) => {
  const b = getBody(kline);
  const r = getRange(kline);
  return (isBearish(kline) && b > avgBody * 2.0 && b >= r * 0.9) ? 'Momentum' : null;
};

/**
 * --- РЕЄСТРИ (СИМЕТРИЧНІ) ---
 */

export const LONG_DETECTORS = [
  hammerDetector,
  pinBarLONG,
  dojiDetector,
  bullishEngulfing,
  railsLONG,
  absorptionLONG,
  bullishMomentum,
  insideBarDetector
];

export const SHORT_DETECTORS = [
  shootingStarDetector,
  pinBarSHORT,
  dojiDetector,
  bearishEngulfing,
  railsSHORT,
  absorptionSHORT,
  bearishMomentum,
  insideBarDetector
];