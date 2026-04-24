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

function Badge({ pass, label }: { pass: boolean | null; label: string }) {
  if (pass === null) return <span className="badge badge-unknown">{label} ?</span>;
  return (
    <span className={`badge ${pass ? 'badge-pass' : 'badge-fail'}`}>
      {pass ? '✓' : '✗'} {label}
    </span>
  );
}

function VerdictBadge({ verdict }: { verdict: string }) {
  const styles: Record<string, string> = {
    PASS: 'verdict-pass',
    FAIL: 'verdict-fail',
    'CHECK IVR': 'verdict-check',
  };
  return <span className={`verdict ${styles[verdict] || 'verdict-fail'}`}>{verdict}</span>;
}

export default function Home() {
  const [tickerInput, setTickerInput] = useState('MU, NVDA, AAPL, JPM, BAC');
  const [results, setResults] = useState<ScreenResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function runScreen() {
    setLoading(true);
    setError('');
    setResults([]);
    try {
      const tickers = tickerInput.split(/[\s,]+/).filter(Boolean);
      const res = await fetch('/api/screen', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tickers }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Screen failed');
      setResults(data.results);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  const passes = results.filter(r => r.verdict === 'PASS');
  const checkIvr = results.filter(r => r.verdict === 'CHECK IVR');
  const fails = results.filter(r => r.verdict === 'FAIL');

  return (
    <>
      <style>{`
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { background: #0a0a0f; color: #e2e8f0; font-family: 'Courier New', monospace; min-height: 100vh; }
        .container { max-width: 1200px; margin: 0 auto; padding: 2rem; }
        header { border-bottom: 1px solid #1e293b; padding-bottom: 1.5rem; margin-bottom: 2rem; }
        h1 { font-size: 1.5rem; font-weight: 700; letter-spacing: 0.1em; color: #f8fafc; }
        .subtitle { font-size: 0.75rem; color: #64748b; margin-top: 0.25rem; letter-spacing: 0.05em; }
        .rules { display: flex; gap: 1rem; flex-wrap: wrap; margin-top: 1rem; }
        .rule { font-size: 0.65rem; color: #475569; border: 1px solid #1e293b; padding: 0.25rem 0.5rem; border-radius: 4px; }
        .input-area { background: #0f172a; border: 1px solid #1e293b; border-radius: 8px; padding: 1.5rem; margin-bottom: 2rem; }
        label { font-size: 0.7rem; color: #64748b; letter-spacing: 0.1em; display: block; margin-bottom: 0.5rem; }
        textarea { width: 100%; background: #020617; border: 1px solid #1e293b; color: #e2e8f0; padding: 0.75rem; border-radius: 6px; font-family: 'Courier New', monospace; font-size: 0.85rem; resize: vertical; min-height: 80px; outline: none; }
        textarea:focus { border-color: #3b82f6; }
        .note { font-size: 0.65rem; color: #475569; margin-top: 0.5rem; }
        button { background: #3b82f6; color: white; border: none; padding: 0.75rem 2rem; border-radius: 6px; font-family: 'Courier New', monospace; font-size: 0.85rem; cursor: pointer; margin-top: 1rem; letter-spacing: 0.05em; }
        button:hover { background: #2563eb; }
        button:disabled { background: #1e293b; color: #475569; cursor: not-allowed; }
        .error { background: #450a0a; border: 1px solid #7f1d1d; color: #fca5a5; padding: 1rem; border-radius: 6px; font-size: 0.8rem; margin-bottom: 1rem; }
        .summary { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1rem; margin-bottom: 2rem; }
        .summary-card { background: #0f172a; border: 1px solid #1e293b; border-radius: 8px; padding: 1rem; text-align: center; }
        .summary-num { font-size: 2rem; font-weight: 700; }
        .summary-label { font-size: 0.65rem; color: #64748b; letter-spacing: 0.1em; margin-top: 0.25rem; }
        .num-pass { color: #22c55e; }
        .num-check { color: #f59e0b; }
        .num-fail { color: #ef4444; }
        .section-title { font-size: 0.7rem; color: #64748b; letter-spacing: 0.1em; margin-bottom: 0.75rem; margin-top: 1.5rem; }
        .card { background: #0f172a; border: 1px solid #1e293b; border-radius: 8px; padding: 1.25rem; margin-bottom: 0.75rem; }
        .card-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; }
        .ticker-name { font-size: 1.1rem; font-weight: 700; color: #f8fafc; }
        .ticker-price { font-size: 0.8rem; color: #64748b; margin-left: 0.5rem; }
        .badges { display: flex; gap: 0.4rem; flex-wrap: wrap; margin-bottom: 0.75rem; }
        .badge { font-size: 0.65rem; padding: 0.2rem 0.5rem; border-radius: 4px; font-weight: 600; }
        .badge-pass { background: #14532d; color: #86efac; border: 1px solid #166534; }
        .badge-fail { background: #450a0a; color: #fca5a5; border: 1px solid #7f1d1d; }
        .badge-unknown { background: #1c1917; color: #a8a29e; border: 1px solid #292524; }
        .verdict { font-size: 0.75rem; font-weight: 700; padding: 0.3rem 0.75rem; border-radius: 4px; letter-spacing: 0.05em; }
        .verdict-pass { background: #14532d; color: #86efac; border: 1px solid #166534; }
        .verdict-fail { background: #450a0a; color: #fca5a5; border: 1px solid #7f1d1d; }
        .verdict-check { background: #451a03; color: #fcd34d; border: 1px solid #78350f; }
        .trade-details { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 0.5rem; margin-top: 0.75rem; }
        .detail { background: #020617; border: 1px solid #1e293b; border-radius: 4px; padding: 0.5rem; }
        .detail-label { font-size: 0.6rem; color: #64748b; letter-spacing: 0.05em; }
        .detail-value { font-size: 0.85rem; color: #e2e8f0; margin-top: 0.1rem; font-weight: 600; }
        .fail-reasons { margin-top: 0.75rem; }
        .fail-reason { font-size: 0.7rem; color: #f87171; padding: 0.2rem 0; }
        .ivr-note { font-size: 0.7rem; color: #fbbf24; margin-top: 0.5rem; padding: 0.5rem; background: #1c1003; border: 1px solid #78350f; border-radius: 4px; }
        .loading { text-align: center; padding: 3rem; color: #475569; font-size: 0.85rem; }
        .spinner { display: inline-block; width: 20px; height: 20px; border: 2px solid #1e293b; border-top-color: #3b82f6; border-radius: 50%; animation: spin 0.8s linear infinite; margin-right: 0.5rem; vertical-align: middle; }
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>

      <div className="container">
        <header>
          <h1>OPTIONS SCREENER</h1>
          <div className="subtitle">Yahoo Finance Data · BPS / BCS / IC Candidates · IVR Must Be Verified in TastyTrade</div>
          <div className="rules">
            <span className="rule">IVR ≥ 30 (verify TT)</span>
            <span className="rule">OI ≥ 500</span>
            <span className="rule">Delta 0.15–0.22</span>
            <span className="rule">Credit ≥ ⅓ width</span>
            <span className="rule">Bid-ask ≤ $0.10</span>
            <span className="rule">DTE 27–45</span>
            <span className="rule">No earnings in window</span>
          </div>
        </header>

        <div className="input-area">
          <label>TICKERS (comma or space separated)</label>
          <textarea
            value={tickerInput}
            onChange={e => setTickerInput(e.target.value)}
            placeholder="MU, NVDA, AAPL, JPM..."
          />
          <div className="note">⚠ IV shown is raw implied volatility, NOT IVR. Always verify IVR in TastyTrade before entering any trade.</div>
          <button onClick={runScreen} disabled={loading}>
            {loading ? <><span className="spinner" />SCREENING...</> : 'RUN SCREEN'}
          </button>
        </div>

        {error && <div className="error">Error: {error}</div>}

        {results.length > 0 && (
          <>
            <div className="summary">
              <div className="summary-card">
                <div className={`summary-num num-pass`}>{passes.length}</div>
                <div className="summary-label">PASS</div>
              </div>
              <div className="summary-card">
                <div className={`summary-num num-check`}>{checkIvr.length}</div>
                <div className="summary-label">CHECK IVR</div>
              </div>
              <div className="summary-card">
                <div className={`summary-num num-fail`}>{fails.length}</div>
                <div className="summary-label">FAIL</div>
              </div>
            </div>

            {[...passes, ...checkIvr, ...fails].map(r => (
              <div key={r.ticker} className="card">
                <div className="card-header">
                  <div>
                    <span className="ticker-name">{r.ticker}</span>
                    {r.price > 0 && <span className="ticker-price">${r.price.toFixed(2)}</span>}
                  </div>
                  <VerdictBadge verdict={r.verdict} />
                </div>

                <div className="badges">
                  <Badge pass={r.ivrPass} label="IVR" />
                  <Badge pass={r.earningsPass} label="Earnings" />
                  <Badge pass={r.oiPass} label="OI" />
                  <Badge pass={r.deltaPass} label="Delta" />
                  <Badge pass={r.creditPass} label="Credit" />
                  <Badge pass={r.bidAskPass} label="Bid-Ask" />
                  <Badge pass={r.dte !== null ? r.dte >= 27 && r.dte <= 45 : null} label="DTE" />
                </div>

                {r.ivrNote && (
                  <div className="ivr-note">⚠ {r.ivrNote}</div>
                )}

               {r.shortStrike && (
                  <div className="trade-details">
                    <div className="detail">
                      <div className="detail-label">STRATEGY</div>
                      <div className="detail-value">{r.strategy ?? '—'}</div>
                    </div>
                    <div className="detail">
                      <div className="detail-label">EXPIRATION</div>
                      <div className="detail-value">{r.expiration ?? '—'}</div>
                    </div>
                    <div className="detail">
                      <div className="detail-label">DTE</div>
                      <div className="detail-value">{r.dte ?? '—'}</div>
                    </div>
                    <div className="detail">
                      <div className="detail-label">SHORT / LONG</div>
                      <div className="detail-value">{r.shortStrike ?? '—'} / {r.longStrike ?? '—'}</div>
                    </div>
                    <div className="detail">
                      <div className="detail-label">CREDIT</div>
                      <div className="detail-value">${r.credit?.toFixed(2) ?? '—'}</div>
                    </div>
                    <div className="detail">
                      <div className="detail-label">WIDTH</div>
                      <div className="detail-value">${r.spreadWidth ?? '—'}</div>
                    </div>
                    <div className="detail">
                      <div className="detail-label">DELTA</div>
                      <div className="detail-value">{r.delta?.toFixed(2) ?? '—'}</div>
                    </div>
                    <div className="detail">
                      <div className="detail-label">OI</div>
                      <div className="detail-value">{r.oi?.toLocaleString() ?? '—'}</div>
                    </div>
                    <div className="detail">
                      <div className="detail-label">BID-ASK</div>
                      <div className="detail-value">${r.bidAsk?.toFixed(2) ?? '—'}</div>
                    </div>
                  </div>
                )}

                {r.failReasons.length > 0 && (
                  <div className="fail-reasons">
                    {r.failReasons.map((reason, i) => (
                      <div key={i} className="fail-reason">✗ {reason}</div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </>
        )}
      </div>
    </>
  );
}
