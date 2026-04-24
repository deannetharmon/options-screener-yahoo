import { NextRequest, NextResponse } from 'next/server';
import { screenTicker } from '@/lib/screener';

export async function POST(req: NextRequest) {
  try {
    const { tickers } = await req.json();
    if (!tickers || !Array.isArray(tickers) || tickers.length === 0) {
      return NextResponse.json({ error: 'Tickers array required' }, { status: 400 });
    }

    const results = await Promise.allSettled(
      tickers.map((ticker: string) => screenTicker(ticker.trim().toUpperCase()))
    );

    const data = results.map((r, i) => {
      if (r.status === 'fulfilled') return r.value;
      return {
        ticker: tickers[i],
        verdict: 'FAIL',
        failReasons: [`Error: ${r.reason?.message || 'Unknown error'}`],
      };
    });

    return NextResponse.json({ results: data });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
