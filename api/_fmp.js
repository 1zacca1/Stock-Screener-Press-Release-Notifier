const V3 = 'https://financialmodelingprep.com/api/v3';
const V4 = 'https://financialmodelingprep.com/api/v4';
const STABLE = 'https://financialmodelingprep.com/stable';

async function req(url) {
  const res = await fetch(url);
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`FMP ${res.status}: ${txt.slice(0, 160)}`);
  }
  return res.json();
}

export function fmp(path, version = 3) {
  const key = process.env.FMP_API_KEY;
  if (!key) throw new Error('FMP_API_KEY not set');
  const base = version === 4 ? V4 : V3;
  const sep  = path.includes('?') ? '&' : '?';
  return req(`${base}/${path}${sep}apikey=${key}`);
}

export function fmpStable(path) {
  const key = process.env.FMP_API_KEY;
  if (!key) throw new Error('FMP_API_KEY not set');
  const sep = path.includes('?') ? '&' : '?';
  return req(`${STABLE}/${path}${sep}apikey=${key}`);
}

// Process items with bounded concurrency to avoid rate limits
export async function batchFetch(items, asyncFn, concurrency = 5) {
  const results = [];
  for (let i = 0; i < items.length; i += concurrency) {
    const chunk   = items.slice(i, i + concurrency);
    const settled = await Promise.allSettled(chunk.map(asyncFn));
    results.push(...settled.map(r => (r.status === 'fulfilled' ? r.value : null)));
  }
  return results;
}
