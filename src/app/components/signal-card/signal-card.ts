import { Component, EventEmitter, Input, Output } from '@angular/core';
import { TradeSignal } from '../../models/models';
import { DecimalPipe } from '@angular/common';
import { generateBinanceLink } from '../../utils/link-helper';
import { MarketType, PositionStatus, SignalSide } from '../../core/constants/trade-enums';
import { calculateSignalScore } from '../../utils/scoring';

@Component({
  selector: 'app-signal-card',
  standalone: true,
  imports: [
    DecimalPipe
  ],
  templateUrl: './signal-card.html',
  styleUrl: './signal-card.scss',
})
export class SignalCard {
  public SignalSide = SignalSide;
  public PositionStatus = PositionStatus;
  public MarketType = MarketType;

  @Input() sig!: TradeSignal;
  @Input() index: number = 0;
  @Input() marketType: MarketType = MarketType.FUTURES;

  getBinanceLink(): string {
    return generateBinanceLink(
      this.sig.symbol,
      this.marketType,
      this.sig.quoteAsset
    );
  }

  get score(): number {
    return calculateSignalScore(this.sig);
  }
}
