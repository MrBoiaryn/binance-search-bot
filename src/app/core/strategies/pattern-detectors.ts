import { PatternContext } from '../../models/models';
import { PatternType } from '../constants/trade-enums';

/**
 * DetectorFn — це тип функції, яка приймає контекст (свічку та її оточення)
 * і повертає або назву патерна (з Енамки), або null, якщо нічого не знайдено.
 */
export type DetectorFn = (ctx: PatternContext) => PatternType | null;

/**
 * ============================================================================
 * ДОПОМІЖНІ МЕТРИКИ (Фундамент розрахунків)
 * ============================================================================
 */

// Різниця між ціною відкриття та закриття (чисте "м'ясо" свічки)
const getBody = (k: any) => Math.abs(k.close - k.open);

// Повний розмір свічки від самого верху (High) до самого низу (Low)
const getRange = (k: any) => k.high - k.low;

// Довжина "вуса" зверху (відстань від максимуму до тіла)
const getUpperShadow = (k: any) => k.high - Math.max(k.open, k.close);

// Довжина "хвоста" знизу (відстань від мінімуму до тіла)
const getLowerShadow = (k: any) => Math.min(k.open, k.close) - k.low;

// Перевірки напрямку свічки
const isBullish = (k: any) => k.close > k.open;
const isBearish = (k: any) => k.close < k.open;


/**
 * ============================================================================
 * НЕЙТРАЛЬНІ ПАТЕРНИ (Ознаки зупинки, невизначеності або накопичення)
 * ============================================================================
 */

/**
 * DOJI (Доджі): Патерн абсолютної рівноваги.
 * Формується, коли ціни відкриття та закриття практично однакові.
 * Сигналізує про тимчасовий паритет між покупцями та продавцями (ринок "на роздоріжжі").
 * Цей детектор шукає "Класичний Доджі" (хрестик), де верхня і нижня тіні приблизно рівні.
 */
export const dojiDetector: DetectorFn = ({ kline }) => {
  const range = getRange(kline);
  if (range === 0) return null; // Захист від відсутності торгів (нульової свічки)

  const body = getBody(kline);
  const upper = getUpperShadow(kline);
  const lower = getLowerShadow(kline);

  // 1. Тіло має бути мікроскопічним (не більше 10% від усього діапазону свічки).
  // Це головна ідентифікаційна умова будь-якого Доджі.
  const isSmallBody = body <= range * 0.1;

  // 2. Симетрія тіней (Центрування).
  // Різниця між верхньою та нижньою тінями не повинна перевищувати 30% від діапазону.
  // Це надійно відсікає "Драконів" та "Могильні камені", де домінує лише одна тінь.
  const isCentral = Math.abs(upper - lower) <= (range * 0.3);

  return (isSmallBody && isCentral) ? PatternType.DOJI : null;
};

/**
 * INSIDE BAR (Внутрішній бар): Патерн стиснення волатильності (Консолідація).
 * Поточна свічка повністю знаходиться в межах діапазону (High-Low) попередньої "материнської" свічки.
 * Візуально нагадує стиснуту пружину: ринок накопичує енергію перед сильним імпульсом
 * або пробоєм рівня.
 */
export const insideBarDetector: DetectorFn = ({ kline, lastCandle }) => {
  // 1. Максимум поточної свічки не зміг перебити максимум попередньої
  const isLowerHigh = kline.high < lastCandle.high;

  // 2. Мінімум поточної свічки не зміг опуститися нижче мінімуму попередньої
  const isHigherLow = kline.low > lastCandle.low;

  // Якщо обидві умови виконані — свічка повністю "захована"
  return (isLowerHigh && isHigherLow) ? PatternType.INSIDE : null;
};




/**
 * ============================================================================
 * LONG PATTERNS (Сигнали на покупку)
 * ============================================================================
 */

/**
 * HAMMER (Молот): Класичний розворотний патерн.
 * Ознака того, що ціна значно впала, але покупці відкупили її назад до закриття.
 */
export const hammerDetector: DetectorFn = ({ kline }) => {
  const range = getRange(kline);
  if (range === 0) return null; // Захист від порожніх (нульових) свічок

  const body = getBody(kline);
  const lowerShadow = getLowerShadow(kline);
  const upperShadow = getUpperShadow(kline);

  // 1. "Свічка має довгу нижню тінь, яка у 2-3 рази більша за тіло"
  // Використовуємо коефіцієнт 2.0 як мінімальний поріг для надійності.
  const isLongTail = lowerShadow >= body * 2.0;

  // 2. "Верхня тінь відсутня або дуже коротка"
  // Дозволяємо верхній тіні займати не більше 10% від усього розміру свічки.
  const isShortUpperShadow = upperShadow <= range * 0.1;

  // 3. "Маленьке тіло свічки розташоване у верхній частині діапазону"
  // Тіло не повинно бути занадто великим (макс 30% від всієї свічки),
  // інакше це вже не молот, а просто велика свічка з хвостом.
  const isSmallBody = body <= range * 0.3;

  // Колір може бути будь-яким (зеленим або червоним), тому ми не використовуємо
  // isBullish() чи isBearish() у фінальній перевірці.

  return (isLongTail && isShortUpperShadow && isSmallBody) ? PatternType.HAMMER : null;
};

/**
 * INVERTED HAMMER (Перевернутий молот): Потенційний бичачий розворот.
 * З'являється після низхідного тренду. Означає, що покупці починають перехоплювати ініціативу.
 */
export const invertedHammerDetector: DetectorFn = ({ kline }) => {
  const range = getRange(kline);
  if (range === 0) return null;

  const body = getBody(kline);
  const upperShadow = getUpperShadow(kline);
  const lowerShadow = getLowerShadow(kline);

  // 1. "Довга верхня тінь, яка в 2-3 рази перевищує розмір тіла"
  const isLongUpperShadow = upperShadow >= body * 2.0;

  // 2. "Нижня тінь або відсутня, або дуже коротка"
  const isShortLowerShadow = lowerShadow <= range * 0.1;

  // 3. "Тіло свічки є відносно малим і розташоване в нижній частині"
  const isSmallBody = body <= range * 0.3;

  // Як і в описі, колір може бути будь-яким, тому не обмежуємо isBullish чи isBearish.

  return (isLongUpperShadow && isShortLowerShadow && isSmallBody) ? PatternType.INVERTED_HAMMER : null;
};

/**
 * POWER BAR LONG (Силова свічка / Бичачий Марубозу): Патерн тотальної домінації покупців.
 * Свічка відкривається майже на самому мінімумі, стрімко летить вгору і закривається
 * на абсолютному максимумі. Відсутність довгої верхньої тіні означає, що покупці
 * не фіксували прибуток і готові тиснути ціну далі.
 * (Захист від флету забезпечується глобальними фільтрами Volume Min та Swing).
 */
export const powerBarLONG: DetectorFn = ({ kline }) => {
  const range = getRange(kline);
  if (range === 0) return null; // Захист від відсутності торгів (нульової свічки)

  const body = getBody(kline);
  const upper = getUpperShadow(kline);
  const lower = getLowerShadow(kline);

  // 1. Тотальне домінування: тіло свічки має займати щонайменше 75% від усього руху.
  // Це відсікає будь-які ознаки невпевненості чи боротьби.
  const isSolidBody = body >= range * 0.75;

  // 2. Закриття "під стелю": верхня тінь практично відсутня (макс 5%).
  // Це ключова ознака того, що продавці навіть не спробували опустити ціну перед закриттям.
  const isCleanTop = upper <= range * 0.05;

  // 3. Допускається невеликий "заступ" на старті: нижня тінь до 20%.
  // Часто на відкритті хвилини ціна робить мікро-відкат вниз перед тим, як вистрілити вгору.
  const hasSmallBase = lower <= range * 0.2;

  return (isBullish(kline) && isSolidBody && isCleanTop && hasSmallBase) ? PatternType.MOMENTUM : null;
};


/**
 * ============================================================================
 * SHORT PATTERNS (Сигнали на продаж)
 * ============================================================================
 */

/**
 * HANGING MAN (Повішений): Ведмежий розворотний патерн.
 * З'являється на вершині висхідного тренду або біля сильного рівня опору.
 * Візуально ідентичний Молоту (довгий нижній хвіст, мале тіло зверху).
 */
export const hangingManDetector: DetectorFn = ({ kline }) => {
  const range = getRange(kline);
  if (range === 0) return null;

  const body = getBody(kline);
  const lowerShadow = getLowerShadow(kline);
  const upperShadow = getUpperShadow(kline);

  // 1. "Довга нижня тінь, яка в 2-3 рази перевищує розмір тіла"
  const isLongTail = lowerShadow >= body * 2.0;

  // 2. "Верхня тінь або відсутня, або дуже коротка"
  const isShortUpperShadow = upperShadow <= range * 0.1;

  // 3. "Маленьке тіло свічки знаходиться у верхній частині"
  const isSmallBody = body <= range * 0.3;

  // У твоєму описі: "Червоне тіло підсилює сигнал, але не є обов'язковим".
  // Ми можемо залишити його гнучким, або зробити жорстким (isBearish), якщо хочемо менше ризику.
  // Залишаємо гнучким, бо рівень Опору (L Strength) відфільтрує зайве.

  return (isLongTail && isShortUpperShadow && isSmallBody) ? PatternType.HANGING_MAN : null;
};

/**
 * SHOOTING STAR (Падаюча зірка): Ведмежий розворотний патерн.
 * З'являється на вершині висхідного тренду. Показує, що покупці спробували прорватися вище,
 * але продавці перехопили ініціативу і жорстко опустили ціну.
 */
export const shootingStarDetector: DetectorFn = ({ kline }) => {
  const range = getRange(kline);
  if (range === 0) return null;

  const body = getBody(kline);
  const upperShadow = getUpperShadow(kline);
  const lowerShadow = getLowerShadow(kline);

  // 1. "Довга верхня тінь, яка у 2-3 рази більша за тіло свічки"
  const isLongUpperShadow = upperShadow >= body * 2.0;

  // 2. "Нижня тінь або відсутня, або дуже коротка"
  const isShortLowerShadow = lowerShadow <= range * 0.1;

  // 3. "Тіло свічки розташоване в нижній частині діапазону (мале тіло)"
  const isSmallBody = body <= range * 0.3;

  // Як зазначено в описі, червоне тіло підсилює сигнал, але форма сама по собі
  // вже є розворотною. Рівень Опору (L Strength) відфільтрує хибні входи.

  return (isLongUpperShadow && isShortLowerShadow && isSmallBody) ? PatternType.STAR : null;
};

/**
 * POWER BAR SHORT (Силова свічка / Ведмежий Марубозу): Патерн тотальної домінації продавців.
 * Дзеркальне відображення бичачого Power Bar. Свічка відкривається на максимумі,
 * продавці агресивно давлять ціну вниз і закривають її на самому "дні" без відкату.
 */
export const powerBarSHORT: DetectorFn = ({ kline }) => {
  const range = getRange(kline);
  if (range === 0) return null;

  const body = getBody(kline);
  const upper = getUpperShadow(kline);
  const lower = getLowerShadow(kline);

  // 1. Масивне тіло: продавці контролювали понад 75% всього руху свічки.
  const isSolidBody = body >= range * 0.75;

  // 2. Закриття "в підлогу": нижня тінь практично відсутня (макс 5%).
  // Покупців на дні свічки просто не було, падіння зупинилося лише через закриття таймфрейму.
  const isCleanBottom = lower <= range * 0.05;

  // 3. Невеликий хвіст зверху (до 20%): допускається мікро-спроба росту на самому відкритті.
  const hasSmallHead = upper <= range * 0.2;

  return (isBearish(kline) && isSolidBody && isCleanBottom && hasSmallHead) ? PatternType.MOMENTUM : null;
};

/**
 * ============================================================================
 * ДВОСВІЧКОВІ ПАТЕРНИ РОЗВОРОТУ (LONG)
 * ============================================================================
 */

/**
 * RAILS LONG (Рейки): Патерн миттєвого та жорсткого розвороту.
 * Складається з двох великих імпульсних свічок різного кольору, які стоять поруч і
 * мають майже ідентичний розмір. Візуально нагадують залізничні колії.
 * Психологія: Продавці зробили сильний ривок вниз, але наступної ж хвилини покупці
 * відповіли абсолютно симетричним ривком вгору. Це свідчить про наявність сильного
 * лімітного гравця, який зупинив падіння як бетонна стіна.
 */
export const railsLONG: DetectorFn = ({ kline, lastCandle, avgBody }) => {
  const b1 = getBody(lastCandle);
  const b2 = getBody(kline);
  const r1 = getRange(lastCandle);
  const r2 = getRange(kline);

  if (r1 === 0 || r2 === 0) return null;

  // 1. Обидві свічки мають бути великими (на 50% більші за середнє тіло на ринку)
  const areLarge = b1 > avgBody * 1.5 && b2 > avgBody * 1.5;

  // 2. Симетрія: тіла майже ідентичні за розміром (різниця менше 10%)
  const areEqual = Math.abs(b1 - b2) < b1 * 0.1;

  // 3. "Чистота" рейок: свічки майже не мають тіней (тіло займає 85%+ діапазону)
  const isClean = (b1 >= r1 * 0.85) && (b2 >= r2 * 0.85);

  return (isBullish(kline) && isBearish(lastCandle) && areLarge && areEqual && isClean)
    ? PatternType.RAILS : null;
};

/**
 * ABSORPTION LONG (Екстремальне поглинання / Поглинання з пробоєм).
 * Найсильніший вид поглинання. Поточна зелена свічка з'їдає не просто тіло,
 * а ВЕСЬ діапазон попередньої червоної свічки разом з її тінями.
 * Психологія: Покупці не лише відкупили все падіння, але й оновили локальний
 * максимум попередньої хвилини, повністю знищивши зусилля продавців.
 */
export const absorptionLONG: DetectorFn = ({ kline, lastCandle }) => {
  // Закриття вище хаю попередньої ТА відкриття нижче (або на рівні) лоу попередньої
  return (isBullish(kline) && kline.close > lastCandle.high && kline.open < lastCandle.low)
    ? PatternType.ABSORPTION : null;
};

/**
 * BULLISH ENGULFING (Класичне бичаче поглинання).
 * Стандартний і найпоширеніший розворотний патерн з двох свічок.
 * Психологія: Тіло нової зеленої свічки повністю перекриває тіло попередньої
 * червоної. Покупці змогли закрити ціну вище того рівня, з якого продавці
 * почали своє падіння в попередньому періоді.
 */
export const bullishEngulfing: DetectorFn = ({ kline, lastCandle }) => {
  return (isBullish(kline) && isBearish(lastCandle) &&
    kline.close >= lastCandle.open && kline.open <= lastCandle.close)
    ? PatternType.ENGULFING : null;
};


/**
 * ============================================================================
 * ДВОСВІЧКОВІ ПАТЕРНИ РОЗВОРОТУ (SHORT)
 * ============================================================================
 */

/**
 * RAILS SHORT (Рейки вниз).
 * Дзеркально до лонгових рейок. Покупці зробили імпульс вгору, але відразу
 * отримали "по голові" такою ж великою червоною свічкою.
 */
export const railsSHORT: DetectorFn = ({ kline, lastCandle, avgBody }) => {
  const b1 = getBody(lastCandle), b2 = getBody(kline);
  const r1 = getRange(lastCandle), r2 = getRange(kline);
  if (r1 === 0 || r2 === 0) return null;

  const areLarge = b1 > avgBody * 1.5 && b2 > avgBody * 1.5;
  const areEqual = Math.abs(b1 - b2) < b1 * 0.1;
  const isClean = (b1 >= r1 * 0.85) && (b2 >= r2 * 0.85);

  return (isBearish(kline) && isBullish(lastCandle) && areLarge && areEqual && isClean)
    ? PatternType.RAILS : null;
};

/**
 * ABSORPTION SHORT (Екстремальне поглинання вниз).
 * Червона свічка повністю перекриває весь діапазон (з тінями) попередньої зеленої.
 * Ціна закривається нижче мінімуму попередньої свічки, пробиваючи локальну підтримку.
 */
export const absorptionSHORT: DetectorFn = ({ kline, lastCandle }) => {
  return (isBearish(kline) && kline.close < lastCandle.low && kline.open > lastCandle.high)
    ? PatternType.ABSORPTION : null;
};

/**
 * BEARISH ENGULFING (Класичне ведмеже поглинання).
 * Тіло червоної свічки повністю "з'їдає" тіло попередньої зеленої.
 * Продавці перехопили ініціативу.
 */
export const bearishEngulfing: DetectorFn = ({ kline, lastCandle }) => {
  return (isBearish(kline) && isBullish(lastCandle) &&
    kline.close <= lastCandle.open && kline.open >= lastCandle.close)
    ? PatternType.ENGULFING : null;
};


/**
 * ============================================================================
 * РЕЄСТРИ ДЕТЕКТОРІВ (Порядок має значення: від складного до простого)
 * ============================================================================
 */

export const LONG_DETECTORS = [
  // 1. ДВОСВІЧКОВІ ПАТЕРНИ (Найбільше контексту, найвищий пріоритет)
  railsLONG,        // Сувора симетрія та чистота
  absorptionLONG,   // Перекриття всього діапазону (High-Low)
  bullishEngulfing, // Перекриття тільки тіла (Open-Close)

  // 2. ОДНОСВІЧКОВІ ПАТЕРНИ З ТІНЯМИ (Екстремальні розвороти)
  hammerDetector,
  invertedHammerDetector,

  // 3. ОДНОСВІЧКОВІ ІМПУЛЬСИ (Силові пробої)
  powerBarLONG,     // Якщо це не поглинання і не молот, але свічка сильна

  // 4. ПАТЕРНИ ЗУПИНКИ ТА КОНСОЛІДАЦІЇ (Нейтральні)
  dojiDetector,
  insideBarDetector
];

export const SHORT_DETECTORS = [
  // 1. ДВОСВІЧКОВІ ПАТЕРНИ (Найбільше контексту, найвищий пріоритет)
  railsSHORT,
  absorptionSHORT,
  bearishEngulfing,

  // 2. ОДНОСВІЧКОВІ ПАТЕРНИ З ТІНЯМИ (Екстремальні розвороти)
  hangingManDetector,
  shootingStarDetector,

  // 3. ОДНОСВІЧКОВІ ІМПУЛЬСИ (Силові пробої)
  powerBarSHORT,

  // 4. ПАТЕРНИ ЗУПИНКИ ТА КОНСОЛІДАЦІЇ (Нейтральні)
  dojiDetector,
  insideBarDetector
];