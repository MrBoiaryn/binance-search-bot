import { ComponentFixture, TestBed } from '@angular/core/testing';

import { SignalCard } from './signal-card';

describe('SignalCard', () => {
  let component: SignalCard;
  let fixture: ComponentFixture<SignalCard>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SignalCard],
    }).compileComponents();

    fixture = TestBed.createComponent(SignalCard);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
