import { Component, EventEmitter, Input, Output, OnChanges, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ScannerSettings } from '../../models/models';
import { MarketType } from '../../core/constants/trade-enums';

@Component({
  selector: 'app-settings-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './settings-dialog.html',
  styleUrl: './settings-dialog.scss'
})
export class SettingsDialog implements OnChanges {
  @Input() settings!: ScannerSettings;
  @Input() isOpen: boolean = false;

  @Output() save = new EventEmitter<ScannerSettings>();
  @Output() close = new EventEmitter<void>();

  localSettings!: ScannerSettings;
  readonly MarketType = MarketType;

  readonly timeframes = [
    '1m', '3m', '5m', '15m', '30m',
    '1h', '2h', '4h', '6h', '8h', '12h',
    '1d', '3d', '1w'
  ];

  ngOnChanges(changes: SimpleChanges) {
    if (changes['settings'] && this.settings) {
      this.localSettings = JSON.parse(JSON.stringify(this.settings));
      if (!this.localSettings.tpGrid) {
        this.localSettings.tpGrid = [];
      }
    }
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
    if (!this.localSettings || this.localSettings.tpGrid.length === 0) return false;
    return Math.abs(this.totalTpVolume - 100) > 0.01;
  }

  onSave() {
    this.save.emit(JSON.parse(JSON.stringify(this.localSettings)));
  }

  onCancel() {
    this.close.emit();
  }
}
