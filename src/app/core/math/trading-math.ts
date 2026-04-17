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
