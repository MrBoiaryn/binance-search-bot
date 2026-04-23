import { Injectable } from '@angular/core';
import { HistoricalLog } from '../models/models';

@Injectable({ providedIn: 'root' })
export class PositionTrackerService {
  // Комісія: 0.1% (консервативна оцінка для ф'ючерсів за вхід+вихід)
  private readonly FEE_RATE = 0.001;


}