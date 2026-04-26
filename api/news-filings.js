import { fmp } from './_fmp.js';

const EDGAR_SEARCH = 'https://efts.sec.gov/LATEST/search-index';

// Forms that signal event-driven opportunities
const EVENT_FORMS = ['SC TO-T', 'SC TO-I', 'SC 13E-3', '15-12G', '25'];

async function fetchEdgar(forms, daysBack = 90) {
  const startdt = new Date(Date.now() - daysBack * 86400000).toISOString().slice(0, 10);
  const url =
    `${EDGAR_SEARCH}?forms=${encodeURIComponent(forms.join(','))}` +
    `&dateRange=custom&startdt=${startdt}`;

  const res = await fetch(url, {
    headers: { 'User-Agent': 'InvestmentResearch research@example.com' },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`EDGAR ${res.status}`);
  return res.json();
}

function edgarLabel(formType) {
  const map = {
    'SC TO-T':  'Tender Offer',
    'SC TO-I':  'Issuer Tender',
    'SC 13E-3': 'Going Private',
    '15-12G':   'Deregistration',
    '25':       'Delisting',
  };
  return map[formType] || formType;
}

function parseEdgar(data) {
  const hits = data?.hits?.hits ?? [];
  return hits.map(hit => {
    const s = hit._source ?? {};
    const formType = s.form_type ?? '';
    const company  = s.display_names?.[0] ?? s.entity_name ?? '';
    const ticker   = s.tickers?.[0] ?? '';
    const fileNum  = s.file_num ?? '';
    const url = fileNum
      ? `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&filenum=${encodeURIComponent(fileNum)}&type=&dateb=&owner=include&count=10`
      : null;

    return {
      type:    formType,
      label:   edgarLabel(formType),
      title:   company || 'Filing',
      company,
      ticker,
      date:    s.file_date ?? '',
      url,
      region:  'US',
    };
  }).filter(f => f.company || f.title);
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate');

  try {
    const region = req.query.region === 'eu' ? 'eu' : 'us';

    let items = [];

    if (region === 'us') {
      // SEC EDGAR: tender offers, going-private, delistings
      const [tenderRes, deregRes] = await Promise.allSettled([
        fetchEdgar(['SC TO-T', 'SC TO-I', 'SC 13E-3']),
        fetchEdgar(['15-12G', '25']),
      ]);

      if (tenderRes.status === 'fulfilled') items.push(...parseEdgar(tenderRes.value));
      if (deregRes.status  === 'fulfilled') items.push(...parseEdgar(deregRes.value));

    } else {
      // EU: FMP general news filtered for M&A / event-driven keywords
      // (EU regulatory filings live on national regulators: FCA, AMF, BaFin, etc.)
      try {
        const news = await fmp('stock_news?limit=100');
        if (Array.isArray(news)) {
          const euKeywords = /acqui|tender offer|merger|going.private|spin.?off|delist|takeover|buyout|privatisation|privatization/i;
          items = news
            .filter(n => euKeywords.test(n.title + ' ' + (n.text ?? '')))
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
      } catch {}
    }

    // Sort newest first
    items.sort((a, b) => (b.date || '').localeCompare(a.date || ''));

    res.status(200).json(items.slice(0, 50));
  } catch (err) {
    console.error('[news-filings]', err);
    res.status(500).json({ error: err.message });
  }
}
