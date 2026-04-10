import { Component, EventEmitter, Input, Output } from '@angular/core';
import { ScannerSettings } from '../../models/models';
import { FormsModule } from '@angular/forms';

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

  ngOnInit() {
    this.localSettings = { ...this.settings };
  }

  apply() {
    this.settingsChanged.emit({ ...this.localSettings });
  }
}
