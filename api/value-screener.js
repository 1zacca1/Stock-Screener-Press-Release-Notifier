import { fmp, fmpStable, batchFetch } from './_fmp.js';

const US_EXCHANGES = ['NYSE', 'NASDAQ', 'AMEX'];
const EU_EXCHANGES = ['LSE', 'EURONEXT', 'XETRA', 'SIX', 'OSLO'];

function cagr3(end, start) {
  if (!end || !start || start <= 0 || end <= 0) return null;
  return ((end / start) ** (1 / 3) - 1) * 100;
}
function avg(arr) {
  const v = arr.filter(x => x != null && isFinite(x));
  return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null;
}

async function getCandidates(exchanges) {
  const joinedEx = exchanges.join(',');

  // Try stable screener
  try {
    const data = await fmpStable(
      `stock-screener?exchange=${joinedEx}&marketCapMoreThan=50000000&isActivelyTrading=true&isEtf=false&limit=250`
    );
    if (Array.isArray(data) && data.length > 0) return { source: 'screener', data };
  } catch (e) {
    console.warn('stable screener failed:', e.message);
  }

  // Fallback: exchange quotes (includes pe inline)
  const all = [];
  for (const ex of exchanges.slice(0, 3)) {
    try {
      const d = await fmp(`quotes/${ex}`);
      if (Array.isArray(d)) all.push(...d);
    } catch {}
  }
  return { source: 'quotes', data: all };
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate');

  try {
    const region    = req.query.region === 'eu' ? 'eu' : 'us';
    const exchanges = region === 'eu' ? EU_EXCHANGES : US_EXCHANGES;

    const { source, data } = await getCandidates(exchanges);
    if (!data.length) return res.status(200).json([]);

    let preFiltered;

    if (source === 'quotes') {
      preFiltered = data
        .filter(q => !q.isEtf && q.pe > 0 && q.pe < 15 && q.marketCap > 50e6)
        .map(q => ({
          symbol:    q.symbol,
          name:      q.name,
          exchange:  q.exchange || q.exchangeShortName || '',
          price:     q.price,
          marketCap: q.marketCap,
          pe:        q.pe,
          sector:    '',
          currency:  region === 'eu' ? 'EUR' : 'USD',
        }));
    } else {
      // Screener: batch-fetch profiles for pe
      const symbols  = data.map(s => s.symbol);
      const profiles = [];
      for (let i = 0; i < Math.min(symbols.length, 200); i += 50) {
        try {
          const p = await fmp(`profile/${symbols.slice(i, i + 50).join(',')}`);
          if (Array.isArray(p)) profiles.push(...p);
        } catch {}
      }
      const pm = new Map(profiles.map(p => [p.symbol, p]));

      preFiltered = data
        .map(s => {
          const p  = pm.get(s.symbol) || {};
          const pe = p.pe;
          if (typeof pe !== 'number' || pe <= 0 || pe >= 15) return null;
          return {
            symbol:    s.symbol,
            name:      p.companyName || s.companyName || s.symbol,
            exchange:  p.exchangeShortName || s.exchangeShortName || '',
            price:     p.price ?? s.price,
            marketCap: s.mktCap || p.mktCap || null,
            pe,
            sector:    p.sector || s.sector || '—',
            currency:  p.currency || 'USD',
          };
        })
        .filter(Boolean);
    }

    const top = preFiltered.slice(0, 50);

    // Deep-fetch 4 years of income + key-metrics for CAGR / ROIC / ROE / EV/EBIT
    const enriched = await batchFetch(top, async stock => {
      const [mRes, iRes] = await Promise.allSettled([
        fmp(`key-metrics/${stock.symbol}?limit=4`),
        fmp(`income-statement/${stock.symbol}?limit=4`),
      ]);

      if (mRes.status !== 'fulfilled' || iRes.status !== 'fulfilled') return null;
      const metrics = mRes.value;
      const incomes = iRes.value;
      if (!Array.isArray(metrics) || metrics.length < 3) return null;
      if (!Array.isArray(incomes) || incomes.length < 4) return null;

      // 3-yr revenue CAGR
      const revCagr = cagr3(incomes[0].revenue, incomes[3].revenue);

      // 3-yr avg ROIC and ROE (decimals → %)
      const roic = avg(metrics.slice(0, 3).map(m => m.roic != null ? m.roic * 100 : null));
      const roe  = avg(metrics.slice(0, 3).map(m => m.roe  != null ? m.roe  * 100 : null));

      // EV/EBIT: latest enterprise value / latest operating income
      const ev   = metrics[0].enterpriseValue;
      const ebit = incomes[0].operatingIncome;
      const evEbit = ev && ebit && ebit > 0 ? ev / ebit : null;

      return { ...stock, revCagr, roic, roe, evEbit };
    }, 5);

    // Apply all five criteria
    const results = enriched
      .filter(s =>
        s &&
        s.pe < 15 &&
        s.evEbit != null && s.evEbit > 0 && s.evEbit < 10 &&
        s.revCagr != null && s.revCagr >= 30 &&
        s.roic    != null && s.roic    >= 30 &&
        s.roe     != null && s.roe     >= 30
      )
      .sort((a, b) => (a.evEbit || 99) - (b.evEbit || 99));

    res.status(200).json(results);
  } catch (err) {
    console.error('[value-screener]', err);
    res.status(500).json({ error: err.message });
  }
}
