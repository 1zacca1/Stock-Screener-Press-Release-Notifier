import { fmp } from './_fmp.js';

// Public EDGAR Atom RSS feed — no auth required, always current
const EDGAR_RSS = 'https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&dateb=&owner=include&count=40&output=atom&type=';
const EDGAR_UA  = 'InvestmentResearch research@example.com';

const FORM_LABELS = {
  'SC TO-T':  'Tender Offer',
  'SC TO-I':  'Issuer Tender',
  'SC 13E-3': 'Going Private',
  '15-12G':   'Deregistration',
  '25':       'Delisting',
  'NEWS':     'News',
};

// Minimal Atom XML parser — no external deps
function parseAtom(xml) {
  const items = [];
  const entries = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)];

  for (const [, entry] of entries) {
    const title   = (entry.match(/<title[^>]*>\s*(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?\s*<\/title>/)   ?.[1] ?? '').trim();
    const updated = (entry.match(/<updated>(.*?)<\/updated>/)                                           ?.[1] ?? '').slice(0, 10);
    const link    = (entry.match(/<link[^>]+href="([^"]+)"/)                                            ?.[1] ?? '');
    const summary = (entry.match(/<summary[^>]*>\s*(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?\s*<\/summary>/)?.[1] ?? '').trim();

    // EDGAR title format: "SC TO-T - COMPANY NAME (CIK 0001234567)"
    const formMatch    = title.match(/^(SC[\s\w-]+?\d*[A-Z]?|15-12[A-Z]|25)\s*-\s*/i);
    const formType     = formMatch ? formMatch[1].toUpperCase() : '';
    const companyPart  = formMatch ? title.slice(formMatch[0].length) : title;
    const company      = companyPart.replace(/\(CIK\s*\d+\)/i, '').trim();
    const tickerMatch  = summary.match(/\bTicker\s*(?:Symbol)?:\s*([A-Z]+)\b/i);
    const ticker       = tickerMatch ? tickerMatch[1] : '';

    items.push({
      type:    formType || 'FILING',
      label:   FORM_LABELS[formType] || formType || 'Filing',
      title:   company || title,
      company,
      ticker,
      date:    updated,
      url:     link || null,
      region:  'US',
    });
  }
  return items;
}

async function fetchEdgarFeed(formType) {
  const url = `${EDGAR_RSS}${encodeURIComponent(formType)}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': EDGAR_UA },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`EDGAR feed ${res.status} for ${formType}`);
  const xml = await res.text();
  return parseAtom(xml);
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate');

  try {
    const region = req.query.region === 'eu' ? 'eu' : 'us';
    let items = [];

    if (region === 'us') {
      // Fetch four form types in parallel; EDGAR RSS is public/free
      const feeds = await Promise.allSettled([
        fetchEdgarFeed('SC TO-T'),
        fetchEdgarFeed('SC TO-I'),
        fetchEdgarFeed('SC 13E-3'),
        fetchEdgarFeed('15-12G'),
        fetchEdgarFeed('25'),
      ]);

      for (const f of feeds) {
        if (f.status === 'fulfilled') items.push(...f.value);
        else console.warn('EDGAR feed error:', f.reason?.message);
      }

      // De-duplicate by title+date
      const seen = new Set();
      items = items.filter(it => {
        const key = `${it.title}|${it.date}|${it.type}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

    } else {
      // EU: FMP news filtered for M&A / event-driven keywords
      try {
        const news = await fmp('stock_news?limit=100');
        if (Array.isArray(news)) {
          const pat = /acqui|tender offer|merger|going.private|spin.?off|delist|takeover|buyout|privatisa|privatiza/i;
          items = news
            .filter(n => pat.test(n.title + ' ' + (n.text ?? '')))
            .slice(0, 40)
            .map(n => ({
              type:    'NEWS',
              label:   'News',
              title:   n.title,
              company: n.symbol ?? '',
              ticker:  n.symbol ?? '',
              date:    (n.publishedDate ?? '').slice(0, 10),
              url:     n.url ?? null,
              region:  'EU',
            }));
        }
      } catch (e) {
        console.warn('FMP news failed:', e.message);
      }
    }

    // Sort newest first
    items.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    res.status(200).json(items.slice(0, 60));

  } catch (err) {
    console.error('[news-filings]', err);
    res.status(500).json({ error: err.message });
  }
}
