import { Component, EventEmitter, Input, Output } from '@angular/core';
import { HistoricalLog } from '../../models/models';
import { DecimalPipe } from '@angular/common';
import { generateBinanceLink } from '../../utils/link-helper';

@Component({
  selector: 'app-history-table',
  standalone: true, // додано для актуальності
  imports: [DecimalPipe],
  templateUrl: './history-table.html',
  styleUrl: './history-table.scss',
})
export class HistoryTable {
  @Input() history: HistoricalLog[] = [];
  @Input() marketType: 'spot' | 'futures' = 'futures';

  // ✅ Приймаємо вже порахований PnL від App
  @Input() totalPnL: number = 0;

  @Input() availableTfs: string[] = [];
  @Input() activeFilter: string = 'ALL';

  @Output() clearHistory = new EventEmitter<void>();
  @Output() filterChanged = new EventEmitter<string>();

  getBinanceLink(log: HistoricalLog): string {
    return generateBinanceLink(
      log.symbol,
      this.marketType,
      log.quoteAsset
    );
  }

  getPercent(price: number, target: number): number {
    if (!price || !target) return 0;
    return (Math.abs(target - price) / price) * 100;
  }
}