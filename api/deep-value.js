import { fmp, fmpStable, batchFetch } from './_fmp.js';

const US_EXCHANGES = ['NYSE', 'NASDAQ', 'AMEX'];
const EU_EXCHANGES = ['LSE', 'EURONEXT', 'XETRA', 'SIX', 'OSLO', 'CPH', 'STO', 'HEL'];

// Exchange-level quote endpoint — includes pe + marketCap, no screener needed
async function quotesByExchange(exchanges) {
  const all = [];
  for (const ex of exchanges) {
    try {
      const data = await fmp(`quotes/${ex}`);
      if (Array.isArray(data)) all.push(...data);
    } catch (e) {
      console.warn(`quotes/${ex} failed:`, e.message);
    }
  }
  return all;
}

// Try stable screener first, fall back to exchange quotes
async function getCandidates(exchanges) {
  const joinedEx = exchanges.join(',');

  // Attempt 1: FMP stable screener
  try {
    const data = await fmpStable(
      `stock-screener?exchange=${joinedEx}&marketCapMoreThan=20000000&marketCapLessThan=2000000000&isActivelyTrading=true&isEtf=false&limit=250`
    );
    if (Array.isArray(data) && data.length > 0) {
      // Stable screener doesn't include pe — return raw, caller will batch-fetch profiles
      return { source: 'screener', data };
    }
  } catch (e) {
    console.warn('stable screener failed:', e.message);
  }

  // Attempt 2: Exchange quote snapshots (includes pe + marketCap inline)
  const quotes = await quotesByExchange(exchanges.slice(0, 4)); // cap at 4 exchanges
  return { source: 'quotes', data: quotes };
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate');

  try {
    const region    = req.query.region === 'eu' ? 'eu' : 'us';
    const exchanges = region === 'eu' ? EU_EXCHANGES : US_EXCHANGES;

    const { source, data } = await getCandidates(exchanges);

    if (!data.length) return res.status(200).json([]);

    let candidates;

    if (source === 'quotes') {
      // Exchange quotes include pe + marketCap — filter directly
      candidates = data
        .filter(q =>
          q.marketCap >= 20e6 &&
          q.marketCap <= 2e9 &&
          !q.isEtf &&
          q.pe > 0 && q.pe < 10
        )
        .map(q => ({
          symbol:    q.symbol,
          name:      q.name,
          exchange:  q.exchange || q.exchangeShortName || '',
          price:     q.price,
          marketCap: q.marketCap,
          pe:        q.pe,
          sector:    '',          // not in quotes — populated during enrichment
          currency:  region === 'eu' ? 'EUR' : 'USD',
        }));
    } else {
      // Screener result: batch-fetch profiles to get pe
      const allSymbols = data.map(s => s.symbol);
      const profiles   = [];
      for (let i = 0; i < Math.min(allSymbols.length, 200); i += 50) {
        try {
          const batch = allSymbols.slice(i, i + 50).join(',');
          const p = await fmp(`profile/${batch}`);
          if (Array.isArray(p)) profiles.push(...p);
        } catch {}
      }
      const pm = new Map(profiles.map(p => [p.symbol, p]));

      candidates = data
        .map(s => {
          const p  = pm.get(s.symbol) || {};
          const pe = p.pe;
          if (typeof pe !== 'number' || pe <= 0 || pe >= 10) return null;
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

    candidates.sort((a, b) => a.pe - b.pe);
    const top = candidates.slice(0, 25);

    // Enrich: EV/EBIT (enterprise value / operating income) + net cash ratio
    const enriched = await batchFetch(top, async stock => {
      const [mRes, bRes, iRes] = await Promise.allSettled([
        fmp(`key-metrics-ttm/${stock.symbol}`),
        fmp(`balance-sheet-statement/${stock.symbol}?limit=1`),
        fmp(`income-statement/${stock.symbol}?limit=1`),
      ]);

      const m   = mRes.status === 'fulfilled' && Array.isArray(mRes.value) ? mRes.value[0] : null;
      const b   = bRes.status === 'fulfilled' && Array.isArray(bRes.value) ? bRes.value[0] : null;
      const inc = iRes.status === 'fulfilled' && Array.isArray(iRes.value) ? iRes.value[0] : null;

      // Fill sector from key-metrics if missing (quotes source)
      const sector = stock.sector && stock.sector !== '' ? stock.sector
        : (inc?.symbol ? '' : (m ? '' : '—'));

      // EV / EBIT
      let evEbit = null;
      if (m?.enterpriseValueTTM && inc?.operatingIncome && inc.operatingIncome > 0) {
        evEbit = m.enterpriseValueTTM / inc.operatingIncome;
      }

      // (Cash + ST investments − total debt) / market cap
      let netCashRatio = null;
      if (b && stock.marketCap) {
        const cash = (b.cashAndCashEquivalents || 0) + (b.shortTermInvestments || 0);
        const debt = b.totalDebt ?? ((b.shortTermDebt || 0) + (b.longTermDebt || 0));
        netCashRatio = (cash - debt) / stock.marketCap;
      }

      return { ...stock, sector, evEbit, netCashRatio };
    }, 5);

    const results = enriched
      .filter(Boolean)
      .sort((a, b) => (a.pe || 99) - (b.pe || 99));

    res.status(200).json(results);
  } catch (err) {
    console.error('[deep-value]', err);
    res.status(500).json({ error: err.message });
  }
}
