import { NextRequest, NextResponse } from 'next/server';

const FMP = 'https://financialmodelingprep.com/api/v3';
const KEY = process.env.FMP_API_KEY;

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const ticker = searchParams.get('ticker');
  const type = searchParams.get('type');

  if (!ticker) return NextResponse.json({ error: 'ticker required' }, { status: 400 });
  if (!KEY) return NextResponse.json({ error: 'FMP_API_KEY not configured' }, { status: 500 });

  try {
    let url = '';
    if (type === 'quote') {
      url = `${FMP}/quote/${ticker}?apikey=${KEY}`;
    } else if (type === 'options') {
      url = `${FMP}/historical-price-full/stock_dividend/${ticker}?apikey=${KEY}`;
    } else if (type === 'chain') {
      url = `https://financialmodelingprep.com/api/v4/options/chain?symbol=${ticker}&apikey=${KEY}`;
    } else if (type === 'earnings') {
      url = `${FMP}/earning_calendar?symbol=${ticker}&apikey=${KEY}`;
    }

    const res = await fetch(url);
    if (!res.ok) return NextResponse.json({ error: `FMP error ${res.status}` }, { status: res.status });
    const data = await res.json();
    return NextResponse.json(data);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
