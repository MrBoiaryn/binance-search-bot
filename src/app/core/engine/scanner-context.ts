import { PatternContext, ScannerSettings } from '../../models/models';
import { calculateAOForTick, calculateATR } from '../math/indicators';
import { SignalSide } from '../constants/trade-enums';

/**
 * Створює "Контекст Патерна" — набір аналітичних даних,
 * які допоможуть стратегії зрозуміти, чи варто зараз входити в угоду.
 */
export function createPatternContext(kline: any, history: any[], settings: ScannerSettings): PatternContext {
  // 1. Налаштування глибини перегляду (скільки свічок враховувати для пошуку локальних піків/днів)
  const lookback = settings.swingPeriod || 10;

  // Беремо останні N свічок з історії
  const lastN = history.slice(-lookback);

  // Попередня свічка (яка вже повністю закрита)
  const lastCandle = history[history.length - 1];

  // Масив історії без останньої свічки (потрібен для аналізу патернів типу Inside Bar)
  const historyExclLast = history.slice(0, -1);
  const lastNExclLast = historyExclLast.slice(-lookback);

  // 2. Розрахунок технічних показників для поточної хвилини (тіка)
  const currentAO = calculateAOForTick(history, kline); // Awesome Oscillator для поточної свічки
  const atr = calculateATR(history, 14); // Середня волатильність (ATR)

  return {
    kline,        // Поточна свічка
    lastCandle,   // Попередня закрита свічка
    history,      // Вся історія
    atr,          // Волатильність

    // Розраховуємо середній розмір тіла свічки (щоб розуміти, чи зараз сильні рухи, чи флет)
    avgBody: history.slice(-lookback).reduce((acc, k) => acc + Math.abs(k.close - k.open), 0) / lookback,

    // 3. ПЕРЕВІРКА ЕКСТРЕМУМІВ
    // Чи є поточний Low найнижчим за останні N свічок? (Ознака дна)
    isLocalBottom: kline.low! <= Math.min(...lastN.map(k => k.low)),

    // Чи є поточний High найвищим за останні N свічок? (Ознака піку)
    isLocalPeak: kline.high! >= Math.max(...lastN.map(k => k.high)),

    // Ті ж самі перевірки, але для попередньої свічки (важливо для "Материнської свічки" в Inside Bar)
    isMotherBarBottom: lastCandle && lastCandle.low <= Math.min(...lastNExclLast.map(k => k.low)),
    isMotherBarPeak: lastCandle && lastCandle.high >= Math.max(...lastNExclLast.map(k => k.high)),

    // 4. ДИВЕРГЕНЦІЯ
    // Перевіряємо, чи немає розбіжності між ціною та AO (одна з найсильніших ознак розвороту)
    hasDivergence: checkAODivergence(history, (kline.close > kline.open ? SignalSide.LONG : SignalSide.SHORT), currentAO)
  };
}

/**
 * Шукає дивергенцію Awesome Oscillator (AO).
 * Дивергенція — це коли ціна оновлює мінімум/максимум, а індикатор AO — ні.
 */
export function checkAODivergence(history: any[], type: SignalSide, currentAO: number): boolean {
  const len = history.length;
  // 1. "Зір снайпера": 120 свічок. Достатньо, щоб побачити цикл Імпульс -> Корекція -> Імпульс.
  const lookback = 120;
  if (len < lookback) return false;

  const getAO = (i: number) => history[i]?.ao || 0;

  if (type === SignalSide.LONG) {
    // Шукаємо БИЧУ дивергенцію (Розворот ВГОРУ)
    if (currentAO >= 0) return false; // Якщо момент позитивний, дно ще не сформоване

    let recM = Infinity;   // Найнижча ціна в поточній хвилі
    let recAO = Infinity; // Найнижчий AO в поточній хвилі
    let i = len - 1;

    // 2. АНАЛІЗ ПОТОЧНОЇ ХВИЛІ (Wave 5)
    // Шукаємо екстремуми в останніх 30 барах. Це наше "зараз".
    for (; i >= len - 30; i--) {
      if (history[i].low < recM) recM = history[i].low;
      if (getAO(i) < recAO) recAO = getAO(i);

      // Якщо AO перетнув нуль дуже сильно, ми вийшли з впадини
      if (getAO(i) > 0.5) break;
    }

    let pastM = Infinity;   // Ціна в попередній хвилі (Wave 3)
    let pastAO = Infinity; // AO в попередній хвилі (Wave 3)
    let zeroCrossed = false;
    let foundPreviousWave = false;

    // 3. ПОШУК ПОПЕРЕДНЬОЇ ХВИЛІ (Wave 3)
    // Йдемо далі в минуле (до 120 барів)
    for (; i >= len - lookback; i--) {
      const ao = getAO(i);

      // Фіксуємо Хвилю 4 (корекція).
      // Якщо AO вище нуля — це ідеальне підтвердження за Елліоттом.
      if (ao >= 0) {
        zeroCrossed = true;
        continue;
      }

      // Якщо ми знову в "мінусі" після потенційної корекції — це наша Wave 3
      if (ao < 0) {
        // Ми шукаємо саме ПІК моментуму (найглибшу точку AO) у минулому
        if (ao < pastAO) {
          pastAO = ao;
          pastM = history[i].low;
          foundPreviousWave = true;
        }
      }
    }

    if (!foundPreviousWave) return false;

    // 4. ВЕРДИКТ:
    // - Ціна зробила новий мінімум (recM < pastM)
    // - АЛЕ AO став вищим, ніж був у минулій хвилі (recAO > pastAO)
    // - Додаємо невеликий фільтр (0.1), щоб відсікти мікро-шум
    const isDivergent = (recM <= pastM) && (recAO > pastAO + 0.1);

    return isDivergent;

  } else {
    // --- ЛОГІКА ДЛЯ ШОРТА (Ведмежа дивергенція - Дзеркально) ---
    if (currentAO <= 0) return false;

    let recM = -Infinity;
    let recAO = -Infinity;
    let i = len - 1;

    for (; i >= len - 30; i--) {
      if (history[i].high > recM) recM = history[i].high;
      if (getAO(i) > recAO) recAO = getAO(i);
      if (getAO(i) < -0.5) break;
    }

    let pastM = -Infinity;
    let pastAO = -Infinity;
    let zeroCrossed = false;
    let foundPreviousWave = false;

    for (; i >= len - lookback; i--) {
      const ao = getAO(i);
      if (ao <= 0) {
        zeroCrossed = true;
        continue;
      }
      if (ao > 0) {
        if (ao > pastAO) {
          pastAO = ao;
          pastM = history[i].high;
          foundPreviousWave = true;
        }
      }
    }

    if (!foundPreviousWave) return false;

    return (recM >= pastM) && (recAO < pastAO - 0.1);
  }
}