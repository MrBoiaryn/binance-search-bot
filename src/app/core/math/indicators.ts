import { LevelType, TimeframeUnit } from '../constants/trade-enums';

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

/**
 * Знаходить найближчий сильний рівень ліквідності для Тейк-Профіту.
 * Враховує дзеркальні рівні, формує зони ліквідності та цілиться в найближчий край зони.
 * * @param history Історія свічок
 * @param type Напрямок пошуку (RESISTANCE для Лонга, SUPPORT для Шорта)
 * @param currentPrice Поточна ціна (або ціна входу)
 * @param tickSize Мінімальний крок ціни монети
 * @param atr Average True Range (для динамічних відступів)
 * @param window Розмір фракталу (скільки свічок зліва і справа перевіряти)
 */
export function findTrueLevel(
  history: any[],
  type: LevelType,
  currentPrice: number,
  tickSize: number,
  atr: number,
  window: number = 5
) {
  if (history.length < window * 3) return { price: currentPrice, strength: 0 };

  // Універсальна мертва зона (1 ATR), щоб тейк не стояв упритул до входу
  const minDistance = atr * 1.0;

  // 1. Збираємо ВЗАГАЛІ ВСІ екстремуми (і Хаї, і Лоу)
  const allPivots: { price: number, volume: number }[] = [];

  for (let i = window; i < history.length - window; i++) {
    const current = history[i];

    // Перевірка на Swing High (Верхній фрактал / Горб)
    let isSwingHigh = true;
    for (let j = 1; j <= window; j++) {
      if (history[i - j].high >= current.high || history[i + j].high >= current.high) {
        isSwingHigh = false; break;
      }
    }
    if (isSwingHigh) allPivots.push({ price: current.high, volume: current.volume });

    // Перевірка на Swing Low (Нижній фрактал / Впадина)
    let isSwingLow = true;
    for (let j = 1; j <= window; j++) {
      if (history[i - j].low <= current.low || history[i + j].low <= current.low) {
        isSwingLow = false; break;
      }
    }
    if (isSwingLow) allPivots.push({ price: current.low, volume: current.volume });
  }

  // 2. Фільтруємо рівні залежно від нашого напрямку (Опір чи Підтримка)
  const validPivots = allPivots.filter(p => {
    if (type === LevelType.RESISTANCE) {
      // Для Лонга нас цікавить ВСЕ (і старі хаї, і старі лоу), що знаходиться ВИЩЕ нас
      return p.price >= currentPrice + minDistance;
    } else {
      // Для Шорта нас цікавить ВСЕ, що знаходиться НИЖЧЕ нас
      return p.price <= currentPrice - minDistance;
    }
  });

  // Якщо рівнів попереду немає, ставимо дефолтний безпечний тейк (2 ATR)
  if (validPivots.length === 0) {
    const fallbackPrice = type === LevelType.RESISTANCE
      ? currentPrice + (atr * 2)
      : currentPrice - (atr * 2);
    return { price: roundToTick(fallbackPrice, tickSize), strength: 0.5 };
  }

  // 3. Кластеризація (Збираємо зони з чіткими межами)
  const clusterZone = atr * 0.5; // Ширина коридору (пів середньої свічки)
  const clusters: { minPrice: number, maxPrice: number, touches: number, totalVol: number }[] = [];

  validPivots.forEach(p => {
    // Шукаємо, чи ціна потрапляє в якийсь існуючий коридор
    const existing = clusters.find(c =>
      Math.abs(c.minPrice - p.price) <= clusterZone ||
      Math.abs(c.maxPrice - p.price) <= clusterZone
    );

    if (existing) {
      // Якщо так, розширюємо межі коридору, якщо шпилька вийшла за них
      existing.minPrice = Math.min(existing.minPrice, p.price);
      existing.maxPrice = Math.max(existing.maxPrice, p.price);
      existing.touches += 1;
      existing.totalVol += p.volume;
    } else {
      // Створюємо новий коридор (на старті мін і макс однакові)
      clusters.push({
        minPrice: p.price,
        maxPrice: p.price,
        touches: 1,
        totalVol: p.volume
      });
    }
  });

  // 4. Сортування кластерів (Спершу найсильніші)
  clusters.sort((a, b) => {
    // Якщо один рівень тестувався частіше - він сильніший
    if (b.touches !== a.touches) return b.touches - a.touches;
    // Якщо дотиків порівну - дивимось, де було більше об'єму
    return b.totalVol - a.totalVol;
  });

  // Беремо найсильніший кластер
  const bestLevel = clusters[0];

  // 5. Визначаємо БЛИЖНІЙ край коридору для тейк-профіту (Proximal Edge)
  const finalTakeProfitPrice = type === LevelType.RESISTANCE
    ? bestLevel.minPrice // Для Лонга: низ коридору опору
    : bestLevel.maxPrice; // Для Шорта: верх коридору підтримки

  return {
    price: roundToTick(finalTakeProfitPrice, tickSize),
    strength: bestLevel.touches * 1.5, // Множник сили (1 дотик = 1.5, 2 дотики = 3.0)
    zoneMin: roundToTick(bestLevel.minPrice, tickSize),
    zoneMax: roundToTick(bestLevel.maxPrice, tickSize)
  };
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
    case TimeframeUnit.MINUTES: return value * 60 * 1000;
    case TimeframeUnit.HOURS: return value * 60 * 60 * 1000;
    case TimeframeUnit.DAYS: return value * 24 * 60 * 60 * 1000;
    default: return 60 * 1000;
  }
}

export function calculateEMA(data: number[], period: number): number[] {
  const k = 2 / (period + 1);
  let ema = [data[0]];
  for (let i = 1; i < data.length; i++) {
    ema.push(data[i] * k + ema[i - 1] * (1 - k));
  }
  return ema;
}

export function checkTrendBias(history: any[], period: number = 200): 'BULLISH' | 'BEARISH' | 'NEUTRAL' {
  if (history.length < period + 1) return 'NEUTRAL';
  const prices = history.map(h => h.close);
  const ema = calculateEMA(prices, period);
  const currEma = ema[ema.length - 1];
  const prevEma = ema[ema.length - 2];
  const currPrice = prices[prices.length - 1];

  if (currPrice > currEma && currEma > prevEma) return 'BULLISH';
  if (currPrice < currEma && currEma < prevEma) return 'BEARISH';
  return 'NEUTRAL';
}
