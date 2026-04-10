import { Injectable, isDevMode } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, Subject } from 'rxjs';
import { KlineData } from '../models/models';

@Injectable({ providedIn: 'root' })
export class BinanceSocketService {
  private ws: WebSocket | null = null;
  private socketSubject = new Subject<KlineData>();
  private activeStreams: string = '';

  constructor(private http: HttpClient) {}

  getTopPairs(market: 'spot' | 'futures'): Observable<string[]> {
    const baseUrl = this.getBaseUrl(market);
    const endpoint = `${baseUrl}/ticker/24hr`;

    return new Observable(observer => {
      this.http.get<any[]>(endpoint).subscribe(data => {
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
  connectKlines(pairs: string[], timeframe: string, market: 'spot' | 'futures'): Observable<KlineData> {
    // 1. Очищуємо старий сокет правильно
    this.closeExistingSocket();

    const baseUrl = market === 'futures' ? 'wss://fstream.binance.com' : 'wss://stream.binance.com:9443';
    let streamsList = pairs.map(p => `${p}@kline_${timeframe}`);
    if (market === 'futures') streamsList.push('!forceOrder@arr');

    this.activeStreams = streamsList.join('/');
    const wsUrl = `${baseUrl}/stream?streams=${this.activeStreams}`;

    console.log(`📡 Спроба підключення до ${market} сокету...`);
    this.ws = new WebSocket(wsUrl);

    this.ws.onmessage = (event) => {
      try {
        const parsed = JSON.parse(event.data);
        if (!parsed.data) return;

        if (parsed.data.e === 'kline') {
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
        } else if (parsed.data.e === 'forceOrder') {
          const o = parsed.data.o;
          this.socketSubject.next({
            type: 'liquidation',
            symbol: o.s,
            side: o.S,
            amount: parseFloat(o.p) * parseFloat(o.q)
          });
        }
      } catch (e) {
        console.error("❌ Помилка парсингу сокета:", e);
      }
    };

    this.ws.onerror = (err) => {
      console.error("🚨 WebSocket Error:", err);
    };

    this.ws.onclose = (e) => {
      console.warn(`🔌 Сокет закрито (Код: ${e.code}). Реконнект через 5 сек...`);
      // Не робимо реконнект, якщо ми самі його закрили (код 1000)
      if (e.code !== 1000) {
        setTimeout(() => this.reconnect(market, timeframe, pairs), 5000);
      }
    };

    return this.socketSubject.asObservable();
  }

  private closeExistingSocket() {
    if (this.ws) {
      console.log("🧹 Очищення старого з'єднання...");
      this.ws.onmessage = null;
      this.ws.onerror = null;
      this.ws.onclose = null;
      // Використовуємо код 1000 (нормальне закриття)
      this.ws.close(1000);
      this.ws = null;
    }
  }

  getKlinesHistory(symbol: string, interval: string, market: 'spot' | 'futures'): Observable<any[]> {
    const baseUrl = this.getBaseUrl(market);
    return this.http.get<any[]>(`${baseUrl}/klines?symbol=${symbol.toUpperCase()}&interval=${interval}&limit=250`);
  }

  private reconnect(market: 'spot' | 'futures', timeframe: string, pairs: string[]) {
    // Перевіряємо, чи сокет вже випадково не відкритий, щоб не плодити дублі
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    console.log("🔄 Спроба автоматичного відновлення зв'язку...");
    this.connectKlines(pairs, timeframe, market);
  }

  getExchangeInfo(marketType: 'spot' | 'futures'): Observable<any> {
    const baseUrl = this.getBaseUrl(marketType);
    return this.http.get(`${baseUrl}/exchangeInfo`);
  }

  private getBaseUrl(market: 'spot' | 'futures'): string {
    if (isDevMode()) {
      // Твій локальний проксі
      return market === 'futures'
        ? '/api/binance/futures/fapi/v1'
        : '/api/binance/spot/api/v3';
    } else {
      // Прямі посилання для GitHub Pages / Vercel
      return market === 'futures'
        ? 'https://fapi.binance.com/fapi/v1'
        : 'https://api.binance.com/api/v3';
    }
  }
}