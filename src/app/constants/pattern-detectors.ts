import { PatternContext } from '../models/models';

export type DetectorFn = (ctx: PatternContext) => string | null;

/**
 * --- HELPERS ---
 * Допоміжні функції, щоб не дублювати математику в кожному патерні
 */
const getBody = (k: any) => Math.abs(k.close - k.open);
const getUpperShadow = (k: any) => k.high - Math.max(k.open, k.close);
const getLowerShadow = (k: any) => Math.min(k.open, k.close) - k.low;
const isBullish = (k: any) => k.close > k.open;
const isBearish = (k: any) => k.close < k.open;

/**
 * --- LONG PATTERNS ---
 */

// 1. Молот (Hammer) - класика
export const hammerDetector: DetectorFn = ({ kline }) => {
  const body = getBody(kline);
  const lowerShadow = getLowerShadow(kline);
  const upperShadow = getUpperShadow(kline);
  return (lowerShadow > body * 2 && upperShadow < body * 0.5) ? 'Hammer' : null;
};

// 2. Пін-бар (PinBar) - професійний молот з дуже довгою тінню
export const pinBarLONG: DetectorFn = ({ kline }) => {
  const body = getBody(kline);
  const lowerShadow = getLowerShadow(kline);
  return (lowerShadow > body * 3) ? 'PinBar' : null;
};

// 3. Поглинання (Engulfing)
export const bullishEngulfing: DetectorFn = ({ kline, lastCandle }) => {
  const body = getBody(kline);
  const prevBody = getBody(lastCandle);
  return (isBullish(kline) && isBearish(lastCandle) && body > prevBody * 1.1) ? 'Engulfing' : null;
};

// 4. Поглинання всього діапазону (Absorption) - коли тіло перекриває всю попередню свічку з тінями
export const absorptionLONG: DetectorFn = ({ kline, lastCandle }) => {
  const isStrong = kline.close > lastCandle.high && kline.open < lastCandle.low;
  return (isStrong && isBullish(kline)) ? 'Absorption' : null;
};

// 5. Рельси (Railway Tracks) - дві великі зустрічні свічки
export const railsLONG: DetectorFn = ({ kline, lastCandle, avgBody }) => {
  const body = getBody(kline);
  const prevBody = getBody(lastCandle);
  const areLarge = body > avgBody * 1.5 && prevBody > avgBody * 1.5;
  const areEqual = Math.abs(body - prevBody) < body * 0.2;
  return (isBullish(kline) && isBearish(lastCandle) && areLarge && areEqual) ? 'Rails' : null;
};

// 6. Моментум (Momentum) - аномально велике тіло
export const bullishMomentum: DetectorFn = ({ kline, avgBody }) => {
  return (isBullish(kline) && getBody(kline) > avgBody * 2.5) ? 'Momentum' : null;
};

// 7. Внутрішній бар (Inside Bar) - ознака накопичення
export const insideBar: DetectorFn = ({ kline, lastCandle }) => {
  return (kline.high < lastCandle.high && kline.low > lastCandle.low) ? 'Inside' : null;
};


/**
 * --- SHORT PATTERNS ---
 */

// 1. Падаюча зоря (Shooting Star)
export const shootingStarDetector: DetectorFn = ({ kline }) => {
  const body = getBody(kline);
  const lowerShadow = getLowerShadow(kline);
  const upperShadow = getUpperShadow(kline);
  return (upperShadow > body * 2 && lowerShadow < body * 0.5) ? 'Star' : null;
};

// 2. Пін-бар (Short PinBar)
export const pinBarSHORT: DetectorFn = ({ kline }) => {
  const body = getBody(kline);
  const upperShadow = getUpperShadow(kline);
  return (upperShadow > body * 3) ? 'PinBar' : null;
};

// 3. Ведмеже поглинання
export const bearishEngulfing: DetectorFn = ({ kline, lastCandle }) => {
  const body = getBody(kline);
  const prevBody = getBody(lastCandle);
  return (isBearish(kline) && isBullish(lastCandle) && body > prevBody * 1.1) ? 'Engulfing' : null;
};

// 4. Ведмеже поглинання всього діапазону (Absorption)
export const absorptionSHORT: DetectorFn = ({ kline, lastCandle }) => {
  const isStrong = kline.close < lastCandle.low && kline.open > lastCandle.high;
  return (isStrong && isBearish(kline)) ? 'Absorption' : null;
};

// 5. Рельси (Railway Tracks) SHORT
export const railsSHORT: DetectorFn = ({ kline, lastCandle, avgBody }) => {
  const body = getBody(kline);
  const prevBody = getBody(lastCandle);
  const areLarge = body > avgBody * 1.5 && prevBody > avgBody * 1.5;
  const areEqual = Math.abs(body - prevBody) < body * 0.2;
  return (isBearish(kline) && isBullish(lastCandle) && areLarge && areEqual) ? 'Rails' : null;
};

// 6. Ведмежий Моментум
export const bearishMomentum: DetectorFn = ({ kline, avgBody }) => {
  return (isBearish(kline) && getBody(kline) > avgBody * 2.5) ? 'Momentum' : null;
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