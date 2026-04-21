import { PatternContext, ScannerSettings, TradeSignal } from '../../models/models';
import { LONG_DETECTORS, SHORT_DETECTORS } from './pattern-detectors';
import { findTrueLevel, roundToTick, checkTrendBias } from '../math/indicators';
import { aggregateCandles, getAggregationRatio } from '../math/trading-math';
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

  // HTF Trend Filter calculation
  let htfTrend: 'BULLISH' | 'BEARISH' | 'NEUTRAL' = 'NEUTRAL';
  if (settings.useTrendFilter) {
    const ratio = getAggregationRatio(tf);
    const htfHistory = aggregateCandles(history, ratio);
    htfTrend = checkTrendBias(htfHistory, settings.trendEmaPeriod);
  }

  // LONG
  if (settings.showLong) {
    // Apply HTF filter for LONG: only allow if BULLISH
    if (!settings.useTrendFilter || htfTrend === 'BULLISH' || ctx.hasDivergence) {
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
  }

  // SHORT
  if (settings.showShort) {
    // Apply HTF filter for SHORT: only allow if BEARISH
    if (!settings.useTrendFilter || htfTrend === 'BEARISH' || ctx.hasDivergence) {
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
  }
  return null;
}

export function isValidSignal(sig: TradeSignal | null, settings: ScannerSettings): boolean {
  if (!sig) return false;

  if (settings.disableTakeProfit) {
    return (
      sig.lvlStrength >= settings.minLvlStrength &&
      sig.swingStrength >= settings.minSwing &&
      sig.swingStrength <= settings.maxSwing
    );
  }

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
  const entryRefCandle = isInside ? history[history.length - 1] : kline;

  // 1. ТОЧКА ВХОДУ
  const entryOffset = atr * 0.1;
  const rawEntryPrice = type === SignalSide.LONG ? entryRefCandle.high + entryOffset : entryRefCandle.low - entryOffset;
  const entryPrice = roundToTick(rawEntryPrice, tickSize);

  // 2. ВІДХИЛЕННЯ (MA Deviation)
  const typicalPrice = (kline.high + kline.low + kline.close) / 3;
  const avgPrice = history.slice(-20).reduce((acc, k) => acc + k.close, 0) / 20;
  const maDeviation = Math.abs((typicalPrice - avgPrice) / avgPrice) * 100;

  if (maDeviation < settings.minSwing) return null;

  // 3. СТОП-ЛОСС
  const sl = calculateSL(kline, history, type, tickSize, pattern, atr);
  const actualRisk = Math.abs(entryPrice - sl) || tickSize;

  // 4. ТЕЙК-ПРОФІТ (Пошук цілі для візуалізації)
  const levelData = findTrueLevel(
    history.slice(-500),
    type === SignalSide.LONG ? LevelType.RESISTANCE : LevelType.SUPPORT,
    entryPrice,
    tickSize,
    atr,
    settings.fractalWindow || 5
  );

  const { minRR, maxRR } = settings;
  const requiredReward = actualRisk * minRR;
  const maxAllowedReward = actualRisk * maxRR;

  let tpPrice = levelData.price;
  let naturalReward = Math.abs(tpPrice - entryPrice);

  // ФІЛЬТРАЦІЯ R/R (тільки якщо Runners Mode ВИМКНЕНО)
  if (!settings.disableTakeProfit) {
    if (naturalReward < requiredReward || (type === SignalSide.LONG ? tpPrice <= entryPrice : tpPrice >= entryPrice)) {
      return null;
    }
  }

  // Обмеження жадібності (Max R/R)
  if (naturalReward > maxAllowedReward) {
    tpPrice = type === SignalSide.LONG ? entryPrice + maxAllowedReward : entryPrice - maxAllowedReward;
  }

  // ФОРМУВАННЯ ОБ'ЄКТА
  return {
    symbol,
    type,
    pattern,
    timeframe: tf,
    entryPrice,
    currentPrice: kline.close,
    stopLoss: sl,
    // В takeProfit завжди пишемо ціну цілі, щоб UI був коректним (без -100%)
    takeProfit: roundToTick(tpPrice, tickSize),
    lvlStrength: levelData.strength,
    swingStrength: maDeviation,
    volumeMultiplier: vol,
    liqAmount: 0,
    timestamp: Date.now(),
    quoteAsset: symbolQuotes.get(symbol) || 'USDT',

    // Ці поля тепер завжди будуть позитивними і показуватимуть потенціал до рівня
    profitPercent: (Math.abs(tpPrice - entryPrice) / entryPrice) * 100,
    rr: Math.abs(tpPrice - entryPrice) / actualRisk,

    hasDivergence,
    tpZoneMin: levelData.zoneMin,
    tpZoneMax: levelData.zoneMax,

    // Додаємо мітку, щоб менеджер позицій знав, що тейк ставити не треба
    isRunner: settings.disableTakeProfit
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
