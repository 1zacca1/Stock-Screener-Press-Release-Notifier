// Global value screener — surfaces stocks with:
//   EV/EBIT < threshold  (default 10x)
//   3Y revenue CAGR >= threshold  (default 30%)
//   3Y avg ROIC >= threshold  (default 30%)
//   3Y avg ROE  >= threshold  (default 30%)
// Also returns: net cash, insider ownership %

let _cache = null;
let _cacheTime = 0;
const CACHE_TTL = 12 * 60 * 60 * 1000;

const FMP = 'https://financialmodelingprep.com/api';

async function fmpV3(path, apiKey) {
  const sep = path.includes('?') ? '&' : '?';
  const r = await fetch(`${FMP}/v3${path}${sep}apikey=${apiKey}`);
  if (!r.ok) throw new Error(`FMP ${r.status}`);
  return r.json();
}

async function fmpV4(path, apiKey) {
  const sep = path.includes('?') ? '&' : '?';
  const r = await fetch(`${FMP}/v4${path}${sep}apikey=${apiKey}`);
  if (!r.ok) return null;
  return r.json().catch(() => null);
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const apiKey = process.env.FMP_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'FMP_API_KEY not configured.' });

  const maxEvEbit = parseFloat(req.query.maxEvEbit ?? '10');
  const minCagr   = parseFloat(req.query.minCagr   ?? '0.30');
  const minRoic   = parseFloat(req.query.minRoic   ?? '0.30');
  const minRoe    = parseFloat(req.query.minRoe    ?? '0.30');

  if (_cache && Date.now() - _cacheTime < CACHE_TTL) {
    return res.status(200).json(applyFilters(_cache, maxEvEbit, minCagr, minRoic, minRoe));
  }

  try {
    // Step 1: broad US stock universe
    const screener = await fmpV3(
      '/stock-screener?isEtf=false&isActivelyTrading=true&priceMoreThan=1&country=US&limit=200',
      apiKey
    );
    if (!Array.isArray(screener)) throw new Error('Screener returned invalid data');

    // Step 2: TTM key metrics — pre-filter for high-quality candidates
    const ttmMap = new Map();
    const BATCH = 25;
    for (let i = 0; i < screener.length; i += BATCH) {
      const batch = screener.slice(i, i + BATCH);
      await Promise.allSettled(
        batch.map(async (s) => {
          try {
            const data = await fmpV3(`/key-metrics-ttm/${s.symbol}`, apiKey);
            const m = Array.isArray(data) ? data[0] : data;
            if (m && typeof m.roeTTM === 'number') ttmMap.set(s.symbol, m);
          } catch {}
        })
      );
    }

    // Loose pre-filter (20%) to reduce expensive detail calls
    const preFiltered = screener.filter((s) => {
      const m = ttmMap.get(s.symbol);
      return m && m.roeTTM >= 0.20 && m.roicTTM >= 0.20;
    });

    // Step 3: full enrichment
    const enriched = [];
    await Promise.allSettled(
      preFiltered.map(async (stock) => {
        try {
          const sym = stock.symbol;
          const [incomeData, metricsData, balanceData] = await Promise.all([
            fmpV3(`/income-statement/${sym}?limit=4&period=annual`, apiKey),
            fmpV3(`/key-metrics/${sym}?limit=3&period=annual`, apiKey),
            fmpV3(`/balance-sheet-statement/${sym}?limit=1&period=annual`, apiKey),
          ]);

          let insiderPct = null;
          try {
            const ins = await fmpV4(`/insider-roaster-statistic?symbol=${sym}`, apiKey);
            if (Array.isArray(ins) && ins.length) {
              const first = ins[0];
              insiderPct = first.ownershipPercent ?? first.totalInsiderOwnership ?? null;
            }
          } catch {}

          const entry = computeMetrics(stock, incomeData, metricsData, balanceData, insiderPct);
          if (entry) enriched.push(entry);
        } catch {}
      })
    );

    _cache = enriched;
    _cacheTime = Date.now();
    return res.status(200).json(applyFilters(enriched, maxEvEbit, minCagr, minRoic, minRoe));
  } catch (err) {
    if (_cache) return res.status(200).json(applyFilters(_cache, maxEvEbit, minCagr, minRoic, minRoe));
    return res.status(500).json({ error: 'Screener error: ' + err.message });
  }
}

function computeMetrics(stock, income, metrics, balance, insiderPct) {
  if (!Array.isArray(income) || income.length < 2) return null;
  if (!Array.isArray(metrics) || !metrics.length) return null;

  const periods = Math.min(3, income.length - 1);
  const revLatest = income[0]?.revenue;
  const revBase   = income[periods]?.revenue;
  if (!revLatest || !revBase || revBase <= 0) return null;
  const revCagr = Math.pow(revLatest / revBase, 1 / periods) - 1;

  const roics = metrics.map((m) => m.roic).filter((v) => typeof v === 'number' && isFinite(v) && v > -5);
  const roes  = metrics.map((m) => m.roe ).filter((v) => typeof v === 'number' && isFinite(v) && v > -5);
  if (!roics.length || !roes.length) return null;

  const avgRoic = roics.reduce((a, b) => a + b, 0) / roics.length;
  const avgRoe  = roes .reduce((a, b) => a + b, 0) / roes.length;

  const ebit = income[0]?.operatingIncome;
  const ev   = metrics[0]?.enterpriseValue;
  if (!ebit || ebit <= 0 || !ev || ev <= 0) return null;
  const evEbit = ev / ebit;

  const bs      = Array.isArray(balance) && balance[0] ? balance[0] : {};
  const cash    = (bs.cashAndCashEquivalents || 0) + (bs.shortTermInvestments || 0);
  const debt    = bs.totalDebt || (bs.longTermDebt || 0) + (bs.shortTermDebt || 0);
  const netCash = cash - debt;

  return {
    symbol: stock.symbol, name: stock.companyName,
    price: stock.price,   marketCap: stock.marketCap,
    sector: stock.sector, country: stock.country,
    exchange: stock.exchangeShortName,
    revCagr3y: revCagr,   avgRoic3y: avgRoic,
    avgRoe3y: avgRoe,     evEbit: evEbit,
    netCash: netCash,     insiderPct: insiderPct,
  };
}

function applyFilters(stocks, maxEvEbit, minCagr, minRoic, minRoe) {
  return stocks.filter((s) =>
    s.evEbit    <= maxEvEbit &&
    s.revCagr3y >= minCagr  &&
    s.avgRoic3y >= minRoic  &&
    s.avgRoe3y  >= minRoe
  );
}
