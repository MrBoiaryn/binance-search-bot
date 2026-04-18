import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-help-dialog',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './help-dialog.html',
  styleUrls: ['./help-dialog.scss']
})
export class HelpDialogComponent {
  @Input() isOpen: boolean = false;
  @Output() close = new EventEmitter<void>();

  onClose(): void {
    this.close.emit();
  }
}
