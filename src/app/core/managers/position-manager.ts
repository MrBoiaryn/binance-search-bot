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
    const open = kline.open;
    const currentPrice = kline.close;
    const feeRate = getMarketFee(log.marketType || marketType);

    // TASK 4.1: Gap Protection
    if (log.status === PositionStatus.OPENED) {
       const isGapSl = log.type === SignalSide.LONG ? open <= log.sl : open >= log.sl;
       if (isGapSl) {
          log.status = PositionStatus.SL;
          log.pnl = calculatePnLWithGrid(log, open, feeRate);
          updated = true;
          continue; 
       }
    }

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
        const maxHigh = maxHighVal(lastBars);
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

    // --- 3. ПЕРЕВІРКА СТАТУСІВ ТА GRID ---
    if (log.type === SignalSide.LONG) {
      if (!log.isOpened) {
        if (low <= log.sl) {
          log.status = PositionStatus.CANCELLED;
          updated = true;
        } else if (high >= log.price) {
          log.isOpened = true;
          log.status = PositionStatus.OPENED;
          
          // Calculate levels prices for grid
          if (log.tpGrid && log.tpGrid.length > 0) {
            const distance = Math.abs(log.tp - log.price);
            log.tpGrid.forEach(level => {
              (level as any).price = log.price + (distance * (level.movePercent / 100));
            });
            
            const beLevel = (log.tpGrid as TPGridLevel[]).find((l: TPGridLevel) => l.triggerBE);
            if (beLevel) {
              log.beTriggerPrice = (beLevel as any).price;
            }
          } else if (log.beLevelPct) { // Fallback for old logs
            const distance = Math.abs(log.tp - log.price);
            log.beTriggerPrice = log.price + (distance * (log.beLevelPct / 100));
          }
          
          updated = true;
        }
      } else {
        // Handle TP Grid
        if (log.tpGrid && log.tpGrid.length > 0) {
          log.tpGrid.forEach(level => {
            if (!level.isHit && high >= (level as any).price) {
              level.isHit = true;
              updated = true;
            }
          });
        }

        // TASK 4.2: Conflict Resolution (Same-Candle SL/TP)
        if (low <= log.sl && high >= log.tp && !log.isRunner) {
           log.status = PositionStatus.SL;
           log.pnl = calculatePnLWithGrid(log, log.sl, feeRate);
           (log as any).uncertainExit = true;
           updated = true;
        } else if (low <= log.sl) {
          log.status = PositionStatus.SL;
          log.pnl = calculatePnLWithGrid(log, log.sl, feeRate);
          updated = true;
        } else if (high >= log.tp && !log.isRunner) {
          log.status = PositionStatus.TP;
          log.pnl = calculatePnLWithGrid(log, log.tp, feeRate);
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

          // Calculate levels prices for grid
          if (log.tpGrid && log.tpGrid.length > 0) {
            const distance = Math.abs(log.tp - log.price);
            log.tpGrid.forEach(level => {
              (level as any).price = log.price - (distance * (level.movePercent / 100));
            });

            const beLevel = (log.tpGrid as TPGridLevel[]).find((l: TPGridLevel) => l.triggerBE);
            if (beLevel) {
              log.beTriggerPrice = (beLevel as any).price;
            }
          } else if (log.beLevelPct) { // Fallback for old logs
            const distance = Math.abs(log.tp - log.price);
            log.beTriggerPrice = log.price - (distance * (log.beLevelPct / 100));
          }

          updated = true;
        }
      } else {
        // Handle TP Grid
        if (log.tpGrid && log.tpGrid.length > 0) {
          log.tpGrid.forEach(level => {
            if (!level.isHit && low <= (level as any).price) {
              level.isHit = true;
              updated = true;
            }
          });
        }

        // TASK 4.2: Conflict Resolution (Same-Candle SL/TP)
        if (high >= log.sl && low <= log.tp && !log.isRunner) {
           log.status = PositionStatus.SL;
           log.pnl = calculatePnLWithGrid(log, log.sl, feeRate);
           (log as any).uncertainExit = true;
           updated = true;
        } else if (high >= log.sl) {
          log.status = PositionStatus.SL;
          log.pnl = calculatePnLWithGrid(log, log.sl, feeRate);
          updated = true;
        } else if (low <= log.tp && !log.isRunner) {
          log.status = PositionStatus.TP;
          log.pnl = calculatePnLWithGrid(log, log.tp, feeRate);
          updated = true;
        }
      }
    }
  }

  return updated;
}

function maxHighVal(lastBars: any[]): number {
  return Math.max(...lastBars.map(b => b.high));
}

function calculatePnLWithGrid(log: HistoricalLog, exitPrice: number, feeRate: number): number {
  if (!log.tpGrid || log.tpGrid.length === 0) {
    const rawPnL = log.type === SignalSide.LONG
      ? (exitPrice - log.price) / log.price
      : (log.price - exitPrice) / log.price;
    return (rawPnL - feeRate * 2) * 100;
  }

  let totalPnL = 0;
  let closedVolume = 0;

  log.tpGrid.forEach(level => {
    if (level.isHit) {
      const levelPrice = (level as any).price || log.tp;
      const levelPnL = log.type === SignalSide.LONG
        ? (levelPrice - log.price) / log.price
        : (log.price - levelPrice) / log.price;
      
      const volShare = level.volumePercent / 100;
      totalPnL += (levelPnL - feeRate * 2) * volShare;
      closedVolume += level.volumePercent;
    }
  });

  if (closedVolume < 100) {
    const remainingVolShare = (100 - closedVolume) / 100;
    const remainingPnL = log.type === SignalSide.LONG
      ? (exitPrice - log.price) / log.price
      : (log.price - exitPrice) / log.price;
    
    totalPnL += (remainingPnL - feeRate * 2) * remainingVolShare;
  }

  return totalPnL * 100;
}
