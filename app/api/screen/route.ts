import { NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const ticker = searchParams.get('ticker');
  const type = searchParams.get('type') || 'quote';
  const date = searchParams.get('date');

  if (!ticker) return NextResponse.json({ error: 'Ticker required' }, { status: 400 });

  let url = '';
  if (type === 'quote') {
    url = `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${ticker}?modules=price,calendarEvents`;
  } else if (type === 'options') {
    url = date
      ? `https://query2.finance.yahoo.com/v7/finance/options/${ticker}?date=${date}`
      : `https://query2.finance.yahoo.com/v7/finance/options/${ticker}`;
  }

  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': 'https://finance.yahoo.com/',
        'Origin': 'https://finance.yahoo.com',
      },
    });

    if (!res.ok) {
      return NextResponse.json({ error: `Yahoo returned ${res.status}` }, { status: res.status });
    }

    const data = await res.json();
    return NextResponse.json(data);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
