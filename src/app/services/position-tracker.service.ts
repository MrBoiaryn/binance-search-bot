import { Injectable } from '@angular/core';
import { HistoricalLog } from '../models/models';

@Injectable({ providedIn: 'root' })
export class PositionTrackerService {
  private readonly FEE_RATE = 0.001; // 0.1% комісія

  /**
   * Обробка кожного тіка (або закриття свічки) для супроводу відкритих позицій
   * @param kline Поточні дані свічки (high, low, close, symbol, tf)
   * @param history Загальний журнал сигналів
   * @param symbolHistory Історія закритих свічок для розрахунку трейлінгу
   * @param trailingBars Кількість свічок для пошуку екстремуму (з налаштувань)
   * @param tickSize Крок ціни для конкретної монети
   */
  public processTick(
    kline: any,
    history: HistoricalLog[],
    symbolHistory: any[],
    trailingBars: number,
    tickSize: number
  ): boolean {
    let updated = false;

    // Фільтруємо тільки ті записи, які стосуються цієї монети, цього ТФ і ще не закриті
    const activeLogs = history.filter(log =>
      log.symbol === kline.symbol &&
      log.timeframe === kline.tf &&
      (log.status === 'PENDING' || log.status === 'OPENED')
    );

    if (activeLogs.length === 0) return false;

    for (let log of activeLogs) {
      const high = kline.high;
      const low = kline.low;

      // --- 1. ЛОГІКА ТРЕЙЛІНГ-СТОПУ (Тільки для вже відкритих позицій) ---
      if (log.status === 'OPENED' && trailingBars > 0 && symbolHistory.length >= trailingBars) {
        const lastBars = symbolHistory.slice(-trailingBars);

        if (log.type === 'LONG') {
          // Шукаємо найнижчий Low за N свічок
          const minLow = Math.min(...lastBars.map(b => b.low));
          const newSl = minLow - tickSize;

          // Рухаємо стоп тільки вгору, щоб захистити профіт
          if (newSl > log.sl) {
            if (!log.initialSl) log.initialSl = log.sl; // Зберігаємо перший стоп для UI
            log.sl = newSl;
            updated = true;
          }
        }
        else if (log.type === 'SHORT') {
          // Шукаємо найвищий High за N свічок
          const maxHigh = Math.max(...lastBars.map(b => b.high));
          const newSl = maxHigh + tickSize;

          // Рухаємо стоп тільки вниз
          if (newSl < log.sl) {
            if (!log.initialSl) log.initialSl = log.sl;
            log.sl = newSl;
            updated = true;
          }
        }
      }

      // --- 2. ПЕРЕВІРКА СТАТУСІВ (ВХІД / ВИХІД) ---
      if (log.type === 'LONG') {
        // Якщо позиція ще не відкрита (PENDING)
        if (!log.isOpened) {
          if (low <= log.sl) {
            log.status = 'CANCELLED';
            updated = true;
          } else if (high >= log.price) {
            log.isOpened = true;
            log.status = 'OPENED';
            updated = true;
          }
        }
        // Якщо позиція вже в роботі (OPENED)
        else {
          // Перевірка Stop Loss (який міг бути підтягнутий трейлінгом)
          if (low <= log.sl) {
            log.status = 'SL';
            log.pnl = ((log.sl - log.price) / log.price * 100) - (this.FEE_RATE * 100);
            updated = true;
          }
          // Перевірка статичного Take Profit
          else if (high >= log.tp) {
            log.status = 'TP';
            log.pnl = ((log.tp - log.price) / log.price * 100) - (this.FEE_RATE * 100);
            updated = true;
          }
        }
      }
      else if (log.type === 'SHORT') {
        if (!log.isOpened) {
          if (high >= log.sl) {
            log.status = 'CANCELLED';
            updated = true;
          } else if (low <= log.price) {
            log.isOpened = true;
            log.status = 'OPENED';
            updated = true;
          }
        }
        else {
          // Перевірка Stop Loss
          if (high >= log.sl) {
            log.status = 'SL';
            log.pnl = ((log.price - log.sl) / log.price * 100) - (this.FEE_RATE * 100);
            updated = true;
          }
          // Перевірка статичного Take Profit
          else if (low <= log.tp) {
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