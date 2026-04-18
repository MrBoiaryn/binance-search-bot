import { Component, EventEmitter, Input, Output } from '@angular/core';
import { ScannerSettings } from '../../models/models';
import { CommonModule } from '@angular/common';
import { MarketType } from '../../core/constants/trade-enums';

@Component({
  selector: 'app-header',
  standalone: true,
  imports: [
    CommonModule
  ],
  templateUrl: './header.html',
  styleUrl: './header.scss',
})
export class Header {
  @Input() settings!: ScannerSettings;
  @Output() openSettings = new EventEmitter<void>();

  readonly MarketType = MarketType;
}
