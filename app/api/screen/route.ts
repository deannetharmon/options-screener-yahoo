import { NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const path = searchParams.get('path');
  if (!path) return NextResponse.json({ error: 'path required' }, { status: 400 });

  const url = `https://query2.finance.yahoo.com${path}`;
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json',
        'Referer': 'https://finance.yahoo.com/',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });
    if (!res.ok) return NextResponse.json({ error: `Yahoo ${res.status}` }, { status: res.status });
    const data = await res.json();
    return NextResponse.json(data);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
