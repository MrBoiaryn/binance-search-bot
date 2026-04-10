import { Injectable } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class TradeStorageService {
  private HISTORY_KEY = 'sniper_trade_history';
  private POSITIONS_KEY = 'sniper_open_positions';

  saveHistory(history: any[]) {
    // localStorage.setItem(this.HISTORY_KEY, JSON.stringify(history));
  }

  loadHistory(): any[] {
    // const data = localStorage.getItem(this.HISTORY_KEY);
    // return data ? JSON.parse(data) : [];
    return []
  }

  saveOpenPositions(positions: any[]) {
    // localStorage.setItem(this.POSITIONS_KEY, JSON.stringify(positions));
  }

  loadOpenPositions(): any[] {
    // const data = localStorage.getItem(this.POSITIONS_KEY);
    // return data ? JSON.parse(data) : [];
    return []
  }
}