import { Component, EventEmitter, Input, Output } from '@angular/core';
import { ScannerSettings } from '../../models/models';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-header',
  standalone: true,
  imports: [
    FormsModule,
    CommonModule
  ],
  templateUrl: './header.html',
  styleUrl: './header.scss',
})
export class Header {
  @Input() settings!: ScannerSettings;

  @Output() settingsChanged = new EventEmitter<ScannerSettings>();

  localSettings!: ScannerSettings;

  readonly timeframes = [
    '1m', '3m', '5m', '15m', '30m',
    '1h', '2h', '4h', '6h', '8h', '12h',
    '1d', '3d', '1w'
  ];

  ngOnInit() {
    this.localSettings = JSON.parse(JSON.stringify(this.settings));
    if (!this.localSettings.tpGrid) {
      this.localSettings.tpGrid = [];
    }
  }

  apply() {
    this.settingsChanged.emit(JSON.parse(JSON.stringify(this.localSettings)));
  }

  onTfChange(tf: string, event: any) {
    const checked = event.target.checked;
    if (checked) {
      if (this.localSettings.timeframes.length >= 3) {
        event.target.checked = false;
        alert('Максимум 3 таймфрейми для стабільної роботи!');
        return;
      }
      this.localSettings.timeframes.push(tf);
    } else {
      this.localSettings.timeframes = this.localSettings.timeframes.filter(t => t !== tf);
    }
  }

  isTfSelected(tf: string): boolean {
    return this.localSettings.timeframes.includes(tf);
  }

  addTpLevel() {
    if (this.localSettings.tpGrid.length >= 10) return;
    this.localSettings.tpGrid.push({
      movePercent: 50,
      volumePercent: 100 / (this.localSettings.tpGrid.length + 1),
      triggerBE: false
    });
  }

  removeTpLevel(index: number) {
    this.localSettings.tpGrid.splice(index, 1);
  }

  onBeToggle(index: number) {
    if (this.localSettings.tpGrid[index].triggerBE) {
      this.localSettings.tpGrid.forEach((level, i) => {
        if (i !== index) level.triggerBE = false;
      });
    }
  }

  get totalTpVolume(): number {
    return this.localSettings.tpGrid.reduce((sum, lvl) => sum + (lvl.volumePercent || 0), 0);
  }

  get isVolumeInvalid(): boolean {
    if (this.localSettings.tpGrid.length === 0) return false;
    return Math.abs(this.totalTpVolume - 100) > 0.01;
  }
}
