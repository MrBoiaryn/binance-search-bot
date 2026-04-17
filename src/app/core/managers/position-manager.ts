import { HistoricalLog } from '../../models/models';
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

  // Шукаємо активні угоди для поточної монети та ТФ
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

    // --- 1. ЛОГІКА ТРЕЙЛІНГ-СТОПУ ---
    if (log.status === PositionStatus.OPENED && trailingBars > 0 && symbolHistory.length >= trailingBars) {
      const lastBars = symbolHistory.slice(-trailingBars);

      if (log.type === SignalSide.LONG) {
        const minLow = Math.min(...lastBars.map(b => b.low));
        const newSl = minLow - tickSize;

        if (newSl > log.sl) {
          if (!log.initialSl) log.initialSl = log.sl; // Зберігаємо стартовий стоп для UI
          log.sl = newSl;
          updated = true;
        }
      } else if (log.type === SignalSide.SHORT) {
        const maxHigh = Math.max(...lastBars.map(b => b.high));
        const newSl = maxHigh + tickSize;

        if (newSl < log.sl) {
          if (!log.initialSl) log.initialSl = log.sl; // Зберігаємо стартовий стоп для UI
          log.sl = newSl;
          updated = true;
        }
      }
    }

    // --- 2. ЛОГІКА DYNAMIC BREAKEVEN ---
    if (log.useBE && log.status === PositionStatus.OPENED && !log.beTriggered && log.beTriggerPrice) {
      const isBeTriggered = log.type === SignalSide.LONG
        ? high >= log.beTriggerPrice
        : low <= log.beTriggerPrice;

      if (isBeTriggered) {
        if (!log.initialSl) log.initialSl = log.sl;
        
        // Calculate True Breakeven Price
        const trueBePrice = calculateTrueBreakeven(
          log.price,
          log.type as SignalSide,
          log.marketType || marketType,
          tickSize
        );

        // Перевіряємо чи новий стоп кращий за поточний (наприклад, Trailing Stop міг бути вже вище)
        const isBetter = log.type === SignalSide.LONG ? trueBePrice > log.sl : trueBePrice < log.sl;
        if (isBetter) {
          log.sl = trueBePrice;
          updated = true;
        }
        log.beTriggered = true;
        updated = true;
      }
    }

    // --- 3. ПЕРЕВІРКА СТАТУСІВ (Песимістична модель) ---
    if (log.type === SignalSide.LONG) {
      if (!log.isOpened) {
        if (low <= log.sl) {
          log.status = PositionStatus.CANCELLED;
          updated = true;
        } else if (high >= log.price) {
          log.isOpened = true;
          log.status = PositionStatus.OPENED;
          
          if (log.useBE && log.beLevelPct) {
            const distance = Math.abs(log.tp - log.price);
            log.beTriggerPrice = log.price + (distance * (log.beLevelPct / 100));
          }
          
          updated = true;
        }
      } else {
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

          if (log.useBE && log.beLevelPct) {
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
