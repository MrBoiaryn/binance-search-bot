import { PatternContext, ScannerSettings, TradeSignal } from '../../models/models';
import { LONG_DETECTORS, SHORT_DETECTORS } from './pattern-detectors';
import { findTrueLevel, roundToTick } from '../math/indicators';
import { LevelType, PatternType, SignalSide } from '../constants/trade-enums';

export function detectTradeSignal(
  kline: any,
  volMult: number,
  prevVolMult: number,
  ctx: PatternContext,
  history: any[],
  tf: string,
  settings: ScannerSettings,
  symbolTickSizes: Map<string, number>,
  symbolQuotes: Map<string, string>
): TradeSignal | null {
  if (settings.useDivergence && !ctx.hasDivergence) return null;

  // LONG
  if (settings.showLong) {
    for (const detect of LONG_DETECTORS) {
      const name = detect(ctx);
      if (name) {
        const effectiveVol = name === PatternType.INSIDE ? prevVolMult : volMult;
        if (effectiveVol < settings.minVolMult || effectiveVol > settings.maxVolMult) continue;

        const isAtBottom = (name === PatternType.INSIDE) ? ctx.isMotherBarBottom : ctx.isLocalBottom;

        if (isAtBottom) {
          const isAnomalousVol = effectiveVol >= (settings.minVolMult * 2.5);
          const suffix = isAnomalousVol ? ' 🔥' : (ctx.hasDivergence ? ' 💎' : '');
          const signal = createSignal(kline, SignalSide.LONG, `${name}${suffix}`, effectiveVol, tf, history, ctx.atr, ctx.hasDivergence, settings, symbolTickSizes, symbolQuotes);

          if (isValidSignal(signal, settings)) {
            return signal;
          }
        }
      }
    }
  }

  // SHORT
  if (settings.showShort) {
    for (const detect of SHORT_DETECTORS) {
      const name = detect(ctx);
      if (name) {
        const effectiveVol = name === PatternType.INSIDE ? prevVolMult : volMult;
        if (effectiveVol < settings.minVolMult || effectiveVol > settings.maxVolMult) continue;

        const isAtPeak = (name === PatternType.INSIDE) ? ctx.isMotherBarPeak : ctx.isLocalPeak;

        if (isAtPeak) {
          const isAnomalousVol = effectiveVol >= (settings.minVolMult * 2.5);
          const suffix = isAnomalousVol ? ' 🔥' : (ctx.hasDivergence ? ' 💎' : '');
          const signal = createSignal(kline, SignalSide.SHORT, `${name}${suffix}`, effectiveVol, tf, history, ctx.atr, ctx.hasDivergence, settings, symbolTickSizes, symbolQuotes);

          if (isValidSignal(signal, settings)) {
            return signal;
          }
        }
      }
    }
  }
  return null;
}

export function isValidSignal(sig: TradeSignal | null, settings: ScannerSettings): boolean {
  if (!sig) return false;
  return (
    sig.lvlStrength >= settings.minLvlStrength &&
    sig.profitPercent >= settings.minProfitThreshold &&
    sig.swingStrength >= settings.minSwing &&
    sig.swingStrength <= settings.maxSwing &&
    sig.rr >= settings.minRR
  );
}

export function createSignal(
  kline: any,
  type: SignalSide,
  pattern: string,
  vol: number,
  tf: string,
  history: any[],
  atr: number,
  hasDivergence: boolean,
  settings: ScannerSettings,
  symbolTickSizes: Map<string, number>,
  symbolQuotes: Map<string, string>
): TradeSignal | null {
  const symbol = kline.symbol.toUpperCase();
  const tickSize = symbolTickSizes.get(symbol) || 0.0001;

  const isInside = pattern.includes(PatternType.INSIDE);

  // Якщо патерн "Inside" (Внутрішній бар), вхід розраховується від попередньої (материнської) свічки
  const entryRefCandle = isInside ? history[history.length - 1] : kline;

  // ==========================================
  // 1. ТОЧКА ВХОДУ (Entry Price з відступом)
  // ==========================================
  // Робимо невеличкий відступ (0.1 ATR) від екстремуму свічки, щоб уникнути хибних проколів.
  // Для Лонга беремо High + відступ, для Шорта беремо Low - відступ.
  const entryOffset = atr * 0.1;
  const rawEntryPrice = type === SignalSide.LONG
    ? entryRefCandle.high + entryOffset
    : entryRefCandle.low - entryOffset;

  const entryPrice = roundToTick(rawEntryPrice, tickSize);

  // ==========================================
  // 2. ФІЛЬТР ВОЛАТИЛЬНОСТІ (MA Deviation)
  // ==========================================
  // Перевіряємо, чи ціна не знаходиться в глухому флеті.
  // Рахуємо відхилення типової поточної ціни від середньої за останні 20 свічок.
  const typicalPrice = (kline.high + kline.low + kline.close) / 3;
  const avgPrice = history.slice(-20).reduce((acc, k) => acc + k.close, 0) / 20;
  const maDeviation = Math.abs((typicalPrice - avgPrice) / avgPrice) * 100;

  // Якщо відхилення менше за мінімально дозволене в налаштуваннях - ігноруємо сигнал.
  if (maDeviation < settings.minSwing) return null;

  // ==========================================
  // 3. СТОП-ЛОСС ТА РИЗИК (Stop Loss & Risk)
  // ==========================================
  // Рахуємо стоп-лосс на основі патерну та ATR.
  const sl = calculateSL(kline, history, type, tickSize, pattern, atr);

  // Фактичний ризик у доларах/тиках (відстань від входу до стопа).
  // Використовуємо || tickSize на випадок мікро-рухів, щоб уникнути ділення на нуль в подальшому.
  const actualRisk = Math.abs(entryPrice - sl) || tickSize;

  // ==========================================
  // 4. ТЕЙК-ПРОФІТ (Зони ліквідності)
  // ==========================================
  // Шукаємо справжню зону ліквідності (і цілимось у її найближчий край)
  const levelData = findTrueLevel(
    history.slice(-500),
    type === SignalSide.LONG ? LevelType.RESISTANCE : LevelType.SUPPORT,
    entryPrice,
    tickSize,
    atr,
    settings.fractalWindow || 5 // Передаємо вікно фракталу (дефолт 5)
  );

  const { minRR, maxRR } = settings;
  const requiredReward = actualRisk * minRR;      // Мінімально необхідний прибуток для входу
  const maxAllowedReward = actualRisk * maxRR;    // Обмежувач жадібності

  let tpPrice = levelData.price;
  let naturalReward = Math.abs(tpPrice - entryPrice);

  // 🛑 ПРОФЕСІЙНИЙ ФІЛЬТР R/R (Ризик/Прибуток)
  // Якщо знайдена зона ліквідності знаходиться ближче, ніж наш мінімальний R/R,
  // або якщо рівень взагалі опинився з іншого боку від входу (наприклад, ціна вже пробила його) -
  // МИ ВІДХИЛЯЄМО ЦЮ УГОДУ. Ставити тейк штучно у "повітря" - це поганий трейдинг.
  if (naturalReward < requiredReward || (type === SignalSide.LONG ? tpPrice <= entryPrice : tpPrice >= entryPrice)) {
    return null; // Угода відхиляється: немає достатнього потенціалу ходу ціни
  }

  // ✂️ ФІЛЬТР ЖАДІБНОСТІ (Max R/R)
  // Якщо рівень дуже далеко (наприклад, R/R вийшов 10 до 1), ми штучно обрізаємо тейк до maxRR,
  // щоб не сидіти в угоді тижнями і гарантовано забрати великий прибуток.
  if (naturalReward > maxAllowedReward) {
    tpPrice = type === SignalSide.LONG
      ? entryPrice + maxAllowedReward
      : entryPrice - maxAllowedReward;
  }

  // Округлюємо фінальний тейк-профіт до кроку ціни біржі
  const tp = roundToTick(tpPrice, tickSize);

  // ==========================================
  // 5. ФОРМУВАННЯ ОБ'ЄКТА СИГНАЛУ
  // ==========================================
  return {
    symbol,
    type,
    pattern,
    timeframe: tf,
    entryPrice,
    currentPrice: kline.close,
    stopLoss: sl,
    takeProfit: tp,
    lvlStrength: levelData.strength,
    swingStrength: maDeviation,
    volumeMultiplier: vol,
    liqAmount: 0, // Заповнюється окремо (наприклад, з потоку ліквідацій)
    timestamp: Date.now(),
    quoteAsset: symbolQuotes.get(symbol) || 'USDT',

    // Розраховуємо чистий відсоток прибутку (без плеча)
    profitPercent: (Math.abs(tp - entryPrice) / entryPrice) * 100,

    // Розраховуємо фінальний R/R для відображення в UI
    rr: Math.abs(tp - entryPrice) / actualRisk,

    hasDivergence,

    // Передаємо межі "коридору" (зони ліквідності) для візуалізації в таблиці
    tpZoneMin: levelData.zoneMin,
    tpZoneMax: levelData.zoneMax
  };
}

export function calculateSL(kline: any, history: any[], type: SignalSide, tick: number, pattern: string, atr: number): number {
  const slOffset = atr * 0.15;
  const isInside = pattern.includes(PatternType.INSIDE);

  // 1. Для Інсайд-бару стоп ховаємо за материнську свічку
  if (isInside) {
    const motherBar = history[history.length - 1];
    return type === SignalSide.LONG
      ? roundToTick(motherBar.low - slOffset, tick)
      : roundToTick(motherBar.high + slOffset, tick);
  }

  // 2. Для всіх екстремальних свічкових розворотів ставимо короткий стоп за поточну свічку
  if (
    pattern.includes(PatternType.HAMMER) ||
    pattern.includes(PatternType.INVERTED_HAMMER) ||
    pattern.includes(PatternType.STAR) ||
    pattern.includes(PatternType.HANGING_MAN) ||
    pattern.includes(PatternType.DOJI)
  ) {
    return type === SignalSide.LONG
      ? roundToTick(kline.low - slOffset, tick)
      : roundToTick(kline.high + slOffset, tick);
  }

  // 3. Дефолтний стоп (для Engulfing, Rails, Absorption, Momentum)
  // Ховаємо за локальний екстремум останніх 3-х свічок
  const candles = history.slice(-3);
  return type === SignalSide.LONG
    ? roundToTick(Math.min(...candles.map(k => k.low), kline.low) - slOffset, tick)
    : roundToTick(Math.max(...candles.map(k => k.high), kline.high) + slOffset, tick);
}
