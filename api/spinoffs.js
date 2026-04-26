import { fmp } from './_fmp.js';

// Curated 2025-2026 spinoffs — sourced from The Zen of Investing / public announcements
const STATIC_SPINOFFS = [
  {
    spinoff: 'Honeywell Automation',
    parent: 'Honeywell International (HON)',
    date: 'Late 2025',
    status: 'Announced',
    exchange: 'NASDAQ',
    region: 'US',
    sector: 'Industrials',
    notes: 'One of three independent companies from Honeywell\'s break-up; focuses on building automation and process automation.',
  },
  {
    spinoff: 'Honeywell Advanced Materials',
    parent: 'Honeywell International (HON)',
    date: 'Late 2025',
    status: 'Announced',
    exchange: 'NASDAQ',
    region: 'US',
    sector: 'Materials',
    notes: 'Specialty and performance materials division to become a standalone public company.',
  },
  {
    spinoff: 'Solarflare / Enovis Spine',
    parent: 'Enovis Corp (ENOV)',
    date: '2025',
    status: 'Announced',
    exchange: 'NYSE',
    region: 'US',
    sector: 'Healthcare',
    notes: 'Spine and orthobiologics segment separation to unlock value in orthopedic reconstruction.',
  },
  {
    spinoff: 'Johnson Controls Residential HVAC',
    parent: 'Johnson Controls (JCI)',
    date: 'Mid 2025',
    status: 'Announced',
    exchange: 'NYSE',
    region: 'US',
    sector: 'Industrials',
    notes: 'Residential HVAC and refrigeration business (York brand) to be spun off or sold.',
  },
  {
    spinoff: 'Bayer CropScience',
    parent: 'Bayer AG (BAYN)',
    date: '2026',
    status: 'Under Review',
    exchange: 'XETRA',
    region: 'EU',
    sector: 'Agriculture',
    notes: 'Bayer exploring separation of its crop science division to address balance sheet pressure from Roundup litigation.',
  },
  {
    spinoff: 'Siemens Energy Grid Technologies',
    parent: 'Siemens Energy (ENR)',
    date: '2025–2026',
    status: 'Under Review',
    exchange: 'XETRA',
    region: 'EU',
    sector: 'Utilities / Industrials',
    notes: 'Potential carve-out of grid technologies amid strong demand for power infrastructure.',
  },
  {
    spinoff: 'Philips Personal Health',
    parent: 'Philips (PHIA)',
    date: '2026',
    status: 'Announced',
    exchange: 'EURONEXT',
    region: 'EU',
    sector: 'Consumer / Healthcare',
    notes: 'Philips separating its personal health (consumer) division to focus on professional healthcare equipment.',
  },
  {
    spinoff: 'Reckitt Essential Home',
    parent: 'Reckitt Benckiser (RKT)',
    date: '2025',
    status: 'Announced',
    exchange: 'LSE',
    region: 'EU',
    sector: 'Consumer Staples',
    notes: 'Home care and essential hygiene brands (Air Wick, Calgon) being separated from health and nutrition.',
  },
];

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate');

  try {
    // Try FMP's spinoff calendar first
    let spinoffs = [];
    try {
      const today = new Date().toISOString().slice(0, 10);
      const future = new Date(Date.now() + 548 * 86400000).toISOString().slice(0, 10); // +18 months
      const data = await fmp(`calendar/spinoffs?from=2025-01-01&to=${future}`, 4);
      if (Array.isArray(data) && data.length > 0) {
        spinoffs = data.map(s => ({
          spinoff:  s.newCompany  || s.company || '—',
          parent:   s.company     || '—',
          date:     s.date        || 'TBD',
          status:   s.status      || 'Announced',
          exchange: s.exchange    || '',
          region:   s.country === 'US' ? 'US' : 'EU',
          sector:   s.sector      || '',
          notes:    s.description || '',
          ticker:   s.ticker      || '',
        }));
      }
    } catch {}

    // Fall back to curated list if FMP returns nothing
    if (!spinoffs.length) spinoffs = STATIC_SPINOFFS;

    res.status(200).json(spinoffs);
  } catch (err) {
    console.error('[spinoffs]', err);
    res.status(500).json({ error: err.message });
  }
}
