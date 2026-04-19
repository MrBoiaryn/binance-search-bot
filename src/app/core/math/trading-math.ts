import { MarketType, SignalSide } from '../constants/trade-enums';
import { getMarketFee } from '../constants/trading-constants';

/**
 * Calculates the True Breakeven price accounting for entry and exit fees.
 * 
 * For LONG: BE_Price = Entry_Price * (1 + (FEE * 2))
 * For SHORT: BE_Price = Entry_Price * (1 - (FEE * 2))
 */
export function calculateTrueBreakeven(
  entryPrice: number,
  side: SignalSide,
  marketType: MarketType,
  tickSize: number
): number {
  const fee = getMarketFee(marketType);
  const feeFactor = fee * 2;
  
  let bePrice: number;
  if (side === SignalSide.LONG) {
    bePrice = entryPrice * (1 + feeFactor);
  } else {
    bePrice = entryPrice * (1 - feeFactor);
  }

  // Round to tick size precision
  return roundToTickSize(bePrice, tickSize);
}

/**
 * Rounds a price to the nearest tick size.
 */
export function roundToTickSize(price: number, tickSize: number): number {
  const precision = Math.log10(1 / tickSize);
  return parseFloat(price.toFixed(precision));
}

export function getAggregationRatio(tf: string): number {
  switch (tf) {
    case '1m': return 5;
    case '5m': return 6;
    case '15m': return 4;
    case '1h': return 4;
    default: return 1;
  }
}

export function aggregateCandles(ltfHistory: any[], ratio: number): any[] {
  if (ratio <= 1 || ltfHistory.length < ratio) return ltfHistory;

  const htfHistory: any[] = [];
  const ltfMs = (ltfHistory[1]?.openTime || 0) - (ltfHistory[0]?.openTime || 0);
  if (!ltfMs) return ltfHistory;
  
  const htfMs = ltfMs * ratio;

  // Group by time-alignment
  const groups = new Map<number, any[]>();
  
  ltfHistory.forEach(candle => {
    const htfOpenTime = Math.floor(candle.openTime / htfMs) * htfMs;
    if (!groups.has(htfOpenTime)) groups.set(htfOpenTime, []);
    groups.get(htfOpenTime)!.push(candle);
  });

  const sortedKeys = Array.from(groups.keys()).sort((a, b) => a - b);

  sortedKeys.forEach(time => {
    const candles = groups.get(time)!;
    if (candles.length === 0) return;

    htfHistory.push({
      openTime: time,
      open: candles[0].open,
      close: candles[candles.length - 1].close,
      high: Math.max(...candles.map(c => c.high)),
      low: Math.min(...candles.map(c => c.low)),
      volume: candles.reduce((sum, c) => sum + (c.volume || 0), 0),
      isClosed: candles.length === ratio || (candles[candles.length - 1].isClosed)
    });
  });

  return htfHistory;
}
