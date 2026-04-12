import { Component, EventEmitter, Input, Output } from '@angular/core';
import { ScannerSettings } from '../../models/models';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common'; // Додав для кращої сумісності

@Component({
  selector: 'app-header',
  imports: [
    FormsModule
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
    this.localSettings = { ...this.settings };
  }

  apply() {
    this.settingsChanged.emit({ ...this.localSettings });
  }

  // Обмеження вибору
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
}
