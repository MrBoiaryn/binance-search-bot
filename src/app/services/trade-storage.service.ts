import { Injectable } from '@angular/core';
import { ScannerSettings } from '../models/models';

@Injectable({ providedIn: 'root' })
export class TradeStorageService {
  private readonly SETTINGS_KEY = 'sniper_pro_settings';
  private readonly HISTORY_KEY = 'trade_history';

  // Збереження налаштувань
  saveSettings(settings: ScannerSettings): void {
    localStorage.setItem(this.SETTINGS_KEY, JSON.stringify(settings));
  }

  // Завантаження налаштувань
  loadSettings(): ScannerSettings | null {
    const data = localStorage.getItem(this.SETTINGS_KEY);
    return data ? JSON.parse(data) : null;
  }

  // Робота з історією (залишаємо як було)
  saveHistory(history: any[]): void {
    localStorage.setItem(this.HISTORY_KEY, JSON.stringify(history));
  }

  loadHistory(): any[] {
    const data = localStorage.getItem(this.HISTORY_KEY);
    return data ? JSON.parse(data) : [];
  }
}