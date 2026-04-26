const BASE = 'https://financialmodelingprep.com/api';

export async function fmp(path, version = 3) {
  const key = process.env.FMP_API_KEY;
  if (!key) throw new Error('FMP_API_KEY environment variable is not set');
  const sep = path.includes('?') ? '&' : '?';
  const url = `${BASE}/v${version}/${path}${sep}apikey=${key}`;
  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`FMP ${res.status} at v${version}/${path.split('?')[0]}: ${text.slice(0, 120)}`);
  }
  return res.json();
}

// Process items with bounded concurrency to avoid rate limits
export async function batchFetch(items, asyncFn, concurrency = 5) {
  const results = [];
  for (let i = 0; i < items.length; i += concurrency) {
    const chunk = items.slice(i, i + concurrency);
    const settled = await Promise.allSettled(chunk.map(asyncFn));
    results.push(...settled.map(r => (r.status === 'fulfilled' ? r.value : null)));
  }
  return results;
}
