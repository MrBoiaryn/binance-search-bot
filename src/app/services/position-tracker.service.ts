import { Injectable } from '@angular/core';
import { HistoricalLog } from '../models/models';

@Injectable({ providedIn: 'root' })
export class PositionTrackerService {
  // Комісія: 0.05% Taker (вхід) + 0.05% Taker (вихід) = 0.1% (або 0.001 у десяткових)
  private readonly FEE_RATE = 0.001;

  /**
   * Обробляє кожен тік ціни та оновлює статуси позицій в історії.
   * Повертає true, якщо хоча б одна позиція змінила статус (щоб оновити UI).
   */
  public processTick(kline: any, history: HistoricalLog[]): boolean {
    let updated = false;

    for (let log of history) {
      // Ігноруємо старі логі з LocalStorage, якщо в них ще немає статусу
      if (!log.status) {
        log.status = 'PENDING';
        log.isOpened = false;
      }

      // Нас цікавлять тільки активні угоди по поточній монеті
      if (log.symbol !== kline.symbol || (log.status !== 'PENDING' && log.status !== 'OPENED')) {
        continue;
      }

      const price = kline.close;

      if (log.type === 'LONG') {
        if (!log.isOpened) {
          // ЧЕКАЄМО ВХОДУ В LONG
          if (price <= log.sl) {
            log.status = 'CANCELLED'; // Не відкрилась (впала до стопа раніше входу)
            updated = true;
          } else if (price >= log.price) {
            log.isOpened = true;      // Ціна пробила екстремум - ми в позиції!
            log.status = 'OPENED';
            updated = true;
          }
        } else {
          // ВЖЕ У LONG ПОЗИЦІЇ
          if (price >= log.tp) {
            log.status = 'TP';
            log.pnl = ((log.tp - log.price) / log.price * 100) - (this.FEE_RATE * 100);
            updated = true;
          } else if (price <= log.sl) {
            log.status = 'SL';
            log.pnl = ((log.sl - log.price) / log.price * 100) - (this.FEE_RATE * 100);
            updated = true;
          }
        }
      }

      else if (log.type === 'SHORT') {
        if (!log.isOpened) {
          // ЧЕКАЄМО ВХОДУ В SHORT
          if (price >= log.sl) {
            log.status = 'CANCELLED'; // Пішла вгору, збила уявний стоп до входу
            updated = true;
          } else if (price <= log.price) {
            log.isOpened = true;
            log.status = 'OPENED';
            updated = true;
          }
        } else {
          // ВЖЕ У SHORT ПОЗИЦІЇ
          if (price <= log.tp) {
            log.status = 'TP';
            log.pnl = ((log.price - log.tp) / log.price * 100) - (this.FEE_RATE * 100);
            updated = true;
          } else if (price >= log.sl) {
            log.status = 'SL';
            log.pnl = ((log.price - log.sl) / log.price * 100) - (this.FEE_RATE * 100);
            updated = true;
          }
        }
      }
    }

    return updated; // Якщо true - App компонент має зберегти Storage і оновити HTML
  }
}