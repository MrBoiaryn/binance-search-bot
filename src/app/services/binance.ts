import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, Subject } from 'rxjs';

export interface KlineData {
  type: 'kline' | 'liquidation';
  symbol: string;
  isClosed?: boolean;
  open?: number;
  high?: number;
  low?: number;
  close?: number;
  volume?: number;
  startTime?: number;
  side?: string; // для ліквідацій
  amount?: number; // для ліквідацій
}

@Injectable({ providedIn: 'root' })
export class BinanceSocketService {
  private ws: WebSocket | null = null;
  private socketSubject = new Subject<KlineData>();

  constructor(private http: HttpClient) {}

  getTopPairs(): Observable<string[]> {
    return new Observable(observer => {
      this.http.get<any[]>('/api/binance/fapi/v1/ticker/24hr').subscribe(data => {
        const topPairs = data
          .filter(t => t.symbol.endsWith('USDT'))
          .sort((a, b) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume))
          .slice(0, 50)
          .map(t => t.symbol.toLowerCase());
        observer.next(topPairs);
        observer.complete();
      });
    });
  }

  connectKlines(pairs: string[]): Observable<KlineData> {
    if (this.ws) this.ws.close();

    // Підписуємось на свічки ТА на глобальний потік ліквідацій (!forceOrder@arr)
    const streams = [...pairs.map(p => `${p}@kline_1m`), '!forceOrder@arr'].join('/');
    const wsUrl = `wss://fstream.binance.com/stream?streams=${streams}`;

    this.ws = new WebSocket(wsUrl);
    this.ws.onmessage = (event) => {
      const parsed = JSON.parse(event.data);

      // Обробка свічки
      if (parsed.data && parsed.data.e === 'kline') {
        const kline = parsed.data.k;
        this.socketSubject.next({
          type: 'kline',
          symbol: parsed.data.s,
          isClosed: kline.x,
          open: parseFloat(kline.o),
          high: parseFloat(kline.h),
          low: parseFloat(kline.l),
          close: parseFloat(kline.c),
          volume: parseFloat(kline.v),
          startTime: kline.t
        });
      }
      // Обробка ліквідацій
      else if (parsed.data && parsed.data.e === 'forceOrder') {
        const o = parsed.data.o;
        this.socketSubject.next({
          type: 'liquidation',
          symbol: o.s,
          side: o.S,
          amount: parseFloat(o.p) * parseFloat(o.q)
        });
      }
    };
    return this.socketSubject.asObservable();
  }

  getKlinesHistory(symbol: string, interval: string = '1m', limit: number = 250): Observable<any[]> {
    const url = `/api/binance/fapi/v1/klines?symbol=${symbol.toUpperCase()}&interval=${interval}&limit=${limit}`;
    return this.http.get<any[]>(url);
  }
}