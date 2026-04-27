import { fmp, batchFetch } from './_fmp.js';

// Canonical spinoff list with FMP-accessible tickers.
// isParent=true  → spinoff not yet trading; metrics fetched from parent.
// isParent=false → spun off and trading under own ticker.
const SPINOFFS = [
  // ── Completed spinoffs (own ticker) ────────────────────────────────────
  {
    spinoff: 'GE Vernova',
    parent:  'General Electric (GE)',
    ticker:  'GEV',
    isParent: false,
    date:    'Apr 2024',
    status:  'Completed',
    exchange: 'NYSE',
    region:  'US',
    sector:  'Energy',
    notes:   'GE\'s power generation and grid equipment business. Includes gas turbines, wind, and grid solutions.',
  },
  {
    spinoff: 'Solventum',
    parent:  '3M Company (MMM)',
    ticker:  'SOLV',
    isParent: false,
    date:    'Apr 2024',
    status:  'Completed',
    exchange: 'NYSE',
    region:  'US',
    sector:  'Healthcare',
    notes:   '3M\'s health-care division. Medical consumables, dental, health information systems.',
  },
  {
    spinoff: 'Kenvue',
    parent:  'Johnson & Johnson (JNJ)',
    ticker:  'KVUE',
    isParent: false,
    date:    'May 2023',
    status:  'Completed',
    exchange: 'NYSE',
    region:  'US',
    sector:  'Consumer Staples',
    notes:   'J&J consumer health brands: Tylenol, Band-Aid, Neutrogena, Listerine.',
  },
  {
    spinoff: 'Embecta',
    parent:  'BD (Becton Dickinson)',
    ticker:  'EMBC',
    isParent: false,
    date:    'Apr 2022',
    status:  'Completed',
    exchange: 'NASDAQ',
    region:  'US',
    sector:  'Healthcare',
    notes:   'Diabetes care devices (insulin syringes, pen needles). Trades at deep value multiples post-spin.',
  },
  // ── Pending US spinoffs (parent ticker shown) ───────────────────────────
  {
    spinoff: 'Honeywell Automation',
    parent:  'Honeywell International (HON)',
    ticker:  'HON',
    isParent: true,
    date:    'Late 2025',
    status:  'Announced',
    exchange: 'NASDAQ',
    region:  'US',
    sector:  'Industrials',
    notes:   'Building automation and process control. One of three standalone companies from HON\'s break-up.',
  },
  {
    spinoff: 'Honeywell Advanced Materials',
    parent:  'Honeywell International (HON)',
    ticker:  'HON',
    isParent: true,
    date:    'Late 2025',
    status:  'Announced',
    exchange: 'NASDAQ',
    region:  'US',
    sector:  'Materials',
    notes:   'Specialty performance materials and fluorine products. Third leg of Honeywell\'s break-up.',
  },
  {
    spinoff: 'JCI Residential HVAC',
    parent:  'Johnson Controls (JCI)',
    ticker:  'JCI',
    isParent: true,
    date:    'Mid 2025',
    status:  'Announced',
    exchange: 'NYSE',
    region:  'US',
    sector:  'Industrials',
    notes:   'York-brand residential HVAC and refrigeration. Intended to be sold or spun to shareholders.',
  },
  {
    spinoff: 'Enovis Spine',
    parent:  'Enovis Corp (ENOV)',
    ticker:  'ENOV',
    isParent: true,
    date:    '2025',
    status:  'Announced',
    exchange: 'NYSE',
    region:  'US',
    sector:  'Healthcare',
    notes:   'Spine and orthobiologics segment separation. Enables pure-play orthopedic reconstruction focus.',
  },
  // ── Pending EU spinoffs (parent ticker shown) ───────────────────────────
  {
    spinoff: 'Bayer CropScience (potential)',
    parent:  'Bayer AG (BAYRY)',
    ticker:  'BAYRY',
    isParent: true,
    date:    '2026',
    status:  'Under Review',
    exchange: 'XETRA',
    region:  'EU',
    sector:  'Agriculture',
    notes:   'Bayer exploring crop science separation to address Roundup litigation balance-sheet drag.',
  },
  {
    spinoff: 'Philips Personal Health',
    parent:  'Philips (PHG)',
    ticker:  'PHG',
    isParent: true,
    date:    '2026',
    status:  'Announced',
    exchange: 'EURONEXT',
    region:  'EU',
    sector:  'Consumer / Healthcare',
    notes:   'Philips separating its consumer personal health division to focus on professional diagnostic imaging.',
  },
  {
    spinoff: 'Reckitt Essential Home',
    parent:  'Reckitt Benckiser (RBGLY)',
    ticker:  'RBGLY',
    isParent: true,
    date:    '2025',
    status:  'Announced',
    exchange: 'LSE',
    region:  'EU',
    sector:  'Consumer Staples',
    notes:   'Air Wick, Calgon, Woolite brands separating from health and nutrition (Enfamil, Mucinex, Durex).',
  },
  {
    spinoff: 'Siemens Energy Grid Technologies',
    parent:  'Siemens Energy (SMNEY)',
    ticker:  'SMNEY',
    isParent: true,
    date:    '2025–2026',
    status:  'Under Review',
    exchange: 'XETRA',
    region:  'EU',
    sector:  'Utilities / Industrials',
    notes:   'Grid technologies carve-out amid surging power infrastructure demand. Transformer backlog >2× revenue.',
  },
];

function cagr3(end, start) {
  if (!end || !start || start <= 0 || end <= 0) return null;
  return ((end / start) ** (1 / 3) - 1) * 100;
}

async function enrich(spinoff) {
  const { ticker } = spinoff;

  const [profileRes, metricsRes, incomeRes, insiderRes] = await Promise.allSettled([
    fmp(`profile/${ticker}`),
    fmp(`key-metrics-ttm/${ticker}`),
    fmp(`income-statement/${ticker}?limit=4`),
    fmp(`insider-trading?symbol=${ticker}&limit=30`),
  ]);

  const profileArr = profileRes.status === 'fulfilled' ? profileRes.value : null;
  const profile    = Array.isArray(profileArr) ? profileArr[0] : profileArr;

  const mArr   = metricsRes.status === 'fulfilled' ? metricsRes.value : null;
  const m      = Array.isArray(mArr) ? mArr[0] : mArr;

  const incomes = incomeRes.status === 'fulfilled' && Array.isArray(incomeRes.value)
    ? incomeRes.value : null;

  const insiders = insiderRes.status === 'fulfilled' && Array.isArray(insiderRes.value)
    ? insiderRes.value : null;

  // ── P/E ─────────────────────────────────────────────────────────────────
  const pe = profile?.pe ?? null;

  // ── EV/EBIT ──────────────────────────────────────────────────────────────
  let evEbit = null;
  const ev   = m?.enterpriseValueTTM;
  const ebit = incomes?.[0]?.operatingIncome;
  if (ev && ebit && ebit > 0) evEbit = ev / ebit;

  // ── ROIC TTM (decimal → %) ───────────────────────────────────────────────
  const roic = m?.roicTTM != null ? m.roicTTM * 100 : null;

  // ── 3-yr Revenue CAGR ────────────────────────────────────────────────────
  const revCagr = incomes && incomes.length >= 4
    ? cagr3(incomes[0].revenue, incomes[3].revenue) : null;

  // ── Insider activity (last 90 days: buys vs sells) ───────────────────────
  let insiderSummary = null;
  if (insiders?.length) {
    const cutoff = Date.now() - 90 * 86400000;
    const recent = insiders.filter(t => new Date(t.transactionDate).getTime() >= cutoff);
    const buys   = recent.filter(t => t.transactionType === 'P-Purchase').length;
    const sells  = recent.filter(t => ['S-Sale', 'S-Sale+OE'].includes(t.transactionType)).length;
    if (buys > 0 || sells > 0) insiderSummary = `${buys}B / ${sells}S`;
  }

  return {
    ...spinoff,
    price:      profile?.price     ?? null,
    marketCap:  profile?.mktCap    ?? null,
    currency:   profile?.currency  ?? 'USD',
    pe,
    evEbit,
    roic,
    revCagr,
    insiderSummary,
  };
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate');

  try {
    const enriched = await batchFetch(SPINOFFS, enrich, 4);
    res.status(200).json(enriched.filter(Boolean));
  } catch (err) {
    console.error('[spinoffs]', err);
    res.status(500).json({ error: err.message });
  }
}
