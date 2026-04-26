import { fmp, batchFetch } from './_fmp.js';

const EU_EXCHANGES = 'LSE,EURONEXT,XETRA,SIX,OSLO,CPH,STO,HEL';
const US_EXCHANGES = 'NYSE,NASDAQ,AMEX';

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
  res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate');

  try {
    const region = req.query.region === 'eu' ? 'eu' : 'us';
    const exchanges = region === 'eu' ? EU_EXCHANGES : US_EXCHANGES;

    // Step 1: Screener — small-cap, actively trading, non-ETF
    const screener = await fmp(
      `stock-screener?exchange=${exchanges}&marketCapMoreThan=20000000&marketCapLessThan=2000000000&isActivelyTrading=true&isEtf=false&limit=200`
    );

    if (!Array.isArray(screener) || screener.length === 0) {
      return res.status(200).json([]);
    }

    // Step 2: Batch profiles to get P/E ratio
    const allSymbols = screener.map(s => s.symbol);
    const profiles = await fetchProfiles(allSymbols);
    const profileMap = new Map(profiles.map(p => [p.symbol, p]));

    // Step 3: Keep stocks with 0 < P/E < 10
    const candidates = [];
    for (const s of screener) {
      const p = profileMap.get(s.symbol);
      if (!p) continue;
      const pe = p.pe;
      if (typeof pe === 'number' && pe > 0 && pe < 10) {
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

    candidates.sort((a, b) => a.pe - b.pe);
    const top = candidates.slice(0, 25);

    // Step 4: Enrich top candidates with EV/EBIT (enterprise value / operating income)
    //         and net cash ratio (cash - debt) / market cap
    const enriched = await batchFetch(
      top,
      async stock => {
        const [metricsRes, balanceRes, incomeRes] = await Promise.allSettled([
          fmp(`key-metrics-ttm/${stock.symbol}`),
          fmp(`balance-sheet-statement/${stock.symbol}?limit=1`),
          fmp(`income-statement/${stock.symbol}?limit=1`),
        ]);

        const m = metricsRes.status === 'fulfilled' && Array.isArray(metricsRes.value)
          ? metricsRes.value[0] : null;
        const b = balanceRes.status === 'fulfilled' && Array.isArray(balanceRes.value)
          ? balanceRes.value[0] : null;
        const inc = incomeRes.status === 'fulfilled' && Array.isArray(incomeRes.value)
          ? incomeRes.value[0] : null;

        // EV/EBIT = Enterprise Value / Operating Income
        let evEbit = null;
        if (m?.enterpriseValueTTM && inc?.operatingIncome && inc.operatingIncome > 0) {
          evEbit = m.enterpriseValueTTM / inc.operatingIncome;
        }

        // Net cash ratio = (cash + ST investments − total debt) / market cap
        let netCashRatio = null;
        if (b && stock.marketCap) {
          const cash = (b.cashAndCashEquivalents || 0) + (b.shortTermInvestments || 0);
          const debt = b.totalDebt ?? ((b.shortTermDebt || 0) + (b.longTermDebt || 0));
          netCashRatio = (cash - debt) / stock.marketCap;
        }

        return { ...stock, evEbit, netCashRatio };
      },
      5
    );

    const results = enriched
      .filter(Boolean)
      .sort((a, b) => (a.pe || 99) - (b.pe || 99));

    res.status(200).json(results);
  } catch (err) {
    console.error('[deep-value]', err);
    res.status(500).json({ error: err.message });
  }
}
