import { HistoricalLog } from '../../models/models';
import { PositionStatus, SignalSide } from '../constants/trade-enums';

const FEE_RATE = 0.001;

export function processTick(
  kline: any,
  history: HistoricalLog[],
  symbolHistory: any[],
  trailingBars: number,
  tickSize: number
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

    // --- 2. ПЕРЕВІРКА СТАТУСІВ (Песимістична модель) ---
    if (log.type === SignalSide.LONG) {
      if (!log.isOpened) {
        // Якщо ціна спочатку впала нижче SL, а потім виросла до входу в межах однієї свічки
        // (Песимістичний сценарій: вважаємо що SL був першим)
        if (low <= log.sl) {
          log.status = PositionStatus.CANCELLED;
          updated = true;
        } else if (high >= log.price) {
          log.isOpened = true;
          log.status = PositionStatus.OPENED;
          updated = true;
        }
      } else {
        // Пріоритет SL над TP в межах однієї свічки для безпечної статистики
        if (low <= log.sl) {
          log.status = PositionStatus.SL;
          log.pnl = ((log.sl - log.price) / log.price * 100) - (FEE_RATE * 100);
          updated = true;
        } else if (high >= log.tp) {
          log.status = PositionStatus.TP;
          log.pnl = ((log.tp - log.price) / log.price * 100) - (FEE_RATE * 100);
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
          updated = true;
        }
      } else {
        // Пріоритет SL над TP
        if (high >= log.sl) {
          log.status = PositionStatus.SL;
          log.pnl = ((log.price - log.sl) / log.price * 100) - (FEE_RATE * 100);
          updated = true;
        } else if (low <= log.tp) {
          log.status = PositionStatus.TP;
          log.pnl = ((log.price - log.tp) / log.price * 100) - (FEE_RATE * 100);
          updated = true;
        }
      }
    }
  }

  return updated;
}
