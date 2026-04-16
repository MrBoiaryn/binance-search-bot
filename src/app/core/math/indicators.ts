export function calculateAO(history: any[], index: number): number {
  if (index < 33) return 0;
  const mid = (i: number) => (history[i].high + history[i].low) / 2;
  let s5 = 0; for (let i = index - 4; i <= index; i++) s5 += mid(i);
  let s34 = 0; for (let i = index - 33; i <= index; i++) s34 += mid(i);
  return (s5 / 5) - (s34 / 34);
}

export function calculateAOForTick(history: any[], kline: any): number {
  const mid = (i: number) => (history[i].high + history[i].low) / 2;
  const currentMid = (kline.high + kline.low) / 2;
  let s5 = currentMid; for (let i = history.length - 1; i > history.length - 5; i--) s5 += mid(i);
  let s34 = currentMid; for (let i = history.length - 1; i > history.length - 34; i--) s34 += mid(i);
  return (s5 / 5) - (s34 / 34);
}

export function calculateATR(history: any[], period: number = 14): number {
  if (history.length < period) return 0;
  const slices = history.slice(-period);
  const ranges = slices.map(k => k.high - k.low);
  return ranges.reduce((a, b) => a + b, 0) / period;
}

export function roundToTick(price: number, tick: number): number {
  const p = Math.max(0, -Math.floor(Math.log10(tick)));
  return parseFloat((Math.round(price / tick) * tick).toFixed(p));
}

export function findTrueLevel(history: any[], type: 'SUPPORT' | 'RESISTANCE', currentPrice: number, tickSize: number) {
  if (history.length === 0) return { price: currentPrice, strength: 0 };
  const prices = history.map(k => type === 'RESISTANCE' ? k.high : k.low);
  const minP = Math.min(...prices, currentPrice);
  const maxP = Math.max(...prices, currentPrice);
  const binSize = Math.max((maxP - minP) / 100, tickSize * 2);
  const bins = new Array(Math.ceil((maxP - minP) / binSize) + 1).fill(0);

  history.forEach(k => {
    const idx = Math.floor(((type === 'RESISTANCE' ? k.high : k.low) - minP) / binSize);
    if (idx >= 0 && idx < bins.length) bins[idx] += k.volume;
  });

  let bestIdx = -1, maxVol = 0;
  bins.forEach((v, i) => {
    const p = minP + i * binSize;
    if (type === 'RESISTANCE' && p <= currentPrice) return;
    if (type === 'SUPPORT' && p >= currentPrice) return;
    if (v > maxVol) { maxVol = v; bestIdx = i; }
  });

  if (bestIdx === -1) return { price: type === 'RESISTANCE' ? maxP : minP, strength: 0 };
  const avgVol = bins.reduce((a, b) => a + b, 0) / bins.length;
  return { price: minP + bestIdx * binSize, strength: maxVol / (avgVol || 1) };
}

export function calculateVolMult(kline: any, tf: string, avgVol: number): number {
  if (!kline.openTime || avgVol === 0) return kline.volume / (avgVol || 1);
  const elapsed = Date.now() - kline.openTime;
  const total = getTfMs(tf);
  if (kline.isClosed || elapsed < total / 2) return kline.volume / avgVol;
  return (kline.volume / Math.min(0.99, elapsed / total)) / avgVol;
}

export function getTfMs(tf: string): number {
  const unit = tf.slice(-1), value = parseInt(tf);
  switch (unit) {
    case 'm': return value * 60 * 1000;
    case 'h': return value * 60 * 60 * 1000;
    case 'd': return value * 24 * 60 * 60 * 1000;
    default: return 60 * 1000;
  }
}
