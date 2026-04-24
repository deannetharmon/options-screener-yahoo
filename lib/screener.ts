export interface ScreenResult {
  ticker: string;
  price: number;
  ivEstimate: number | null;
  ivrPass: boolean | null;
  ivrNote: string;
  earningsDate: string | null;
  earningsPass: boolean;
  earningsNote: string;
  strategy: 'BPS' | 'BCS' | 'IC' | 'SKIP' | null;
  chainChecked: boolean;
  shortStrike: number | null;
  longStrike: number | null;
  credit: number | null;
  spreadWidth: number | null;
  creditPass: boolean | null;
  delta: number | null;
  deltaPass: boolean | null;
  oi: number | null;
  oiPass: boolean | null;
  bidAsk: number | null;
  bidAskPass: boolean | null;
  expiration: string | null;
  dte: number | null;
  dtePass: boolean | null;
  verdict: 'PASS' | 'FAIL' | 'CHECK IVR';
  failReasons: string[];
}

function getDTE(expirationTimestamp: number): number {
  const now = Date.now();
  return Math.round((expirationTimestamp * 1000 - now) / (1000 * 60 * 60 * 24));
}

function formatDate(timestamp: number): string {
  return new Date(timestamp * 1000).toISOString().split('T')[0];
}

async function yahooFetch(url: string) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; options-screener/1.0)',
      'Accept': 'application/json',
    },
  });
  if (!res.ok) throw new Error(`Yahoo fetch failed: ${res.status} ${res.statusText}`);
  return res.json();
}

export async function screenTicker(ticker: string): Promise<ScreenResult> {
  const result: ScreenResult = {
    ticker,
    price: 0,
    ivEstimate: null,
    ivrPass: null,
    ivrNote: 'Verify IVR in TastyTrade',
    earningsDate: null,
    earningsPass: true,
    earningsNote: '',
    strategy: null,
    chainChecked: false,
    shortStrike: null,
    longStrike: null,
    credit: null,
    spreadWidth: null,
    creditPass: null,
    delta: null,
    deltaPass: null,
    oi: null,
    oiPass: null,
    bidAsk: null,
    bidAskPass: null,
    expiration: null,
    dte: null,
    dtePass: null,
    verdict: 'FAIL',
    failReasons: [],
  };

  try {
    const quoteUrl = `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${ticker}?modules=price,calendarEvents`;
    const quoteData = await yahooFetch(quoteUrl);
    const summary = quoteData?.quoteSummary?.result?.[0];
    if (!summary) throw new Error('No data returned from Yahoo Finance');

    result.price = summary.price?.regularMarketPrice?.raw ?? 0;

    const earningsDates = summary.calendarEvents?.earnings?.earningsDate;
    if (earningsDates && earningsDates.length > 0) {
      result.earningsDate = formatDate(earningsDates[0].raw);
    }

    const optUrl = `https://query1.finance.yahoo.com/v7/finance/options/${ticker}`;
    const optData = await yahooFetch(optUrl);
    const optResult = optData?.optionChain?.result?.[0];
    if (!optResult) throw new Error('No options data');

    const expirations: number[] = optResult.expirationDates ?? [];
    const bestExp = expirations.find(ts => {
      const dte = getDTE(ts);
      return dte >= 27 && dte <= 45;
    });

    if (!bestExp) {
      result.failReasons.push('No expiration in 27-45 DTE window');
      result.verdict = 'FAIL';
      return result;
    }

    result.expiration = formatDate(bestExp);
    result.dte = getDTE(bestExp);
    result.dtePass = result.dte >= 27 && result.dte <= 45;

    if (result.earningsDate && result.expiration) {
      if (result.earningsDate <= result.expiration) {
        result.earningsPass = false;
        result.earningsNote = `Earnings ${result.earningsDate} within expiry`;
        result.failReasons.push(`Earnings within window (${result.earningsDate})`);
      }
    }

    const chainUrl = `https://query1.finance.yahoo.com/v7/finance/options/${ticker}?date=${bestExp}`;
    const chainData = await yahooFetch(chainUrl);
    const chain = chainData?.optionChain?.result?.[0];
    const puts = chain?.options?.[0]?.puts ?? [];

    const atmPut = puts
      .filter((p: any) => p.strike && Math.abs(p.strike - result.price) / result.price < 0.05)
      .sort((a: any, b: any) => Math.abs(a.strike - result.price) - Math.abs(b.strike - result.price))[0];

    if (atmPut?.impliedVolatility) {
      result.ivEstimate = Math.round(atmPut.impliedVolatility * 100);
      result.ivrPass = result.ivEstimate >= 30;
      result.ivrNote = `IV ~${result.ivEstimate}% — verify IVR in TastyTrade`;
      if (!result.ivrPass) {
        result.failReasons.push(`IV too low (~${result.ivEstimate}%) — likely IVR fail`);
      }
    }

    const fiftyTwoWeekLow = summary.price?.fiftyTwoWeekLow?.raw ?? 0;
    const fiftyTwoWeekHigh = summary.price?.fiftyTwoWeekHigh?.raw ?? 0;
    const range = fiftyTwoWeekHigh - fiftyTwoWeekLow;
    const position = range > 0 ? (result.price - fiftyTwoWeekLow) / range : 0.5;
    if (position > 0.6) result.strategy = 'BPS';
    else if (position < 0.4) result.strategy = 'BCS';
    else result.strategy = 'IC';

    const targetStrike = result.price * 0.88;
    const shortPut = puts
      .filter((p: any) => p.strike <= result.price * 0.93 && p.strike >= result.price * 0.78)
      .sort((a: any, b: any) => Math.abs(a.strike - targetStrike) - Math.abs(b.strike - targetStrike))[0];

    if (shortPut) {
      result.shortStrike = shortPut.strike;
      result.longStrike = parseFloat((shortPut.strike - 5).toFixed(2));
      result.spreadWidth = 5;
      result.oi = shortPut.openInterest ?? 0;
      result.oiPass = (result.oi ?? 0) >= 500;

      const bid = shortPut.bid ?? 0;
      const ask = shortPut.ask ?? 0;
      result.bidAsk = parseFloat((ask - bid).toFixed(2));
      result.bidAskPass = result.bidAsk <= 0.10;

      const moneyness = shortPut.strike / result.price;
      result.delta = parseFloat((moneyness > 0.95 ? -0.30 : moneyness > 0.90 ? -0.20 : moneyness > 0.85 ? -0.12 : -0.08).toFixed(2));
      result.deltaPass = Math.abs(result.delta) >= 0.15 && Math.abs(result.delta) <= 0.22;

      const longPut = puts
        .filter((p: any) => p.strike < shortPut.strike)
        .sort((a: any, b: any) => Math.abs(a.strike - result.longStrike!) - Math.abs(b.strike - result.longStrike!))[0];

      const longPutBid = longPut?.bid ?? 0;
      result.credit = parseFloat(Math.max(0, bid - longPutBid).toFixed(2));
      result.creditPass = result.credit >= result.spreadWidth / 3;
      result.chainChecked = true;

      if (!result.oiPass) result.failReasons.push(`OI ${result.oi} < 500`);
      if (!result.bidAskPass) result.failReasons.push(`Bid-ask $${result.bidAsk} > $0.10`);
      if (!result.deltaPass) result.failReasons.push(`Delta ~${result.delta} outside 0.15-0.22`);
      if (!result.creditPass) result.failReasons.push(`Credit $${result.credit} < min $${(result.spreadWidth / 3).toFixed(2)}`);
    } else {
      result.failReasons.push('No suitable strike found in options chain');
    }

    const nonIvrFails = result.failReasons.filter(r => !r.includes('IV'));
    if (nonIvrFails.length === 0 && result.failReasons.length === 0) {
      result.verdict = 'PASS';
    } else if (nonIvrFails.length === 0 && result.failReasons.length > 0) {
      result.verdict = 'CHECK IVR';
    } else {
      result.verdict = 'FAIL';
    }

  } catch (err: any) {
    result.failReasons.push(`Error: ${err.message}`);
    result.verdict = 'FAIL';
  }

  return result;
}
