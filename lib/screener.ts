import yahooFinance from 'yahoo-finance2';

export interface ScreenResult {
  ticker: string;
  price: number;
  // IVR
  ivEstimate: number | null;
  ivrPass: boolean | null;
  ivrNote: string;
  // Earnings
  earningsDate: string | null;
  earningsPass: boolean;
  earningsNote: string;
  // Strategy suggestion
  strategy: 'BPS' | 'BCS' | 'IC' | 'SKIP' | null;
  // Options chain results
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
  // Overall
  verdict: 'PASS' | 'FAIL' | 'CHECK IVR';
  failReasons: string[];
}

function getDTE(expirationDate: string): number {
  const now = new Date();
  const exp = new Date(expirationDate);
  return Math.round((exp.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

function findBestExpiration(expirations: string[]): string | null {
  // Find expiration in 27-45 DTE window
  for (const exp of expirations) {
    const dte = getDTE(exp);
    if (dte >= 27 && dte <= 45) return exp;
  }
  return null;
}

export async function screenTicker(ticker: string): Promise<ScreenResult> {
  const result: ScreenResult = {
    ticker,
    price: 0,
    ivEstimate: null,
    ivrPass: null,
    ivrNote: 'Verify in TastyTrade',
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
    // Get quote data
    const quote = await yahooFinance.quote(ticker);
    result.price = quote.regularMarketPrice ?? 0;

    // Get earnings date
    const summary = await yahooFinance.quoteSummary(ticker, {
      modules: ['calendarEvents', 'defaultKeyStatistics'],
    });

    const earnings = summary.calendarEvents?.earnings;
    if (earnings?.earningsDate && earnings.earningsDate.length > 0) {
      result.earningsDate = earnings.earningsDate[0].toISOString().split('T')[0];
    }

    // Get options chain
    const optionsResult = await yahooFinance.options(ticker);
    const expirations = optionsResult.expirationDates.map(
      (d: Date) => d.toISOString().split('T')[0]
    );

    const bestExp = findBestExpiration(expirations);
    if (!bestExp) {
      result.failReasons.push('No expiration in 27-45 DTE window');
      result.verdict = 'FAIL';
      return result;
    }

    result.expiration = bestExp;
    result.dte = getDTE(bestExp);
    result.dtePass = result.dte >= 27 && result.dte <= 45;

    // Check earnings within window
    if (result.earningsDate && result.expiration) {
      const earningsTime = new Date(result.earningsDate).getTime();
      const expTime = new Date(result.expiration).getTime();
      if (earningsTime <= expTime) {
        result.earningsPass = false;
        result.earningsNote = `Earnings ${result.earningsDate} is within expiry`;
        result.failReasons.push(`Earnings within window (${result.earningsDate})`);
      }
    }

    // Get options chain for best expiration
    const chainData = await yahooFinance.options(ticker, { date: new Date(bestExp) });
    const puts = chainData.options[0]?.puts ?? [];
    const calls = chainData.options[0]?.calls ?? [];

    // Estimate IV from ATM options (rough IVR proxy)
    const atmPut = puts.find(
      (p: any) => Math.abs(p.strike - result.price) / result.price < 0.05
    );
    if (atmPut?.impliedVolatility) {
      result.ivEstimate = Math.round(atmPut.impliedVolatility * 100);
      // Rough IVR: if IV > 30% annualized, likely passes. Not the same as TastyTrade IVR.
      result.ivrPass = result.ivEstimate >= 30;
      result.ivrNote = `IV ~${result.ivEstimate}% — verify IVR in TastyTrade`;
      if (!result.ivrPass) {
        result.failReasons.push(`IV too low (~${result.ivEstimate}%) — likely IVR fail`);
      }
    }

    // Determine strategy from price trend (simplified: use 50-day vs current)
    const stats = summary.defaultKeyStatistics;
    // Default to BPS — user will confirm with chart
    result.strategy = 'BPS';

    // Find target put strike for BPS (delta ~0.15-0.20, roughly 8-12% OTM)
    const targetStrike = result.price * 0.88; // ~12% OTM as starting point
    const shortPut = puts
      .filter((p: any) => p.strike <= result.price * 0.92 && p.strike >= result.price * 0.80)
      .sort((a: any, b: any) => Math.abs(a.strike - targetStrike) - Math.abs(b.strike - targetStrike))[0];

    if (shortPut) {
      result.shortStrike = shortPut.strike;
      result.longStrike = shortPut.strike - 5;
      result.spreadWidth = 5;
      result.oi = shortPut.openInterest ?? 0;
      result.oiPass = result.oi >= 500;
      
      const bid = shortPut.bid ?? 0;
      const ask = shortPut.ask ?? 0;
      result.bidAsk = ask - bid;
      result.bidAskPass = result.bidAsk <= 0.10;
      result.delta = shortPut.delta ?? null;
      result.deltaPass = result.delta !== null 
        ? Math.abs(result.delta) >= 0.15 && Math.abs(result.delta) <= 0.22
        : null;

      // Get long put credit
      const longPut = puts.find((p: any) => p.strike === result.longStrike);
      const longPutBid = longPut?.bid ?? 0;
      result.credit = parseFloat((bid - longPutBid).toFixed(2));
      result.creditPass = result.credit >= result.spreadWidth / 3;

      result.chainChecked = true;

      if (!result.oiPass) result.failReasons.push(`OI ${result.oi} < 500`);
      if (!result.bidAskPass) result.failReasons.push(`Bid-ask $${result.bidAsk?.toFixed(2)} > $0.10`);
      if (result.deltaPass === false) result.failReasons.push(`Delta ${result.delta?.toFixed(2)} outside 0.15-0.22`);
      if (!result.creditPass) result.failReasons.push(`Credit $${result.credit} < 1/3 width ($${(result.spreadWidth/3).toFixed(2)})`);
    } else {
      result.failReasons.push('No suitable strike found');
    }

    // Final verdict
    if (result.failReasons.length === 0) {
      result.verdict = result.ivrPass === null ? 'CHECK IVR' : 'PASS';
    } else if (result.failReasons.every(r => r.includes('IVR') || r.includes('IV'))) {
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
