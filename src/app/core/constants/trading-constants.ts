import { MarketType } from './trade-enums';

export const FEE_SPOT = 0.001; // 0.1% maker/taker fee
export const FEE_FUTURES = 0.0005; // 0.05% taker fee

export const getMarketFee = (marketType: MarketType): number => {
  if (marketType === MarketType.SPOT) {
    return FEE_SPOT;
  }

  return FEE_FUTURES;
};
