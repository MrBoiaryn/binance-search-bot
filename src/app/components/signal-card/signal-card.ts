import { Component, EventEmitter, Input, Output } from '@angular/core';
import { TradeSignal } from '../../models/models';
import { DecimalPipe } from '@angular/common';
import { generateBinanceLink } from '../utils/link-helper';

@Component({
  selector: 'app-signal-card',
  imports: [
    DecimalPipe
  ],
  templateUrl: './signal-card.html',
  styleUrl: './signal-card.scss',
})
export class SignalCard {
  @Input() sig!: TradeSignal;
  @Input() marketType: 'spot' | 'futures' = 'futures';

  getBinanceLink(): string {
    return generateBinanceLink(
      this.sig.symbol,
      this.marketType,
      this.sig.quoteAsset
    );
  }
}