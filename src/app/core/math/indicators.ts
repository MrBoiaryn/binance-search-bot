import { LevelType, TimeframeUnit } from '../constants/trade-enums';

/**
 * Розрахунок Awesome Oscillator (AO) для історії.
 * Формула: SMA(Midpoint, 5) - SMA(Midpoint, 34)
 */
export function calculateAO(history: any[], index: number): number {
  if (index < 33) return 0; // Потрібно мінімум 34 свічки для розрахунку
  const mid = (i: number) => (history[i].high + history[i].low) / 2;

  // Рахуємо середню ціну за 5 свічок
  let s5 = 0; for (let i = index - 4; i <= index; i++) s5 += mid(i);
  // Рахуємо середню ціну за 34 свічки
  let s34 = 0; for (let i = index - 33; i <= index; i++) s34 += mid(i);

  return (s5 / 5) - (s34 / 34);
}

/**
 * Розрахунок AO в реальному часі (для незакритої свічки).
 * Дозволяє бачити дивергенцію ще до того, як хвилина закінчилась.
 */
export function calculateAOForTick(history: any[], kline: any): number {
  const mid = (i: number) => (history[i].high + history[i].low) / 2;
  const currentMid = (kline.high + kline.low) / 2;

  // Додаємо поточну ціну до останніх 4-х закритих свічок
  let s5 = currentMid; for (let i = history.length - 1; i > history.length - 5; i--) s5 += mid(i);
  // Додаємо поточну ціну до останніх 33-х закритих свічок
  let s34 = currentMid; for (let i = history.length - 1; i > history.length - 34; i--) s34 += mid(i);

  return (s5 / 5) - (s34 / 34);
}

/**
 * Average True Range (ATR) — показник волатильності.
 * Використовується для розрахунку відступів стоп-лосса та тейка.
 */
export function calculateATR(history: any[], period: number = 14): number {
  if (history.length < period) return 0;
  const slices = history.slice(-period);
  // Рахуємо середній розмір свічки (High - Low) за період
  const ranges = slices.map(k => k.high - k.low);
  return ranges.reduce((a, b) => a + b, 0) / period;
}

/**
 * Округлення ціни до кроку біржі (Tick Size).
 * Щоб біржа не відхилила ордер через зайві знаки після коми.
 */
export function roundToTick(price: number, tick: number): number {
  const p = Math.max(0, -Math.floor(Math.log10(tick)));
  return parseFloat((Math.round(price / tick) * tick).toFixed(p));
}

/**
 * ГОЛОВНА ФУНКЦІЯ: Пошук рівнів ліквідності (Take Profit).
 * Працює як справжній трейдер: шукає скупчення розворотів ціни.
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

  // Мінімальна дистанція до тейка (1 ATR), щоб не закриватися занадто рано
  const minDistance = atr * 1.0;

  // 1. Збираємо всі "вузли" (точки, де ціна розверталася в минулому)
  const allPivots: { price: number, volume: number }[] = [];

  for (let i = window; i < history.length - window; i++) {
    const current = history[i];

    // Шукаємо "горби" (Swing High)
    let isSwingHigh = true;
    for (let j = 1; j <= window; j++) {
      if (history[i - j].high >= current.high || history[i + j].high >= current.high) {
        isSwingHigh = false; break;
      }
    }
    if (isSwingHigh) allPivots.push({ price: current.high, volume: current.volume });

    // Шукаємо "впадини" (Swing Low)
    let isSwingLow = true;
    for (let j = 1; j <= window; j++) {
      if (history[i - j].low <= current.low || history[i + j].low <= current.low) {
        isSwingLow = false; break;
      }
    }
    if (isSwingLow) allPivots.push({ price: current.low, volume: current.volume });
  }

  // 2. Фільтруємо рівні, які знаходяться по ходу нашого руху
  const validPivots = allPivots.filter(p => {
    if (type === LevelType.RESISTANCE) {
      return p.price >= currentPrice + minDistance; // Для Лонга шукаємо рівні ВИЩЕ
    } else {
      return p.price <= currentPrice - minDistance; // Для Шорта шукаємо рівні НИЖЧЕ
    }
  });

  // Якщо рівнів немає — ставимо ціль на відстані 2 ATR
  if (validPivots.length === 0) {
    const fallbackPrice = type === LevelType.RESISTANCE
      ? currentPrice + (atr * 2)
      : currentPrice - (atr * 2);
    return { price: roundToTick(fallbackPrice, tickSize), strength: 0.5 };
  }

  // 3. КЛАСТЕРИЗАЦІЯ (Групуємо окремі точки в зони ліквідності)
  const clusterZone = atr * 0.5; // Рівні вважаються одним цілим, якщо вони ближче ніж 0.5 ATR
  const clusters: { minPrice: number, maxPrice: number, touches: number, totalVol: number }[] = [];

  validPivots.forEach(p => {
    const existing = clusters.find(c =>
      Math.abs(c.minPrice - p.price) <= clusterZone ||
      Math.abs(c.maxPrice - p.price) <= clusterZone
    );

    if (existing) {
      existing.minPrice = Math.min(existing.minPrice, p.price);
      existing.maxPrice = Math.max(existing.maxPrice, p.price);
      existing.touches += 1; // Рахуємо кількість підтверджень рівня
      existing.totalVol += p.volume; // Рахуємо об'єм, проторгований на рівні
    } else {
      clusters.push({ minPrice: p.price, maxPrice: p.price, touches: 1, totalVol: p.volume });
    }
  });

  // 4. Сортуємо зони: найсильніші (де було найбільше дотиків та об'єму) — перші
  clusters.sort((a, b) => {
    if (b.touches !== a.touches) return b.touches - a.touches;
    return b.totalVol - a.totalVol;
  });

  const bestLevel = clusters[0];

  // 5. Ставимо Тейк-Профіт на БЛИЖНІЙ край зони (щоб точно закрило об ліквідність)
  const finalTakeProfitPrice = type === LevelType.RESISTANCE
    ? bestLevel.minPrice
    : bestLevel.maxPrice;

  return {
    price: roundToTick(finalTakeProfitPrice, tickSize),
    strength: bestLevel.touches * 1.5,
    zoneMin: roundToTick(bestLevel.minPrice, tickSize),
    zoneMax: roundToTick(bestLevel.maxPrice, tickSize)
  };
}

/**
 * Розрахунок мультиплікатора об'єму.
 * Коригує об'єм поточної свічки відносно того, скільки часу вже пройшло.
 */
export function calculateVolMult(kline: any, tf: string, avgVol: number): number {
  if (!kline.openTime || avgVol === 0) return kline.volume / (avgVol || 1);
  const elapsed = Date.now() - kline.openTime; // Скільки мс пройшло з відкриття свічки
  const total = getTfMs(tf); // Скільки всього мс у таймфреймі

  if (kline.isClosed || elapsed < total / 2) return kline.volume / avgVol;

  // Якщо свічка тільки почалась, але об'єм уже великий — це аномалія.
  // Екстраполюємо об'єм до кінця хвилини.
  return (kline.volume / Math.min(0.99, elapsed / total)) / avgVol;
}

/**
 * Конвертація таймфрейму (напр. '15m') у мілісекунди.
 */
export function getTfMs(tf: string): number {
  const unit = tf.slice(-1), value = parseInt(tf);
  switch (unit) {
    case TimeframeUnit.MINUTES: return value * 60 * 1000;
    case TimeframeUnit.HOURS: return value * 60 * 60 * 1000;
    case TimeframeUnit.DAYS: return value * 24 * 60 * 60 * 1000;
    default: return 60 * 1000;
  }
}

/**
 * Розрахунок Експоненційної ковзної середньої (EMA).
 */
export function calculateEMA(data: number[], period: number): number[] {
  const k = 2 / (period + 1);
  let ema = [data[0]];
  for (let i = 1; i < data.length; i++) {
    ema.push(data[i] * k + ema[i - 1] * (1 - k));
  }
  return ema;
}

/**
 * Фільтр глобального тренду (HTF Filter).
 * Перевіряє положення ціни відносно EMA 200 та нахил самої EMA.
 */
export function checkTrendBias(history: any[], period: number = 200): 'BULLISH' | 'BEARISH' | 'NEUTRAL' {
  if (history.length < period + 1) return 'NEUTRAL';
  const prices = history.map(h => h.close);
  const ema = calculateEMA(prices, period);

  const currEma = ema[ema.length - 1];
  const currPrice = prices[prices.length - 1];

  // СПРОЩЕНА ЛОГІКА (Більше сигналів, краще для точок входу на корекціях):
  if (currPrice > currEma) return 'BULLISH';
  if (currPrice < currEma) return 'BEARISH';

  return 'NEUTRAL';
}