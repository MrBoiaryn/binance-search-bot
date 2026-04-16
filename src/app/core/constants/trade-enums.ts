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
  PIN_BAR = 'PinBar',
  ENGULFING = 'Engulfing',
  RAILS = 'Rails',
  ABSORPTION = 'Absorption',
  MOMENTUM = 'Momentum',
  STAR = 'Star'
}

export enum TimeframeUnit {
  MINUTES = 'm',
  HOURS = 'h',
  DAYS = 'd'
}
