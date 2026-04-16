import { PatternContext } from '../../models/models';
import { PatternType } from '../constants/trade-enums';

export type DetectorFn = (ctx: PatternContext) => PatternType | null;

/**
 * --- ДОПОМІЖНІ МЕТРИКИ ---
 */
const getBody = (k: any) => Math.abs(k.close - k.open);
const getRange = (k: any) => k.high - k.low;
const getUpperShadow = (k: any) => k.high - Math.max(k.open, k.close);
const getLowerShadow = (k: any) => Math.min(k.open, k.close) - k.low;

const isBullish = (k: any) => k.close > k.open;
const isBearish = (k: any) => k.close < k.open;

/**
 * --- НЕЙТРАЛЬНІ ПАТЕРНИ ---
 */

// Оновлений DOJI (тепер справді нейтральний)
export const dojiDetector: DetectorFn = ({ kline }) => {
  const range = getRange(kline);
  if (range === 0) return null;

  const body = getBody(kline);
  const upper = getUpperShadow(kline);
  const lower = getLowerShadow(kline);

  // 1. Тіло крихітне (до 10% діапазону)
  const isSmallBody = body <= range * 0.1;
  // 2. Тіло знаходиться посередині (тіні приблизно рівні, допуск 30%)
  const isCentral = Math.abs(upper - lower) <= (range * 0.3);

  return (isSmallBody && isCentral) ? PatternType.DOJI : null;
};

export const insideBarDetector: DetectorFn = ({ kline, lastCandle }) => {
  return (kline.high < lastCandle.high && kline.low > lastCandle.low) ? PatternType.INSIDE : null;
};

/**
 * --- LONG PATTERNS (Бичачі) ---
 */

export const hammerDetector: DetectorFn = ({ kline }) => {
  const range = getRange(kline);
  const body = getBody(kline);
  if (range === 0) return null;

  // Тіло вгорі, довгий хвіст знизу
  const isSmallBody = body <= range * 0.3;
  const isLongLowerShadow = getLowerShadow(kline) >= body * 2;
  const isShortUpperShadow = getUpperShadow(kline) <= range * 0.1;

  return (isSmallBody && isLongLowerShadow && isShortUpperShadow) ? PatternType.HAMMER : null;
};

export const pinBarLONG: DetectorFn = ({ kline }) => {
  const range = getRange(kline);
  if (range === 0) return null;
  // Хвіст займає 2/3 свічки (66%), тіло дуже мале
  return (getLowerShadow(kline) >= range * 0.66 && getBody(kline) <= range * 0.15) ? PatternType.PIN_BAR : null;
};

export const bullishEngulfing: DetectorFn = ({ kline, lastCandle }) => {
  // Поточне тіло більше попереднього і закриває його повністю
  return (isBullish(kline) && isBearish(lastCandle) &&
    kline.close >= lastCandle.open && kline.open <= lastCandle.close) ? PatternType.ENGULFING : null;
};

export const railsLONG: DetectorFn = ({ kline, lastCandle, avgBody }) => {
  const b1 = getBody(lastCandle);
  const b2 = getBody(kline);
  const r1 = getRange(lastCandle);
  const r2 = getRange(kline);

  if (r1 === 0 || r2 === 0) return null;

  const areLarge = b1 > avgBody * 1.5 && b2 > avgBody * 1.5;
  const areEqual = Math.abs(b1 - b2) < b1 * 0.1; // Тіла майже однакові
  const isClean = (b1 >= r1 * 0.85) && (b2 >= r2 * 0.85); // Тіні мінімальні

  return (isBullish(kline) && isBearish(lastCandle) && areLarge && areEqual && isClean) ? PatternType.RAILS : null;
};

export const absorptionLONG: DetectorFn = ({ kline, lastCandle }) => {
  // Перекриваємо весь High-Low попередньої свічки
  return (isBullish(kline) && kline.close > lastCandle.high && kline.open < lastCandle.low) ? PatternType.ABSORPTION : null;
};

export const bullishMomentum: DetectorFn = ({ kline, avgBody }) => {
  const b = getBody(kline);
  return (isBullish(kline) && b > avgBody * 2.0 && b >= getRange(kline) * 0.9) ? PatternType.MOMENTUM : null;
};

/**
 * --- SHORT PATTERNS (Ведмежі) ---
 */

export const shootingStarDetector: DetectorFn = ({ kline }) => {
  const range = getRange(kline);
  const body = getBody(kline);
  if (range === 0) return null;

  // Тіло внизу, довгий хвіст вгорі
  const isSmallBody = body <= range * 0.3;
  const isLongUpperShadow = getUpperShadow(kline) >= body * 2;
  const isShortLowerShadow = getLowerShadow(kline) <= range * 0.1;

  return (isSmallBody && isLongUpperShadow && isShortLowerShadow) ? PatternType.STAR : null;
};

export const pinBarSHORT: DetectorFn = ({ kline }) => {
  const range = getRange(kline);
  if (range === 0) return null;
  return (getUpperShadow(kline) >= range * 0.66 && getBody(kline) <= range * 0.15) ? PatternType.PIN_BAR : null;
};

export const bearishEngulfing: DetectorFn = ({ kline, lastCandle }) => {
  return (isBearish(kline) && isBullish(lastCandle) &&
    kline.close <= lastCandle.open && kline.open >= lastCandle.close) ? PatternType.ENGULFING : null;
};

export const railsSHORT: DetectorFn = ({ kline, lastCandle, avgBody }) => {
  const b1 = getBody(lastCandle);
  const b2 = getBody(kline);
  const r1 = getRange(lastCandle);
  const r2 = getRange(kline);

  if (r1 === 0 || r2 === 0) return null;

  const areLarge = b1 > avgBody * 1.5 && b2 > avgBody * 1.5;
  const areEqual = Math.abs(b1 - b2) < b1 * 0.1;
  const isClean = (b1 >= r1 * 0.85) && (b2 >= r2 * 0.85);

  return (isBearish(kline) && isBullish(lastCandle) && areLarge && areEqual && isClean) ? PatternType.RAILS : null;
};

export const absorptionSHORT: DetectorFn = ({ kline, lastCandle }) => {
  return (isBearish(kline) && kline.close < lastCandle.low && kline.open > lastCandle.high) ? PatternType.ABSORPTION : null;
};

export const bearishMomentum: DetectorFn = ({ kline, avgBody }) => {
  const b = getBody(kline);
  return (isBearish(kline) && b > avgBody * 2.0 && b >= getRange(kline) * 0.9) ? PatternType.MOMENTUM : null;
};

/**
 * --- РЕЄСТРИ ---
 */

export const LONG_DETECTORS = [
  hammerDetector,
  pinBarLONG,
  // dojiDetector,
  bullishEngulfing,
  railsLONG,
  absorptionLONG,
  bullishMomentum,
  insideBarDetector
];

export const SHORT_DETECTORS = [
  shootingStarDetector,
  pinBarSHORT,
  // dojiDetector,
  bearishEngulfing,
  railsSHORT,
  absorptionSHORT,
  bearishMomentum,
  insideBarDetector
];
