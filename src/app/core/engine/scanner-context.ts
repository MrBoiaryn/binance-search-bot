import { PatternContext, ScannerSettings } from '../../models/models';
import { calculateAOForTick, calculateATR } from '../math/indicators';
import { SignalSide } from '../constants/trade-enums';

export function createPatternContext(kline: any, history: any[], settings: ScannerSettings): PatternContext {
  const lookback = settings.swingPeriod || 10;
  const lastN = history.slice(-lookback);
  const lastCandle = history[history.length - 1];

  const historyExclLast = history.slice(0, -1);
  const lastNExclLast = historyExclLast.slice(-lookback);

  const currentAO = calculateAOForTick(history, kline);
  const atr = calculateATR(history, 14);

  return {
    kline, lastCandle, history, atr,
    avgBody: history.slice(-10).reduce((acc, k) => acc + Math.abs(k.close - k.open), 0) / 10,
    isLocalBottom: kline.low! <= Math.min(...lastN.map(k => k.low)),
    isLocalPeak: kline.high! >= Math.max(...lastN.map(k => k.high)),
    isMotherBarBottom: lastCandle && lastCandle.low <= Math.min(...lastNExclLast.map(k => k.low)),
    isMotherBarPeak: lastCandle && lastCandle.high >= Math.max(...lastNExclLast.map(k => k.high)),
    hasDivergence: checkAODivergence(history, (kline.close > kline.open ? SignalSide.LONG : SignalSide.SHORT), currentAO)
  };
}

export function checkAODivergence(history: any[], type: SignalSide, currentAO: number): boolean {
  const len = history.length;
  if (len < 50) return false;
  const getAO = (i: number) => history[i]?.ao || 0;

  if (type === SignalSide.LONG) {
    if (currentAO >= 0) return false;
    let recM = Infinity, recAO = Infinity, i = len - 1;
    for (; i >= len - 20; i--) {
      if (history[i].low < recM) recM = history[i].low;
      if (getAO(i) < recAO) recAO = getAO(i);
      if (getAO(i) > 0) break;
    }
    let pastM = Infinity, pastAO = Infinity;
    for (; i >= len - 50; i--) {
      if (history[i].low < pastM) pastM = history[i].low;
      if (getAO(i) < pastAO) pastAO = getAO(i);
    }
    return (recM < pastM) && (recAO > pastAO);
  } else {
    if (currentAO <= 0) return false;
    let recM = -Infinity, recAO = -Infinity, i = len - 1;
    for (; i >= len - 20; i--) {
      if (history[i].high > recM) recM = history[i].high;
      if (getAO(i) > recAO) recAO = getAO(i);
      if (getAO(i) < 0) break;
    }
    let pastM = -Infinity, pastAO = -Infinity;
    for (; i >= len - 50; i--) {
      if (history[i].high > pastM) pastM = history[i].high;
      if (getAO(i) > pastAO) pastAO = getAO(i);
    }
    return (recM > pastM) && (recAO < pastAO);
  }
}
