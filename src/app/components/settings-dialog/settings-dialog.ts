import { Component, EventEmitter, Input, Output, OnChanges, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ScannerSettings, TPGridLevel, TimeframeSettings } from '../../models/models';
import { MarketType } from '../../core/constants/trade-enums';

const FIBO_LEVELS: TPGridLevel[] = [
  { movePercent: 23.6, volumePercent: 20, triggerBE: false },
  { movePercent: 38.2, volumePercent: 30, triggerBE: true },
  { movePercent: 50.0, volumePercent: 20, triggerBE: false },
  { movePercent: 61.8, volumePercent: 15, triggerBE: false },
  { movePercent: 78.6, volumePercent: 10, triggerBE: false },
  { movePercent: 100.0, volumePercent: 5, triggerBE: false }
];

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

  readonly htfOptions = ['5m', '15m', '30m', '1h', '4h', '1d'];

  ngOnChanges(changes: SimpleChanges) {
    if (changes['settings'] && this.settings) {
      this.localSettings = JSON.parse(JSON.stringify(this.settings));
      if (!this.localSettings.tpGrid) {
        this.localSettings.tpGrid = [];
      }
      if (!this.localSettings.tfSettings) {
        this.localSettings.tfSettings = {};
      }
      // Ensure all selected timeframes have settings
      this.localSettings.timeframes.forEach(tf => this.initTfSettings(tf));
    }
  }

  initTfSettings(tf: string) {
    if (!this.localSettings.tfSettings[tf]) {
      this.localSettings.tfSettings[tf] = {
        htfTarget: this.getDefaultHTF(tf),
        emaPeriod: 100
      };
    }
  }

  getDefaultHTF(tf: string): string {
    switch (tf) {
      case '1m': return '5m';
      case '3m': return '15m';
      case '5m': return '30m';
      case '15m': return '1h';
      case '30m': return '2h';
      case '1h': return '4h';
      case '4h': return '1d';
      default: return '1d';
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
      this.initTfSettings(tf);
    } else {
      this.localSettings.timeframes = this.localSettings.timeframes.filter(t => t !== tf);
    }
  }

  isTfSelected(tf: string): boolean {
    return this.localSettings.timeframes.includes(tf);
  }

  applyFiboPreset() {
    if (this.localSettings.useFiboGrid) {
      this.localSettings.tpGrid = JSON.parse(JSON.stringify(FIBO_LEVELS));
    }
  }

  onMovePercentChange() {
    this.localSettings.useFiboGrid = false;
  }

  addTpLevel() {
    if (this.localSettings.tpGrid.length >= 10) return;
    this.localSettings.tpGrid.push({
      movePercent: 50,
      volumePercent: 100 / (this.localSettings.tpGrid.length + 1),
      triggerBE: false
    });
    this.localSettings.useFiboGrid = false;
  }

  removeTpLevel(index: number) {
    this.localSettings.tpGrid.splice(index, 1);
    this.localSettings.useFiboGrid = false;
  }

  onBeToggle(index: number) {
    if (this.localSettings.tpGrid[index].triggerBE) {
      this.localSettings.tpGrid.forEach((level, i) => {
        if (i !== index) level.triggerBE = false;
      });
    }
    this.localSettings.useFiboGrid = false;
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
