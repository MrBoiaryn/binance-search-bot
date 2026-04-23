import { Component, EventEmitter, Input, Output } from '@angular/core';
import { HistoricalLog, TPGridLevel } from '../../models/models';
import { CommonModule, DecimalPipe } from '@angular/common';
import { generateBinanceLink } from '../../utils/link-helper';
import { MarketType, PositionStatus, SignalSide } from '../../core/constants/trade-enums';

@Component({
  selector: 'app-history-table',
  standalone: true,
  imports: [CommonModule, DecimalPipe],
  templateUrl: './history-table.html',
  styleUrl: './history-table.scss',
})
export class HistoryTable {
  public SignalSide = SignalSide;
  public PositionStatus = PositionStatus;
  public MarketType = MarketType;

  @Input() history: HistoricalLog[] = [];
  @Input() marketType: MarketType = MarketType.FUTURES;

  // ✅ Приймаємо вже порахований PnL від App
  @Input() totalPnL: number = 0;

  @Input() availableTfs: string[] = [];
  @Input() activeFilter: PositionStatus | string = PositionStatus.ALL;

  @Output() clearHistory = new EventEmitter<void>();
  @Output() filterChanged = new EventEmitter<PositionStatus | string>();

  getBinanceLink(log: HistoricalLog): string {
    return generateBinanceLink(
      log.symbol,
      log.marketType || this.marketType,
      log.quoteAsset
    );
  }

  getPercent(price: number, target: number): number {
    if (!price || !target) return 0;
    return (Math.abs(target - price) / price) * 100;
  }

  getHitCount(grid?: TPGridLevel[]): number {
    if (!grid) return 0;
    return grid.filter(l => l.isHit).length;
  }
}
