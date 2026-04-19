export enum SignalSide {
  LONG = 'LONG',
  SHORT = 'SHORT'
}

export enum PositionStatus {
  PENDING = 'PENDING',
  OPENED = 'OPENED',
  SL = 'SL',
  TP = 'TP',
  CANCELLED = 'CANCELLED',
  EXPIRED = 'EXPIRED',
  ALL = 'ALL'
}

export enum MarketType {
  FUTURES = 'futures',
  SPOT = 'spot'
}

export enum LevelType {
  SUPPORT = 'SUPPORT',
  RESISTANCE = 'RESISTANCE'
}

export enum PatternType {
  DOJI = 'Doji',
  INSIDE = 'Inside',
  HAMMER = 'Hammer',
  ENGULFING = 'Engulfing',
  RAILS = 'Rails',
  ABSORPTION = 'Absorption',
  MOMENTUM = 'Momentum',
  STAR = 'Star',
  HANGING_MAN = 'HangingMan',
  INVERTED_HAMMER = 'InvertedHammer'
}

export enum TimeframeUnit {
  MINUTES = 'm',
  HOURS = 'h',
  DAYS = 'd'
}

export enum BinanceEventType {
  KLINE = 'kline',
  LIQUIDATION = 'liquidation',
  FORCE_ORDER = 'forceOrder' // Added for raw Binance event
}

export enum BinanceFilterType {
  PRICE_FILTER = 'PRICE_FILTER',
  LOT_SIZE = 'LOT_SIZE',
  MIN_NOTIONAL = 'MIN_NOTIONAL'
}
