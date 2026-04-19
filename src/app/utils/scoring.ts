import { TradeSignal } from '../models/models';

export function calculateSignalScore(signal: TradeSignal): number {
  let rr = signal.rr;
  let vol = signal.volumeMultiplier;
  let lvl = signal.lvlStrength;
  let swing = signal.swingStrength;

  if (rr < 1) rr *= 10;
  if (vol < 1) vol *= 10;
  if (lvl < 1) lvl *= 10;
  if (swing < 1) swing *= 10;

  const logLiq = Math.log10(signal.liqAmount || 10);
  return rr * vol * lvl * swing * logLiq;
}
