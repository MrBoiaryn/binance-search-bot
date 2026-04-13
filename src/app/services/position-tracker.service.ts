import { Injectable } from '@angular/core';
import { HistoricalLog } from '../models/models';

@Injectable({ providedIn: 'root' })
export class PositionTrackerService {
  private readonly FEE_RATE = 0.001;

  public processTick(kline: any, history: HistoricalLog[]): boolean {
    let updated = false;

    // ✅ ДОДАЄМО ФІЛЬТР ЗА ТАЙМФРЕЙМОМ (log.timeframe === kline.timeframe)
    const activeLogs = history.filter(log =>
      log.symbol === kline.symbol &&
      log.timeframe === kline.tf && // Переконайся, що в kline є поле tf
      (log.status === 'PENDING' || log.status === 'OPENED')
    );

    if (activeLogs.length === 0) return false;

    for (let log of activeLogs) {
      const high = kline.high;
      const low = kline.low;

      if (log.type === 'LONG') {
        if (!log.isOpened) {
          if (low <= log.sl) {
            log.status = 'CANCELLED';
            updated = true;
          } else if (high >= log.price) {
            log.isOpened = true;
            log.status = 'OPENED';
            updated = true;
          }
        } else {
          if (low <= log.sl) {
            log.status = 'SL';
            log.pnl = ((log.sl - log.price) / log.price * 100) - (this.FEE_RATE * 100);
            updated = true;
          } else if (high >= log.tp) {
            log.status = 'TP';
            log.pnl = ((log.tp - log.price) / log.price * 100) - (this.FEE_RATE * 100);
            updated = true;
          }
        }
      }
      else if (log.type === 'SHORT') {
        if (!log.isOpened) {
          // ✅ ТУТ БУЛА ПОМИЛКА: Переконайся, що low справді <= входу
          if (high >= log.sl) {
            log.status = 'CANCELLED';
            updated = true;
          } else if (low <= log.price) {
            log.isOpened = true;
            log.status = 'OPENED';
            updated = true;
          }
        } else {
          if (high >= log.sl) {
            log.status = 'SL';
            log.pnl = ((log.price - log.sl) / log.price * 100) - (this.FEE_RATE * 100);
            updated = true;
          } else if (low <= log.tp) {
            log.status = 'TP';
            log.pnl = ((log.price - log.tp) / log.price * 100) - (this.FEE_RATE * 100);
            updated = true;
          }
        }
      }
    }

    return updated;
  }
}