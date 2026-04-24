'use client';
import { useState } from 'react';

interface ScreenResult {
  ticker: string;
  price: number;
  ivEstimate: number | null;
  ivrPass: boolean | null;
  ivrNote: string;
  earningsDate: string | null;
  earningsPass: boolean;
  strategy: string | null;
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
  verdict: 'PASS' | 'FAIL' | 'CHECK IVR';
  failReasons: string[];
}

function getDTE(dateStr: string) {
  return Math.round((new Date(dateStr).getTime() - Date.now()) / 86400000);
}

async function api(ticker: string, type: string) {
  const res = await fetch(`/api/screen?ticker=${ticker}&type=${type}`);
  if (!res.ok) throw new Error(`API error ${res.status}`);
  return res.json();
}

async function screenTicker(ticker: string): Promise<ScreenResult> {
  const r: ScreenResult = {
    ticker, price: 0, ivEstimate: null, ivrPass: null,
    ivrNote: 'Verify IVR in TastyTrade', earningsDate: null,
    earningsPass: true, strategy: null, shortStrike: null,
    longStrike: null, credit: null, spreadWidth: null, creditPass: null,
    delta: null, deltaPass: null, oi: null, oiPass: null,
    bidAsk: null, bidAskPass: null, expiration: null, dte: null,
    verdict: 'FAIL', failReasons: [],
  };

  try {
    // Get quote
    const quoteData = await api(ticker, 'quote');
    const quote = Array.isArray(quoteData) ? quoteData[0] : quoteData;
    if (!quote) throw new Error('No quote data');
    r.price = quote.price ?? 0;

    // 52-week position for strategy
    const low = quote.yearLow ?? 0;
    const high = quote.yearHigh ?? 0;
    const pos = (high - low) > 0 ? (r.price - low) / (high - low) : 0.5;
    r.strategy = pos > 0.6 ? 'BPS' : pos < 0.4 ? 'BCS' : 'IC';

    // Get earnings
    const earningsData = await api(ticker, 'earnings');
    if (Array.isArray(earningsData) && earningsData.length > 0) {
      const upcoming = earningsData.find((e: any) => new Date(e.date) > new Date());
      if (upcoming) r.earningsDate = upcoming.date;
    }

    // Get options chain
    const chainData = await api(ticker, 'chain');
    const contracts = Array.isArray(chainData) ? chainData : (chainData?.optionChain ?? []);

    if (!contracts.length) {
      r.failReasons.push('No options chain data available');
      return r;
    }

    // Find puts in 27-45 DTE window
    const puts = contracts.filter((c: any) => 
      c.putCall === 'PUT' && 
      getDTE(c.expirationDate) >= 27 && 
      getDTE(c.expirationDate) <= 45
    );

    if (!puts.length) {
      r.failReasons.push('No puts in 27-45 DTE window');
      return r;
    }

    // Get the best expiration
    const expirations = [...new Set(puts.map((p: any) => p.expirationDate as string))].sort();
    const bestExp = expirations[0];
    r.expiration = bestExp;
    r.dte = getDTE(bestExp);

    // Check earnings within window
    if (r.earningsDate && r.expiration && r.earningsDate <= r.expiration) {
      r.earningsPass = false;
      r.failReasons.push(`Earnings within window (${r.earningsDate})`);
    }

    // Get puts for best expiration
    const expPuts = puts.filter((p: any) => p.expirationDate === bestExp);

    // Estimate IV from ATM put
    const atmPut = expPuts
      .filter((p: any) => Math.abs(p.strike - r.price) / r.price < 0.05)
      .sort((a: any, b: any) => Math.abs(a.strike - r.price) - Math.abs(b.strike - r.price))[0];

    if (atmPut?.impliedVolatility != null) {
      r.ivEstimate = Math.round(atmPut.impliedVolatility * 100);
      r.ivrPass = r.ivEstimate >= 30;
      r.ivrNote = `IV ~${r.ivEstimate}% — verify IVR in TastyTrade`;
      if (!r.ivrPass) r.failReasons.push(`IV too low (~${r.ivEstimate}%)`);
    }

    // Find short put target ~10-12% OTM
    const target = r.price * 0.88;
    const sp = expPuts
      .filter((p: any) => p.strike <= r.price * 0.93 && p.strike >= r.price * 0.78)
      .sort((a: any, b: any) => Math.abs(a.strike - target) - Math.abs(b.strike - target))[0];

    if (sp) {
      r.shortStrike = sp.strike;
      r.longStrike = parseFloat((sp.strike - 5).toFixed(2));
      r.spreadWidth = 5;
      r.oi = sp.openInterest ?? 0;
      r.oiPass = (r.oi ?? 0) >= 500;
      const bid = sp.bid ?? 0, ask = sp.ask ?? 0;
      r.bidAsk = parseFloat((ask - bid).toFixed(2));
      r.bidAskPass = r.bidAsk <= 0.10;
      r.delta = sp.delta != null ? parseFloat(sp.delta.toFixed(2)) : null;
      if (r.delta === null) {
        const mn = sp.strike / r.price;
        r.delta = parseFloat((mn > 0.95 ? -0.30 : mn > 0.90 ? -0.20 : mn > 0.85 ? -0.12 : -0.08).toFixed(2));
      }
      r.deltaPass = Math.abs(r.delta) >= 0.15 && Math.abs(r.delta) <= 0.22;
      const lp = expPuts
        .filter((p: any) => p.strike < sp.strike)
        .sort((a: any, b: any) => Math.abs(a.strike - r.longStrike!) - Math.abs(b.strike - r.longStrike!))[0];
      r.credit = parseFloat(Math.max(0, bid - (lp?.bid ?? 0)).toFixed(2));
      r.creditPass = r.credit >= r.spreadWidth / 3;

      if (!r.oiPass) r.failReasons.push(`OI ${r.oi} < 500`);
      if (!r.bidAskPass) r.failReasons.push(`Bid-ask $${r.bidAsk} > $0.10`);
      if (!r.deltaPass) r.failReasons.push(`Delta ~${r.delta} outside 0.15-0.22`);
      if (!r.creditPass) r.failReasons.push(`Credit $${r.credit} < min $${(r.spreadWidth / 3).toFixed(2)}`);
    } else {
      r.failReasons.push('No suitable strike found');
    }

    const nonIvr = r.failReasons.filter(x => !x.includes('IV'));
    r.verdict = nonIvr.length === 0 && r.failReasons.length === 0 ? 'PASS'
      : nonIvr.length === 0 ? 'CHECK IVR' : 'FAIL';

  } catch (e: any) {
    r.failReasons.push(`Error: ${e.message}`);
  }
  return r;
}

function Badge({ pass, label }: { pass: boolean | null; label: string }) {
  const cls = pass === null ? 'badge-unknown' : pass ? 'badge-pass' : 'badge-fail';
  return <span className={`badge ${cls}`}>{pass === null ? `${label} ?` : pass ? `✓ ${label}` : `✗ ${label}`}</span>;
}

function Verdict({ v }: { v: string }) {
  const cls = v === 'PASS' ? 'verdict-pass' : v === 'CHECK IVR' ? 'verdict-check' : 'verdict-fail';
  return <span className={`verdict ${cls}`}>{v}</span>;
}

export default function Home() {
  const [input, setInput] = useState('MU, NVDA, AAPL, JPM, BAC');
  const [results, setResults] = useState<ScreenResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [progress, setProgress] = useState('');

  async function run() {
    setLoading(true); setError(''); setResults([]);
    try {
      const tickers = input.split(/[\s,]+/).filter(Boolean);
      const out: ScreenResult[] = [];
      for (const t of tickers) {
        setProgress(`Screening ${t.toUpperCase()}...`);
        const r = await screenTicker(t.trim().toUpperCase());
        out.push(r);
        setResults([...out]);
      }
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); setProgress(''); }
  }

  const passes = results.filter(r => r.verdict === 'PASS');
  const checks = results.filter(r => r.verdict === 'CHECK IVR');
  const fails = results.filter(r => r.verdict === 'FAIL');

  return (
    <>
      <style>{`
        *{box-sizing:border-box;margin:0;padding:0}
        body{background:#0a0a0f;color:#e2e8f0;font-family:'Courier New',monospace;min-height:100vh}
        .wrap{max-width:1100px;margin:0 auto;padding:2rem}
        h1{font-size:1.4rem;font-weight:700;letter-spacing:.1em;color:#f8fafc}
        .sub{font-size:.7rem;color:#64748b;margin-top:.25rem}
        .rules{display:flex;gap:.5rem;flex-wrap:wrap;margin-top:.75rem}
        .rule{font-size:.62rem;color:#475569;border:1px solid #1e293b;padding:.2rem .45rem;border-radius:3px}
        .box{background:#0f172a;border:1px solid #1e293b;border-radius:8px;padding:1.25rem;margin-bottom:1.5rem}
        label{font-size:.65rem;color:#64748b;letter-spacing:.1em;display:block;margin-bottom:.4rem}
        textarea{width:100%;background:#020617;border:1px solid #1e293b;color:#e2e8f0;padding:.65rem;border-radius:5px;font-family:'Courier New',monospace;font-size:.82rem;resize:vertical;min-height:70px;outline:none}
        textarea:focus{border-color:#3b82f6}
        .note{font-size:.62rem;color:#475569;margin-top:.4rem}
        button{background:#3b82f6;color:#fff;border:none;padding:.65rem 1.75rem;border-radius:5px;font-family:'Courier New',monospace;font-size:.82rem;cursor:pointer;margin-top:.75rem;letter-spacing:.05em}
        button:hover{background:#2563eb}
        button:disabled{background:#1e293b;color:#475569;cursor:not-allowed}
        .prog{font-size:.72rem;color:#64748b;margin-top:.5rem}
        .err{background:#450a0a;border:1px solid #7f1d1d;color:#fca5a5;padding:.75rem;border-radius:5px;font-size:.78rem;margin-bottom:1rem}
        .sum{display:grid;grid-template-columns:repeat(3,1fr);gap:1rem;margin-bottom:1.5rem}
        .sc{background:#0f172a;border:1px solid #1e293b;border-radius:8px;padding:.9rem;text-align:center}
        .sn{font-size:1.8rem;font-weight:700}
        .sl{font-size:.62rem;color:#64748b;letter-spacing:.1em;margin-top:.2rem}
        .np{color:#22c55e}.nc{color:#f59e0b}.nf{color:#ef4444}
        .card{background:#0f172a;border:1px solid #1e293b;border-radius:8px;padding:1.1rem;margin-bottom:.65rem}
        .ch{display:flex;justify-content:space-between;align-items:center;margin-bottom:.75rem}
        .tn{font-size:1rem;font-weight:700;color:#f8fafc}
        .tp{font-size:.75rem;color:#64748b;margin-left:.4rem}
        .badges{display:flex;gap:.35rem;flex-wrap:wrap;margin-bottom:.6rem}
        .badge{font-size:.62rem;padding:.18rem .45rem;border-radius:3px;font-weight:600}
        .badge-pass{background:#14532d;color:#86efac;border:1px solid #166534}
        .badge-fail{background:#450a0a;color:#fca5a5;border:1px solid #7f1d1d}
        .badge-unknown{background:#1c1917;color:#a8a29e;border:1px solid #292524}
        .verdict{font-size:.72rem;font-weight:700;padding:.25rem .65rem;border-radius:3px;letter-spacing:.05em}
        .verdict-pass{background:#14532d;color:#86efac;border:1px solid #166534}
        .verdict-fail{background:#450a0a;color:#fca5a5;border:1px solid #7f1d1d}
        .verdict-check{background:#451a03;color:#fcd34d;border:1px solid #78350f}
        .ivn{font-size:.68rem;color:#fbbf24;margin-top:.45rem;padding:.4rem .6rem;background:#1c1003;border:1px solid #78350f;border-radius:3px}
        .td{display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:.4rem;margin-top:.65rem}
        .d{background:#020617;border:1px solid #1e293b;border-radius:3px;padding:.4rem .5rem}
        .dl{font-size:.58rem;color:#64748b;letter-spacing:.04em}
        .dv{font-size:.82rem;color:#e2e8f0;margin-top:.08rem;font-weight:600}
        .fr{font-size:.67rem;color:#f87171;padding:.15rem 0}
        .frs{margin-top:.6rem}
      `}</style>
      <div className="wrap">
        <div style={{borderBottom:'1px solid #1e293b',paddingBottom:'1.25rem',marginBottom:'1.5rem'}}>
          <h1>OPTIONS SCREENER</h1>
          <div className="sub">FMP Data · BPS / BCS / IC · IVR Must Be Verified in TastyTrade</div>
          <div className="rules">
            {['IVR ≥ 30 (verify TT)','OI ≥ 500','Delta 0.15–0.22','Credit ≥ ⅓ width','Bid-ask ≤ $0.10','DTE 27–45','No earnings in window'].map(r=><span key={r} className="rule">{r}</span>)}
          </div>
        </div>

        <div className="box">
          <label>TICKERS (comma or space separated)</label>
          <textarea value={input} onChange={e=>setInput(e.target.value)} />
          <div className="note">⚠ IV shown is raw implied volatility, NOT IVR. Always verify IVR in TastyTrade before entering any trade.</div>
          <button onClick={run} disabled={loading}>{loading ? 'SCREENING...' : 'RUN SCREEN'}</button>
          {progress && <div className="prog">{progress}</div>}
        </div>

        {error && <div className="err">{error}</div>}

        {results.length > 0 && <>
          <div className="sum">
            <div className="sc"><div className="sn np">{passes.length}</div><div className="sl">PASS</div></div>
            <div className="sc"><div className="sn nc">{checks.length}</div><div className="sl">CHECK IVR</div></div>
            <div className="sc"><div className="sn nf">{fails.length}</div><div className="sl">FAIL</div></div>
          </div>
          {[...passes,...checks,...fails].map(r=>(
            <div key={r.ticker} className="card">
              <div className="ch">
                <div><span className="tn">{r.ticker}</span>{r.price>0&&<span className="tp">${r.price.toFixed(2)}</span>}</div>
                <Verdict v={r.verdict}/>
              </div>
              <div className="badges">
                <Badge pass={r.ivrPass} label="IVR"/>
                <Badge pass={r.earningsPass} label="Earnings"/>
                <Badge pass={r.oiPass} label="OI"/>
                <Badge pass={r.deltaPass} label="Delta"/>
                <Badge pass={r.creditPass} label="Credit"/>
                <Badge pass={r.bidAskPass} label="Bid-Ask"/>
                <Badge pass={r.dte!==null?r.dte>=27&&r.dte<=45:null} label="DTE"/>
              </div>
              {r.ivrNote&&<div className="ivn">⚠ {r.ivrNote}</div>}
              {r.shortStrike&&<div className="td">
                {([['STRATEGY',r.strategy],['EXPIRY',r.expiration],['DTE',r.dte],
                  ['SHORT/LONG',`${r.shortStrike}/${r.longStrike}`],
                  ['CREDIT',r.credit!=null?`$${r.credit.toFixed(2)}`:'—'],
                  ['WIDTH',r.spreadWidth?`$${r.spreadWidth}`:'—'],
                  ['DELTA',r.delta?.toFixed(2)],
                  ['OI',r.oi?.toLocaleString()],
                  ['BID-ASK',r.bidAsk!=null?`$${r.bidAsk.toFixed(2)}`:'—'],
                ] as [string,any][]).map(([label,val])=>(
                  <div key={label} className="d">
                    <div className="dl">{label}</div>
                    <div className="dv">{val??'—'}</div>
                  </div>
                ))}
              </div>}
              {r.failReasons.length>0&&<div className="frs">{r.failReasons.map((f,i)=><div key={i} className="fr">✗ {f}</div>)}</div>}
            </div>
          ))}
        </>}
      </div>
    </>
  );
}
