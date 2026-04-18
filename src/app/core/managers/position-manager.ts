import { HistoricalLog, TPGridLevel } from '../../models/models';
import { MarketType, PositionStatus, SignalSide } from '../constants/trade-enums';
import { getMarketFee } from '../constants/trading-constants';
import { calculateTrueBreakeven } from '../math/trading-math';

export function processTick(
  kline: any,
  history: HistoricalLog[],
  symbolHistory: any[],
  trailingBars: number,
  tickSize: number,
  marketType: MarketType = MarketType.FUTURES
): boolean {
  let updated = false;

  const activeLogs = history.filter(log =>
    log.symbol === kline.symbol &&
    log.timeframe === kline.tf &&
    (log.status === PositionStatus.PENDING || log.status === PositionStatus.OPENED)
  );

  if (activeLogs.length === 0) return false;

  for (let log of activeLogs) {
    const high = kline.high;
    const low = kline.low;
    const currentPrice = kline.close;
    const feeRate = getMarketFee(log.marketType || marketType);

    // --- 1. ТРЕЙЛІНГ-СТОПУ ---
    if (log.status === PositionStatus.OPENED && trailingBars > 0 && symbolHistory.length >= trailingBars) {
      const lastBars = symbolHistory.slice(-trailingBars);

      if (log.type === SignalSide.LONG) {
        const minLow = Math.min(...lastBars.map(b => b.low));
        const newSl = minLow - tickSize;
        if (newSl > log.sl) {
          if (!log.initialSl) log.initialSl = log.sl;
          log.sl = newSl;
          updated = true;
        }
      } else if (log.type === SignalSide.SHORT) {
        const maxHigh = Math.max(...lastBars.map(b => b.high));
        const newSl = maxHigh + tickSize;
        if (newSl < log.sl) {
          if (!log.initialSl) log.initialSl = log.sl;
          log.sl = newSl;
          updated = true;
        }
      }
    }

    // --- 2. DYNAMIC BREAKEVEN (from TP Grid) ---
    if (log.status === PositionStatus.OPENED && !log.beTriggered && log.beTriggerPrice) {
      const isBeTriggered = log.type === SignalSide.LONG
        ? high >= log.beTriggerPrice
        : low <= log.beTriggerPrice;

      if (isBeTriggered) {
        if (!log.initialSl) log.initialSl = log.sl;
        
        const trueBePrice = calculateTrueBreakeven(
          log.price,
          log.type as SignalSide,
          log.marketType || marketType,
          tickSize
        );

        const isBetter = log.type === SignalSide.LONG ? trueBePrice > log.sl : trueBePrice < log.sl;
        if (isBetter) {
          log.sl = trueBePrice;
          updated = true;
        }
        log.beTriggered = true;
        updated = true;
      }
    }

    // --- 3. ПЕРЕВІРКА СТАТУСІВ ---
    if (log.type === SignalSide.LONG) {
      if (!log.isOpened) {
        if (low <= log.sl) {
          log.status = PositionStatus.CANCELLED;
          updated = true;
        } else if (high >= log.price) {
          log.isOpened = true;
          log.status = PositionStatus.OPENED;
          
          // Calculate BE trigger price from Grid
          if (log.tpGrid && log.tpGrid.length > 0) {
            const beLevel = (log.tpGrid as TPGridLevel[]).find((l: TPGridLevel) => l.triggerBE);
            if (beLevel) {
              const distance = Math.abs(log.tp - log.price);
              log.beTriggerPrice = log.price + (distance * (beLevel.movePercent / 100));
            }
          } else if (log.beLevelPct) { // Fallback for old logs
            const distance = Math.abs(log.tp - log.price);
            log.beTriggerPrice = log.price + (distance * (log.beLevelPct / 100));
          }
          
          updated = true;
        }
      } else {
        // Multi-TP logic could go here
        if (low <= log.sl) {
          log.status = PositionStatus.SL;
          log.pnl = ((log.sl - log.price) / log.price * 100) - (feeRate * 2 * 100);
          updated = true;
        } else if (high >= log.tp) {
          log.status = PositionStatus.TP;
          log.pnl = ((log.tp - log.price) / log.price * 100) - (feeRate * 2 * 100);
          updated = true;
        }
      }
    } else if (log.type === SignalSide.SHORT) {
      if (!log.isOpened) {
        if (high >= log.sl) {
          log.status = PositionStatus.CANCELLED;
          updated = true;
        } else if (low <= log.price) {
          log.isOpened = true;
          log.status = PositionStatus.OPENED;

          // Calculate BE trigger price from Grid
          if (log.tpGrid && log.tpGrid.length > 0) {
            const beLevel = (log.tpGrid as TPGridLevel[]).find((l: TPGridLevel) => l.triggerBE);
            if (beLevel) {
              const distance = Math.abs(log.tp - log.price);
              log.beTriggerPrice = log.price - (distance * (beLevel.movePercent / 100));
            }
          } else if (log.beLevelPct) { // Fallback for old logs
            const distance = Math.abs(log.tp - log.price);
            log.beTriggerPrice = log.price - (distance * (log.beLevelPct / 100));
          }

          updated = true;
        }
      } else {
        if (high >= log.sl) {
          log.status = PositionStatus.SL;
          log.pnl = ((log.price - log.sl) / log.price * 100) - (feeRate * 2 * 100);
          updated = true;
        } else if (low <= log.tp) {
          log.status = PositionStatus.TP;
          log.pnl = ((log.price - log.tp) / log.price * 100) - (feeRate * 2 * 100);
          updated = true;
        }
      }
    }
  }

  return updated;
}
