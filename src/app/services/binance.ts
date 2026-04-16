import { Injectable, isDevMode } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { KlineData } from '../models/models';
import { BinanceEventType, MarketType } from '../core/constants/trade-enums';

@Injectable({ providedIn: 'root' })
export class BinanceSocketService {
  private sockets: Map<string, WebSocket> = new Map();

  // Виносимо константи, щоб не було хардкоду в методах
  private readonly QUOTE_ASSET = 'USDT';
  private readonly IGNORED_COINS = [
    'USDC', 'FDUSD', 'TUSD', 'BUSD', 'USDP',
    'EUR', 'AEUR', 'TRY', 'GBP', 'RUB', 'XAU'
  ];

  constructor(private http: HttpClient) {}

  /**
   * Отримання топ-пар за об'ємом
   */
  getTopPairs(market: MarketType): Observable<string[]> {
    const baseUrl = this.getBaseUrl(market);

    return new Observable(observer => {
      this.http.get<any[]>(`${baseUrl}/ticker/24hr`).subscribe({
        next: (data) => {
          const topPairs = data
            .filter(t => {
              if (!t.symbol.endsWith(this.QUOTE_ASSET)) return false;
              const baseCoin = t.symbol.replace(this.QUOTE_ASSET, '');
              if (this.IGNORED_COINS.includes(baseCoin)) return false;
              return true;
            })
            .sort((a, b) => parseFloat(b.quoteVolume || b.v) - parseFloat(a.quoteVolume || a.v))
            .slice(0, 100)
            .map(t => t.symbol.toLowerCase());

          observer.next(topPairs);
          observer.complete();
        },
        error: (err) => observer.error(err)
      });
    });
  }

  /**
   * Підключення до WebSocket
   */
  connectKlines(pairs: string[], timeframe: string, market: MarketType): Observable<KlineData> {
    const socketKey = `${market}_${timeframe}`;
    this.closeSocketByKey(socketKey);

    return new Observable<KlineData>(observer => {
      const isFutures = market === MarketType.FUTURES;
      const baseUrl = isFutures ? 'wss://fstream.binance.com' : 'wss://stream.binance.com:9443';

      let streamsList = pairs.map(p => `${p}@kline_${timeframe}`);

      // Додаємо потік ліквідацій тільки для ф'ючерсів
      if (isFutures) {
        streamsList.push('!forceOrder@arr');
      }

      const wsUrl = `${baseUrl}/stream?streams=${streamsList.join('/')}`;
      const ws = new WebSocket(wsUrl);
      this.sockets.set(socketKey, ws);

      ws.onmessage = (event) => {
        const parsed = JSON.parse(event.data);
        if (!parsed.data) return;

        // Використовуємо BinanceEventType для ідентифікації подій
        const eventType = parsed.data.e;

        if (eventType === BinanceEventType.KLINE) {
          const k = parsed.data.k;
          observer.next({
            type: BinanceEventType.KLINE,
            symbol: parsed.data.s,
            isClosed: k.x,
            open: parseFloat(k.o),
            high: parseFloat(k.h),
            low: parseFloat(k.l),
            close: parseFloat(k.c),
            volume: parseFloat(k.v),
            openTime: k.t
          });
        } else if (eventType === BinanceEventType.FORCE_ORDER) {
          const o = parsed.data.o;
          observer.next({
            type: BinanceEventType.LIQUIDATION,
            symbol: o.s,
            side: o.S,
            amount: parseFloat(o.p) * parseFloat(o.q)
          });
        }
      };

      ws.onerror = (err) => observer.error(err);

      ws.onclose = (e) => {
        if (e.code !== 1000) {
          console.warn(`[WS ${socketKey}] Closed with code ${e.code}. Reconnecting logic could be here.`);
        }
      };

      return () => this.closeSocketByKey(socketKey);
    });
  }

  private closeSocketByKey(key: string) {
    const ws = this.sockets.get(key);
    if (ws) {
      ws.onmessage = ws.onerror = ws.onclose = null;
      ws.close(1000);
      this.sockets.delete(key);
    }
  }

  getKlinesHistory(symbol: string, interval: string, market: MarketType): Observable<any[]> {
    const baseUrl = this.getBaseUrl(market);
    return this.http.get<any[]>(`${baseUrl}/klines?symbol=${symbol.toUpperCase()}&interval=${interval}&limit=1000`);
  }

  getExchangeInfo(market: MarketType): Observable<any> {
    const baseUrl = this.getBaseUrl(market);
    return this.http.get(`${baseUrl}/exchangeInfo`);
  }

  private getBaseUrl(market: MarketType): string {
    const isFutures = market === MarketType.FUTURES;

    if (isDevMode()) {
      // Проксі-шляхи для розробки
      return isFutures ? '/api/binance/futures/fapi/v1' : '/api/binance/spot/api/v3';
    }

    // Прямі шляхи для продакшну
    return isFutures ? 'https://fapi.binance.com/fapi/v1' : 'https://api.binance.com/api/v3';
  }
}