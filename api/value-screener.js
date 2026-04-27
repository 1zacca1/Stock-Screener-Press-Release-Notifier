import { fmp, batchFetch } from './_fmp.js';

const EU_EXCHANGES = 'LSE,EURONEXT,XETRA,SIX,OSLO,CPH,STO,HEL';
const US_EXCHANGES = 'NYSE,NASDAQ,AMEX';

function cagr3yr(rev0, rev3) {
  if (!rev0 || !rev3 || rev3 <= 0 || rev0 <= 0) return null;
  return ((rev0 / rev3) ** (1 / 3) - 1) * 100;
}

function avg(arr) {
  const vals = arr.filter(v => v != null && isFinite(v));
  return vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : null;
}

async function fetchProfiles(symbols) {
  const profiles = [];
  for (let i = 0; i < Math.min(symbols.length, 150); i += 50) {
    const batch = symbols.slice(i, i + 50).join(',');
    try {
      const p = await fmp(`profile/${batch}`);
      if (Array.isArray(p)) profiles.push(...p);
    } catch {}
  }
  return profiles;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate');

  try {
    const region = req.query.region === 'eu' ? 'eu' : 'us';
    const exchanges = region === 'eu' ? EU_EXCHANGES : US_EXCHANGES;

    // Step 1: Broad screener, no size restriction (quality compounders can be large-cap)
    const screener = await fmp(
      `stock-screener?exchange=${exchanges}&marketCapMoreThan=50000000&isActivelyTrading=true&isEtf=false&limit=200`
    );

    if (!Array.isArray(screener) || screener.length === 0) {
      return res.status(200).json([]);
    }

    // Step 2: Batch profiles for P/E pre-filter
    const profiles = await fetchProfiles(screener.map(s => s.symbol));
    const profileMap = new Map(profiles.map(p => [p.symbol, p]));

    // Pre-filter: profitable (P/E > 0) and P/E < 15
    const candidates = [];
    for (const s of screener) {
      const p = profileMap.get(s.symbol);
      if (!p) continue;
      const pe = p.pe;
      if (typeof pe === 'number' && pe > 0 && pe < 15) {
        candidates.push({
          symbol: s.symbol,
          name: p.companyName || s.companyName || s.symbol,
          exchange: p.exchangeShortName || s.exchangeShortName || '',
          price: p.price ?? s.price,
          marketCap: s.mktCap || p.mktCap || null,
          pe,
          sector: p.sector || s.sector || '—',
          currency: p.currency || 'USD',
        });
      }
    }

    // Step 3: For each candidate, fetch 4 years of income statements and key-metrics
    const top = candidates.slice(0, 50);

    const enriched = await batchFetch(
      top,
      async stock => {
        const [metricsRes, incomeRes] = await Promise.allSettled([
          fmp(`key-metrics/${stock.symbol}?limit=4`),
          fmp(`income-statement/${stock.symbol}?limit=4`),
        ]);

        if (metricsRes.status !== 'fulfilled' || incomeRes.status !== 'fulfilled') return null;

        const metrics = metricsRes.value;
        const incomes = incomeRes.value;

        if (!Array.isArray(metrics) || metrics.length < 3) return null;
        if (!Array.isArray(incomes) || incomes.length < 4) return null;

        // 3-yr revenue CAGR
        const revCagr = cagr3yr(incomes[0].revenue, incomes[3].revenue);

        // 3-yr average ROIC and ROE (key-metrics stores as decimals, e.g. 0.30 = 30%)
        const roic = avg(metrics.slice(0, 3).map(m => m.roic != null ? m.roic * 100 : null));
        const roe  = avg(metrics.slice(0, 3).map(m => m.roe  != null ? m.roe  * 100 : null));

        // EV/EBIT = latest enterprise value / latest operating income
        const ev   = metrics[0].enterpriseValue;
        const ebit = incomes[0].operatingIncome;
        const evEbit = ev && ebit && ebit > 0 ? ev / ebit : null;

        return { ...stock, revCagr, roic, roe, evEbit };
      },
      5
    );

    // Step 4: Apply all value screener criteria
    const results = enriched
      .filter(s => {
        if (!s) return false;
        return (
          s.pe < 15 &&
          s.evEbit != null && s.evEbit > 0 && s.evEbit < 10 &&
          s.revCagr != null && s.revCagr >= 30 &&
          s.roic  != null && s.roic  >= 30 &&
          s.roe   != null && s.roe   >= 30
        );
      })
      .sort((a, b) => (a.evEbit || 99) - (b.evEbit || 99));

    res.status(200).json(results);
  } catch (err) {
    console.error('[value-screener]', err);
    res.status(500).json({ error: err.message });
  }
}
