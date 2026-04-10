import { Component, Input } from '@angular/core';
import { HistoricalLog } from '../../models/models';
import { DecimalPipe } from '@angular/common';

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


  getBinanceLink(symbol: string): string {
    return `https://www.binance.com/uk-UA/futures/${symbol.toUpperCase()}`;
  }
}
