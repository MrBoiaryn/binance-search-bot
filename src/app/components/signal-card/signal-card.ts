import { Component, EventEmitter, Input, Output } from '@angular/core';
import { TradeSignal } from '../../models/models';
import { DecimalPipe } from '@angular/common';

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
  @Output() onOpenTrade = new EventEmitter<TradeSignal>();

  getBinanceLink(symbol: string): string {
    return `https://www.binance.com/uk-UA/futures/${symbol.toUpperCase()}`;
  }
}
