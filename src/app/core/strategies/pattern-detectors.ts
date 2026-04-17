import { PatternContext } from '../../models/models';
import { PatternType } from '../constants/trade-enums';

/**
 * DetectorFn — це тип функції, яка приймає контекст (свічку та її оточення)
 * і повертає або назву патерна (з Енамки), або null, якщо нічого не знайдено.
 */
export type DetectorFn = (ctx: PatternContext) => PatternType | null;

/**
 * --- ДОПОМІЖНІ МЕТРИКИ (Фундамент розрахунків) ---
 */
// Різниця між ціною відкриття та закриття (чисте "м'ясо" свічки)
const getBody = (k: any) => Math.abs(k.close - k.open);

// Повний розмір свічки від самого верху (High) до самого низу (Low)
const getRange = (k: any) => k.high - k.low;

// Довжина "вуса" зверху (відстань від максимуму до тіла)
const getUpperShadow = (k: any) => k.high - Math.max(k.open, k.close);

// Довжина "хвоста" знизу (відстань від мінімуму до тіла)
const getLowerShadow = (k: any) => Math.min(k.open, k.close) - k.low;

// Перевірка: чи свічка зростаюча (зелена)
const isBullish = (k: any) => k.close > k.open;

// Перевірка: чи свічка падаюча (червона)
const isBearish = (k: any) => k.close < k.open;

/**
 * --- НЕЙТРАЛЬНІ ПАТЕРНИ (Ознака зупинки ринку) ---
 */

// DOJI: Свічка, де ціна майже не змінилася за період. Ринок "завис".
export const dojiDetector: DetectorFn = ({ kline }) => {
  const range = getRange(kline);
  if (range === 0) return null; // Захист від порожніх свічок

  const body = getBody(kline);
  const upper = getUpperShadow(kline);
  const lower = getLowerShadow(kline);

  // 1. Умова "Тіло-нитка": тіло займає менше 10% від всього руху свічки
  const isSmallBody = body <= range * 0.1;
  // 2. Умова "Центрування": верхня і нижня тіні майже однакові (різниця до 30% від діапазону)
  // Тобто тіло знаходиться приблизно посередині свічки.
  const isCentral = Math.abs(upper - lower) <= (range * 0.3);

  return (isSmallBody && isCentral) ? PatternType.DOJI : null;
};

// INSIDE BAR: Свічка, яка повністю "захована" всередині попередньої.
// Означає стискання пружини перед пробоєм.
export const insideBarDetector: DetectorFn = ({ kline, lastCandle }) => {
  // Поточний High нижче попереднього І поточний Low вище попереднього
  return (kline.high < lastCandle.high && kline.low > lastCandle.low) ? PatternType.INSIDE : null;
};

/**
 * --- LONG PATTERNS (Сигнали на покупку) ---
 */

// HAMMER (Молот): Ціна сильно впала, але покупці її викупили назад до закриття.
export const hammerDetector: DetectorFn = ({ kline }) => {
  const range = getRange(kline);
  if (range === 0) return null;

  const body = getBody(kline);
  const upperShadow = getUpperShadow(kline);
  const lowerShadow = getLowerShadow(kline);

  // 1. Тіло не повинно бути занадто великим (макс 30% від всієї свічки)
  const isSmallBody = body <= range * 0.3;

  // 2. ВЕРХНЯ ТІНЬ має бути символічною (макс 10% від всієї свічки)
  // Це і гарантує, що тіло "притиснуте" до самого верху
  const isAtTheVeryTop = upperShadow <= range * 0.1;

  // 3. НИЖНІЙ ХВІСТ має бути домінантним
  // Якщо тіло 30%, а верх 10%, то на хвіст лишається 60%. Це ідеальний Молот.
  const isLongTail = lowerShadow >= range * 0.6;

  return (isSmallBody && isAtTheVeryTop && isLongTail) ? PatternType.HAMMER : null;
};

// PIN BAR LONG: Екстремальна версія Молота.
export const pinBarLONG: DetectorFn = ({ kline }) => {
  const range = getRange(kline);
  if (range === 0) return null;
  // Нижній хвіст займає мінімум 66% всієї свічки, тіло — мізерне (до 15%)
  return (getLowerShadow(kline) >= range * 0.66 && getBody(kline) <= range * 0.15) ? PatternType.PIN_BAR : null;
};

// BULLISH ENGULFING (Бичаче поглинання): Нова зелена свічка повністю "з'їдає" попередню червону.
export const bullishEngulfing: DetectorFn = ({ kline, lastCandle }) => {
  // Поточна — зелена, попередня — червона
  // Тіло поточної закриває (перекриває) відкриття та закриття попередньої
  return (isBullish(kline) && isBearish(lastCandle) &&
    kline.close >= lastCandle.open && kline.open <= lastCandle.close) ? PatternType.ENGULFING : null;
};

// RAILS LONG (Рейки): Дві великі свічки однакового розміру в різні боки.
export const railsLONG: DetectorFn = ({ kline, lastCandle, avgBody }) => {
  const b1 = getBody(lastCandle);
  const b2 = getBody(kline);
  const r1 = getRange(lastCandle);
  const r2 = getRange(kline);

  if (r1 === 0 || r2 === 0) return null;

  // 1. Обидві свічки великі (в 1.5 раза більші за середнє тіло на ринку)
  const areLarge = b1 > avgBody * 1.5 && b2 > avgBody * 1.5;
  // 2. Тіла майже ідентичні за розміром (різниця менше 10%)
  const areEqual = Math.abs(b1 - b2) < b1 * 0.1;
  // 3. "Чистота": свічки майже без тіней (тіло займає 85%+ всього діапазону)
  const isClean = (b1 >= r1 * 0.85) && (b2 >= r2 * 0.85);

  return (isBullish(kline) && isBearish(lastCandle) && areLarge && areEqual && isClean) ? PatternType.RAILS : null;
};

// ABSORPTION LONG (Супер-поглинання): Ціна закрилася вище максимуму попередньої свічки.
export const absorptionLONG: DetectorFn = ({ kline, lastCandle }) => {
  // Закриття вище хаю попередньої ТА відкриття нижче лоу попередньої (рідкісний імпульс)
  return (isBullish(kline) && kline.close > lastCandle.high && kline.open < lastCandle.low) ? PatternType.ABSORPTION : null;
};

// BULLISH MOMENTUM: Велика впевнена зелена свічка без тіней.
export const bullishMomentum: DetectorFn = ({ kline, avgBody }) => {
  const b = getBody(kline);
  // 1. Тіло вдвічі більше за середнє
  // 2. Майже немає тіней (тіло займає 90% діапазону)
  return (isBullish(kline) && b > avgBody * 2.0 && b >= getRange(kline) * 0.9) ? PatternType.MOMENTUM : null;
};

/**
 * --- SHORT PATTERNS (Сигнали на продаж) ---
 * Логіка дзеркальна до LONG патернів.
 */

// SHOOTING STAR (Падаюча зоря): Аналог Молота, але зверху.
export const shootingStarDetector: DetectorFn = ({ kline }) => {
  const range = getRange(kline);
  if (range === 0) return null;

  const body = getBody(kline);
  const upperShadow = getUpperShadow(kline);
  const lowerShadow = getLowerShadow(kline);

  const isSmallBody = body <= range * 0.3;
  const isAtTheVeryBottom = lowerShadow <= range * 0.1; // Хвіст знизу мінімальний
  const isLongNose = upperShadow >= range * 0.6;      // Ніс зверху величезний

  return (isSmallBody && isAtTheVeryBottom && isLongNose) ? PatternType.STAR : null;
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
  // hammerDetector,
  // pinBarLONG,
  // dojiDetector,
  // bullishEngulfing,
  // railsLONG,
  // absorptionLONG,
  // bullishMomentum,
  insideBarDetector
];

export const SHORT_DETECTORS = [
  // shootingStarDetector,
  // pinBarSHORT,
  // dojiDetector,
  // bearishEngulfing,
  // railsSHORT,
  // absorptionSHORT,
  // bearishMomentum,
  insideBarDetector
];
