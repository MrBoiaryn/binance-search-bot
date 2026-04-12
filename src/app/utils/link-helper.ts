// src/app/utils/link-helper.ts

export function generateBinanceLink(
  symbol: string,
  marketType: 'spot' | 'futures',
  quoteAsset: string = 'USDT'
): string {
  const sym = symbol.toUpperCase();

  if (marketType === 'spot') {
    const quote = quoteAsset.toUpperCase();
    // Залишаємо правильний формат для Споту: BTC_USDT
    const formattedSpot = sym.endsWith(quote)
      ? sym.slice(0, sym.length - quote.length) + '_' + quote
      : sym;

    return `https://www.binance.com/uk-UA/trade/${formattedSpot}?type=spot`;
  }

  // Для Ф'ючерсів просто прямий лінк
  return `https://www.binance.com/uk-UA/futures/${sym}`;
}