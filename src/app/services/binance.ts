import { Injectable, isDevMode } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, Subject } from 'rxjs';
import { KlineData } from '../models/models';

@Injectable({ providedIn: 'root' })
export class BinanceSocketService {
  private ws: WebSocket | null = null;
  private socketSubject = new Subject<KlineData>();

  constructor(private http: HttpClient) {}

  // Отримання топ-пар для моніторингу
  getTopPairs(market: 'spot' | 'futures'): Observable<string[]> {
    const baseUrl = this.getBaseUrl(market);
    return new Observable(observer => {
      this.http.get<any[]>(`${baseUrl}/ticker/24hr`).subscribe(data => {
        const topPairs = data
          .filter(t => t.symbol.endsWith('USDT'))
          .sort((a, b) => parseFloat(b.quoteVolume || b.v) - parseFloat(a.quoteVolume || a.v))
          .slice(0, 100)
          .map(t => t.symbol.toLowerCase());
        observer.next(topPairs);
        observer.complete();
      });
    });
  }

  // Підключення до WebSocket Binance
  connectKlines(pairs: string[], timeframe: string, market: 'spot' | 'futures'): Observable<KlineData> {
    this.closeExistingSocket();

    const baseUrl = market === 'futures' ? 'wss://fstream.binance.com' : 'wss://stream.binance.com:9443';
    let streamsList = pairs.map(p => `${p}@kline_${timeframe}`);
    if (market === 'futures') streamsList.push('!forceOrder@arr');

    const wsUrl = `${baseUrl}/stream?streams=${streamsList.join('/')}`;
    this.ws = new WebSocket(wsUrl);

    this.ws.onmessage = (event) => {
      const parsed = JSON.parse(event.data);
      if (!parsed.data) return;

      if (parsed.data.e === 'kline') {
        const k = parsed.data.k;
        this.socketSubject.next({
          type: 'kline', symbol: parsed.data.s, isClosed: k.x,
          open: parseFloat(k.o), high: parseFloat(k.h), low: parseFloat(k.l), close: parseFloat(k.c),
          volume: parseFloat(k.v), startTime: k.t
        });
      } else if (parsed.data.e === 'forceOrder') {
        const o = parsed.data.o;
        this.socketSubject.next({
          type: 'liquidation', symbol: o.s, side: o.S,
          amount: parseFloat(o.p) * parseFloat(o.q)
        });
      }
    };

    this.ws.onclose = (e) => {
      if (e.code !== 1000) setTimeout(() => this.reconnect(market, timeframe, pairs), 5000);
    };

    return this.socketSubject.asObservable();
  }

  private closeExistingSocket() {
    if (this.ws) {
      this.ws.onmessage = this.ws.onerror = this.ws.onclose = null;
      this.ws.close(1000);
      this.ws = null;
    }
  }

  getKlinesHistory(symbol: string, interval: string, market: 'spot' | 'futures'): Observable<any[]> {
    const baseUrl = this.getBaseUrl(market);
    return this.http.get<any[]>(`${baseUrl}/klines?symbol=${symbol.toUpperCase()}&interval=${interval}&limit=1000`);
  }

  private reconnect(market: 'spot' | 'futures', timeframe: string, pairs: string[]) {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) return;
    this.connectKlines(pairs, timeframe, market);
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