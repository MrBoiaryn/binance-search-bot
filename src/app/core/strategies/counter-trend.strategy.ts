import { PatternContext, ScannerSettings, TradeSignal } from '../../models/models';
import { LONG_DETECTORS, SHORT_DETECTORS } from './pattern-detectors';
import { findTrueLevel, roundToTick } from '../math/indicators';
import { LevelType, PatternType, SignalSide } from '../constants/trade-enums';

export function detectTradeSignal(
  kline: any,
  volMult: number,
  ctx: PatternContext,
  history: any[],
  tf: string,
  settings: ScannerSettings,
  clusterTracker: Map<string, number>,
  symbolTickSizes: Map<string, number>,
  symbolQuotes: Map<string, string>
): TradeSignal | null {
  if (volMult < settings.minVolMult || volMult > settings.maxVolMult) return null;

  if (settings.useDivergence && !ctx.hasDivergence) return null;

  const isTooDense = (name: string, type: SignalSide) => {
    const key = `${name}_${type}_${tf}`;
    return (clusterTracker.get(key) || 0) >= settings.maxClusterSize;
  };

  const isAnomalousVol = volMult >= (settings.minVolMult * 2.5);

  // LONG
  if (settings.showLong) {
    for (const detect of LONG_DETECTORS) {
      const name = detect(ctx);
      if (name) {
        const isAtBottom = (name === PatternType.INSIDE) ? ctx.isMotherBarBottom : ctx.isLocalBottom;

        if (isAtBottom && !isTooDense(name, SignalSide.LONG)) {
          const suffix = isAnomalousVol ? ' 🔥' : (ctx.hasDivergence ? ' 💎' : '');
          const signal = createSignal(kline, SignalSide.LONG, `${name}${suffix}`, volMult, tf, history, ctx.atr, ctx.hasDivergence, settings, symbolTickSizes, symbolQuotes);

          if (isValidSignal(signal, settings)) {
            clusterTracker.set(`${name}_LONG_${tf}`, (clusterTracker.get(`${name}_LONG_${tf}`) || 0) + 1);
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
        const isAtPeak = (name === PatternType.INSIDE) ? ctx.isMotherBarPeak : ctx.isLocalPeak;

        if (isAtPeak && !isTooDense(name, SignalSide.SHORT)) {
          const suffix = isAnomalousVol ? ' 🔥' : (ctx.hasDivergence ? ' 💎' : '');
          const signal = createSignal(kline, SignalSide.SHORT, `${name}${suffix}`, volMult, tf, history, ctx.atr, ctx.hasDivergence, settings, symbolTickSizes, symbolQuotes);

          if (isValidSignal(signal, settings)) {
            clusterTracker.set(`${name}_SHORT_${tf}`, (clusterTracker.get(`${name}_SHORT_${tf}`) || 0) + 1);
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

  // 1. Точка входу (з ATR відступом)
  const entryOffset = atr * 0.1;
  const rawEntryPrice = type === SignalSide.LONG ? kline.high + entryOffset : kline.low - entryOffset;
  const entryPrice = roundToTick(rawEntryPrice, tickSize);

  // 2. Відхилення
  const typicalPrice = (kline.high + kline.low + kline.close) / 3;
  const avgPrice = history.slice(-20).reduce((acc, k) => acc + k.close, 0) / 20;
  const maDeviation = Math.abs((typicalPrice - avgPrice) / avgPrice) * 100;
  if (maDeviation < settings.minSwing) return null;

  // 3. Стоп-Лосс
  const sl = calculateSL(kline, history, type, tickSize, pattern, atr);
  const actualRisk = Math.abs(entryPrice - sl) || tickSize;

  // 4. Тейк-Профіт (Жорстка математика)
  const levelData = findTrueLevel(history.slice(-500), type === SignalSide.LONG ? LevelType.RESISTANCE : LevelType.SUPPORT, entryPrice, tickSize);
  const { minRR, maxRR, minLvlStrength } = settings;

  const requiredReward = actualRisk * minRR;
  const maxAllowedReward = actualRisk * maxRR;

  // ✅ Жорстко математичний мінімальний Тейк (без милиць з додаванням тіків)
  const minMathTp = type === SignalSide.LONG
    ? entryPrice + requiredReward
    : entryPrice - requiredReward;

  let tpPrice = levelData.price;
  let naturalReward = Math.abs(tpPrice - entryPrice);

  // Конфлікт рівня і RR
  if (naturalReward < requiredReward || (type === SignalSide.LONG ? tpPrice <= entryPrice : tpPrice >= entryPrice)) {
    if (levelData.strength < minLvlStrength) {
      tpPrice = minMathTp; // Застосовуємо залізну математику
    } else {
      return null;
    }
  }

  // Зрізання максимальної жадібності
  if (Math.abs(tpPrice - entryPrice) > maxAllowedReward) {
    tpPrice = type === SignalSide.LONG ? entryPrice + maxAllowedReward : entryPrice - maxAllowedReward;
  }

  const tp = roundToTick(tpPrice, tickSize);

  return {
    symbol, type, pattern, timeframe: tf,
    entryPrice,
    currentPrice: kline.close,
    stopLoss: sl,
    takeProfit: tp,
    lvlStrength: levelData.strength,
    swingStrength: maDeviation,
    volumeMultiplier: vol,
    liqAmount: 0,
    timestamp: Date.now(),
    quoteAsset: symbolQuotes.get(symbol) || 'USDT',
    profitPercent: (Math.abs(tp - entryPrice) / entryPrice) * 100,
    rr: Math.abs(tp - entryPrice) / actualRisk,
    hasDivergence
  };
}

export function calculateSL(kline: any, history: any[], type: SignalSide, tick: number, pattern: string, atr: number): number {
  const slOffset = atr * 0.15;
  if (pattern.includes(PatternType.PIN_BAR) || pattern.includes(PatternType.HAMMER) || pattern.includes(PatternType.STAR)) {
    return type === SignalSide.LONG
      ? roundToTick(kline.low - slOffset, tick)
      : roundToTick(kline.high + slOffset, tick);
  }
  const candles = history.slice(-3);
  return type === SignalSide.LONG
    ? roundToTick(Math.min(...candles.map(k => k.low), kline.low) - slOffset, tick)
    : roundToTick(Math.max(...candles.map(k => k.high), kline.high) + slOffset, tick);
}
