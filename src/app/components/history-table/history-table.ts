import { Component, EventEmitter, Input, Output } from '@angular/core';
import { HistoricalLog, TradeSignal } from '../../models/models';
import { DecimalPipe } from '@angular/common';
import { generateBinanceLink } from '../utils/link-helper';

@Component({
  selector: 'app-history-table',
  imports: [
    DecimalPipe
  ],
  templateUrl: './history-table.html',
  styleUrl: './history-table.scss',
})
export class HistoryTable {
  @Input() history: HistoricalLog[] = [];
  @Input() marketType: 'spot' | 'futures' = 'futures';

  @Output() clearHistory = new EventEmitter<void>();

  getBinanceLink(log: HistoricalLog): string {
    return generateBinanceLink(
      log.symbol,
      this.marketType,
      log.quoteAsset
    );
  }
}