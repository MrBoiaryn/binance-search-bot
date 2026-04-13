import { Injectable, isDevMode } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, Subject } from 'rxjs';
import { KlineData } from '../models/models';

@Injectable({ providedIn: 'root' })
export class BinanceSocketService {
  private sockets: Map<string, WebSocket> = new Map();

  private readonly IGNORED_COINS = [
    'USDC', 'FDUSD', 'TUSD', 'BUSD', 'USDP', // Інші стейблкоїни
    'EUR', 'AEUR', 'TRY', 'GBP', 'RUB', 'XAU'       // Фіатні валюти
  ];

  constructor(private http: HttpClient) {}

  // Отримання топ-пар для моніторингу
  getTopPairs(market: 'spot' | 'futures'): Observable<string[]> {
    const baseUrl = this.getBaseUrl(market);

    return new Observable(observer => {
      this.http.get<any[]>(`${baseUrl}/ticker/24hr`).subscribe({
        next: (data) => {
          const topPairs = data
            .filter(t => {
              if (!t.symbol.endsWith('USDT')) return false;
              const baseCoin = t.symbol.replace('USDT', '');
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

  // Підключення до WebSocket Binance
  connectKlines(pairs: string[], timeframe: string, market: 'spot' | 'futures'): Observable<KlineData> {
    const socketKey = `${market}_${timeframe}`;
    this.closeSocketByKey(socketKey);

    return new Observable<KlineData>(observer => {
      const baseUrl = market === 'futures' ? 'wss://fstream.binance.com' : 'wss://stream.binance.com:9443';
      let streamsList = pairs.map(p => `${p}@kline_${timeframe}`);
      if (market === 'futures') streamsList.push('!forceOrder@arr');

      const wsUrl = `${baseUrl}/stream?streams=${streamsList.join('/')}`;
      const ws = new WebSocket(wsUrl);
      this.sockets.set(socketKey, ws);

      ws.onmessage = (event) => {
        const parsed = JSON.parse(event.data);
        if (!parsed.data) return;

        if (parsed.data.e === 'kline') {
          const k = parsed.data.k;
          observer.next({
            type: 'kline',
            symbol: parsed.data.s,
            isClosed: k.x,
            open: parseFloat(k.o),
            high: parseFloat(k.h),
            low: parseFloat(k.l),
            close: parseFloat(k.c),
            volume: parseFloat(k.v),
            openTime: k.t // Виправлено: використовуємо openTime
          });
        } else if (parsed.data.e === 'forceOrder') {
          const o = parsed.data.o;
          observer.next({
            type: 'liquidation',
            symbol: o.s,
            side: o.S,
            amount: parseFloat(o.p) * parseFloat(o.q)
          });
        }
      };

      ws.onerror = (err) => observer.error(err);
      
      ws.onclose = (e) => {
        if (e.code !== 1000) {
          console.warn(`[WS ${socketKey}] Closed unexpectedly. Reconnecting...`);
          // В реальному додатку тут краще використовувати логіку реконекту через RxJS (retryWhen)
        }
      };

      // Cleanup при відписці
      return () => {
        this.closeSocketByKey(socketKey);
      };
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

  getKlinesHistory(symbol: string, interval: string, market: 'spot' | 'futures'): Observable<any[]> {
    const baseUrl = this.getBaseUrl(market);
    return this.http.get<any[]>(`${baseUrl}/klines?symbol=${symbol.toUpperCase()}&interval=${interval}&limit=1000`);
  }

  getExchangeInfo(marketType: 'spot' | 'futures'): Observable<any> {
    const baseUrl = this.getBaseUrl(marketType);
    return this.http.get(`${baseUrl}/exchangeInfo`);
  }

  private getBaseUrl(market: 'spot' | 'futures'): string {
    if (isDevMode()) {
      return market === 'futures' ? '/api/binance/futures/fapi/v1' : '/api/binance/spot/api/v3';
    }
    return market === 'futures' ? 'https://fapi.binance.com/fapi/v1' : 'https://api.binance.com/api/v3';
  }
}