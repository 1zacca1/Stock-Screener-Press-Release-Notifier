/* ─── Helpers ────────────────────────────────────────────────────────────── */

const fmt = {
  num:  (v, d = 1) => v == null || isNaN(v) ? '—' : (+v).toFixed(d),
  pct:  (v, d = 1) => v == null || isNaN(v) ? '—' : `${(+v).toFixed(d)}%`,
  mc:   v => {
    if (v == null) return '—';
    if (v >= 1e9)  return `$${(v / 1e9).toFixed(1)}B`;
    if (v >= 1e6)  return `$${(v / 1e6).toFixed(0)}M`;
    return `$${v}`;
  },
  price: (v, sym = '$') => v == null ? '—' : `${sym}${(+v).toFixed(2)}`,
  currSym: c => ({ EUR: '€', GBP: '£', CHF: 'Fr', SEK: 'kr', NOK: 'kr', DKK: 'kr' }[c] || '$'),
};

function el(id)  { return document.getElementById(id); }
function qs(sel) { return document.querySelector(sel); }

function setContent(id, html) { el(id).innerHTML = html; }
function showLoading(id, msg = 'Loading…') {
  setContent(id, `<div class="loading">${msg}</div>`);
}
function showError(id, msg) {
  setContent(id, `<div class="error">${msg}</div>`);
}

/* ─── Sorting ────────────────────────────────────────────────────────────── */

function makeSortable(table) {
  const headers = table.querySelectorAll('th[data-col]');
  let sortCol = null, sortDir = 1;

  headers.forEach(th => {
    th.style.cursor = 'pointer';
    th.addEventListener('click', () => {
      const col = th.dataset.col;
      if (sortCol === col) {
        sortDir *= -1;
      } else {
        sortCol = col;
        sortDir = 1;
      }
      headers.forEach(h => h.classList.remove('sort-asc', 'sort-desc'));
      th.classList.add(sortDir === 1 ? 'sort-asc' : 'sort-desc');

      const tbody = table.querySelector('tbody');
      const rows  = Array.from(tbody.querySelectorAll('tr'));
      rows.sort((a, b) => {
        const av = a.querySelector(`td[data-val="${col}"]`)?.dataset.raw ?? '';
        const bv = b.querySelector(`td[data-val="${col}"]`)?.dataset.raw ?? '';
        const an = parseFloat(av), bn = parseFloat(bv);
        if (!isNaN(an) && !isNaN(bn)) return (an - bn) * sortDir;
        return av.localeCompare(bv) * sortDir;
      });
      rows.forEach(r => tbody.appendChild(r));
    });
  });
}

/* ─── Tab navigation ─────────────────────────────────────────────────────── */

document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    const target = tab.dataset.tab;
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.module').forEach(m => m.classList.remove('active'));
    tab.classList.add('active');
    el(target).classList.add('active');

    if (!tab.dataset.loaded) {
      tab.dataset.loaded = '1';
      loadModule(target, 'us');
    }
  });
});

function loadModule(name, region) {
  switch (name) {
    case 'deep-value':     loadDeepValue(region);     break;
    case 'value-screener': loadValueScreener(region); break;
    case 'spinoffs':       loadSpinoffs();             break;
    case 'news-filings':   loadNewsFilings(region);   break;
  }
}

/* ─── Region toggle factory ──────────────────────────────────────────────── */

function bindRegionToggles(moduleId, loadFn) {
  el(moduleId).querySelectorAll('.region-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      el(moduleId).querySelectorAll('.region-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      loadFn(btn.dataset.region);
    });
  });
}

/* ═══════════════════════════════════════════════════════════════════════════
   DEEP VALUE
   ═══════════════════════════════════════════════════════════════════════════ */

async function loadDeepValue(region = 'us') {
  showLoading('dv-content', 'Fetching deep value stocks…');
  try {
    const r = await fetch(`/api/deep-value?region=${region}`);
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'API error');
    renderDeepValue(data);
  } catch (e) {
    showError('dv-content', e.message);
  }
}

function renderDeepValue(stocks) {
  if (!stocks.length) {
    setContent('dv-content', '<div class="empty">No stocks matched the criteria — try the other region or check your FMP key.</div>');
    return;
  }

  const rows = stocks.map(s => {
    const sym    = fmt.currSym(s.currency);
    const pePass = s.pe   != null && s.pe   < 10;
    const evPass = s.evEbit != null && s.evEbit > 0 && s.evEbit < 10;
    const ncPass = s.netCashRatio != null && s.netCashRatio > 0;

    return `<tr>
      <td><span class="ticker">${s.symbol}</span></td>
      <td><div class="name-cell" title="${esc(s.name)}">${esc(s.name)}</div></td>
      <td>${esc(s.exchange)}</td>
      <td class="r mono" data-val="price"    data-raw="${s.price ?? ''}">${fmt.price(s.price, sym)}</td>
      <td class="r mono" data-val="marketCap" data-raw="${s.marketCap ?? ''}">${fmt.mc(s.marketCap)}</td>
      <td class="r mono ${pePass ? 'pass' : ''}" data-val="pe" data-raw="${s.pe ?? 99}">${fmt.num(s.pe)}</td>
      <td class="r mono ${evPass ? 'pass' : s.evEbit != null ? 'fail' : ''}" data-val="evEbit" data-raw="${s.evEbit ?? 99}">${fmt.num(s.evEbit)}</td>
      <td class="r mono ${ncPass ? 'pass' : s.netCashRatio != null ? 'fail' : ''}" data-val="ncr" data-raw="${s.netCashRatio ?? ''}">${fmt.pct(s.netCashRatio != null ? s.netCashRatio * 100 : null)}</td>
      <td>${esc(s.sector)}</td>
    </tr>`;
  }).join('');

  setContent('dv-content', `
    <div class="stats-bar">
      <span>Found <strong>${stocks.length}</strong> stocks</span>
      <span>P/E &lt; 10 · EV/EBIT &lt; 10 · Market cap $20M–$2B</span>
    </div>
    <div class="table-wrap">
      <table id="dv-table">
        <thead><tr>
          <th data-col="symbol">Ticker</th>
          <th>Name</th>
          <th>Exchange</th>
          <th class="r" data-col="price">Price</th>
          <th class="r" data-col="marketCap">Mkt Cap</th>
          <th class="r" data-col="pe">P/E</th>
          <th class="r" data-col="evEbit">EV/EBIT</th>
          <th class="r" data-col="ncr">Net Cash / MC</th>
          <th>Sector</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`);

  makeSortable(el('dv-table'));
}

/* ═══════════════════════════════════════════════════════════════════════════
   VALUE SCREENER
   ═══════════════════════════════════════════════════════════════════════════ */

async function loadValueScreener(region = 'us') {
  showLoading('vs-content', 'Running value screener — this may take ~20 s…');
  try {
    const r = await fetch(`/api/value-screener?region=${region}`);
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'API error');
    renderValueScreener(data);
  } catch (e) {
    showError('vs-content', e.message);
  }
}

function renderValueScreener(stocks) {
  if (!stocks.length) {
    setContent('vs-content', `
      <div class="empty">
        No stocks passed all five criteria simultaneously.<br>
        <span style="font-size:.75rem;margin-top:6px;display:block">
          P/E &lt; 15 · EV/EBIT &lt; 10 · 3-yr Rev CAGR ≥ 30% · 3-yr ROIC ≥ 30% · 3-yr ROE ≥ 30%
          are exceptionally strict — very few businesses sustain all metrics at once.
        </span>
      </div>`);
    return;
  }

  const rows = stocks.map(s => {
    const c = (v, pass) => pass ? 'pass' : 'fail';
    return `<tr>
      <td><span class="ticker">${s.symbol}</span></td>
      <td><div class="name-cell" title="${esc(s.name)}">${esc(s.name)}</div></td>
      <td class="r mono ${c(s.pe, s.pe < 15)}"         data-val="pe"      data-raw="${s.pe ?? 99}">${fmt.num(s.pe)}</td>
      <td class="r mono ${c(s.evEbit, s.evEbit < 10)}"  data-val="evEbit"  data-raw="${s.evEbit ?? 99}">${fmt.num(s.evEbit)}</td>
      <td class="r mono ${c(s.revCagr, s.revCagr >= 30)}" data-val="revCagr" data-raw="${s.revCagr ?? 0}">${fmt.pct(s.revCagr)}</td>
      <td class="r mono ${c(s.roic, s.roic >= 30)}"    data-val="roic"    data-raw="${s.roic ?? 0}">${fmt.pct(s.roic)}</td>
      <td class="r mono ${c(s.roe, s.roe >= 30)}"      data-val="roe"     data-raw="${s.roe ?? 0}">${fmt.pct(s.roe)}</td>
      <td class="r mono" data-val="marketCap" data-raw="${s.marketCap ?? ''}">${fmt.mc(s.marketCap)}</td>
      <td>${esc(s.sector)}</td>
    </tr>`;
  }).join('');

  setContent('vs-content', `
    <div class="stats-bar">
      <span>Found <strong>${stocks.length}</strong> stocks</span>
      <span>P/E &lt; 15 · EV/EBIT &lt; 10 · 3-yr Rev CAGR ≥ 30% · 3-yr ROIC ≥ 30% · 3-yr ROE ≥ 30%</span>
    </div>
    <div class="table-wrap">
      <table id="vs-table">
        <thead><tr>
          <th data-col="symbol">Ticker</th>
          <th>Name</th>
          <th class="r" data-col="pe">P/E</th>
          <th class="r" data-col="evEbit">EV/EBIT</th>
          <th class="r" data-col="revCagr">Rev CAGR</th>
          <th class="r" data-col="roic">ROIC</th>
          <th class="r" data-col="roe">ROE</th>
          <th class="r" data-col="marketCap">Mkt Cap</th>
          <th>Sector</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`);

  makeSortable(el('vs-table'));
}

/* ═══════════════════════════════════════════════════════════════════════════
   SPINOFFS 2026
   ═══════════════════════════════════════════════════════════════════════════ */

async function loadSpinoffs() {
  showLoading('sp-content', 'Loading spinoffs…');
  try {
    const r = await fetch('/api/spinoffs');
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'API error');
    renderSpinoffs(data);
  } catch (e) {
    showError('sp-content', e.message);
  }
}

function renderSpinoffs(list) {
  if (!list.length) {
    setContent('sp-content', '<div class="empty">No spinoffs data available.</div>');
    return;
  }

  const statusTag = s => {
    const cls = { Announced: 'tag-blue', Completed: 'tag-green', 'Under Review': 'tag-yellow' }[s] || 'tag-gray';
    return `<span class="tag ${cls}">${esc(s)}</span>`;
  };

  const regionTag = r => {
    const cls = r === 'EU' ? 'tag-yellow' : 'tag-blue';
    return `<span class="tag ${cls}">${esc(r)}</span>`;
  };

  const cards = list.map(s => `
    <div class="spinoff-card">
      <h3>${esc(s.spinoff)}${s.ticker ? ` <span class="ticker">${esc(s.ticker)}</span>` : ''}</h3>
      <div class="co">spun off from ${esc(s.parent)}</div>
      <div class="spinoff-meta">
        ${s.date   ? `<span class="tag tag-gray">${esc(s.date)}</span>` : ''}
        ${s.status ? statusTag(s.status) : ''}
        ${s.region ? regionTag(s.region) : ''}
        ${s.exchange ? `<span class="tag tag-gray">${esc(s.exchange)}</span>` : ''}
        ${s.sector   ? `<span class="tag tag-gray">${esc(s.sector)}</span>`   : ''}
      </div>
      ${s.notes ? `<p class="notes">${esc(s.notes)}</p>` : ''}
    </div>`).join('');

  setContent('sp-content', `
    <div class="stats-bar">
      <span><strong>${list.length}</strong> spinoffs</span>
      <span>Source: The Zen of Investing · FMP calendar</span>
    </div>
    <div class="spinoffs-grid">${cards}</div>`);
}

/* ═══════════════════════════════════════════════════════════════════════════
   NEWS & FILINGS
   ═══════════════════════════════════════════════════════════════════════════ */

async function loadNewsFilings(region = 'us') {
  showLoading('nf-content', 'Fetching filings…');
  try {
    const r = await fetch(`/api/news-filings?region=${region}`);
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'API error');
    renderNewsFilings(data, region);
  } catch (e) {
    showError('nf-content', e.message);
  }
}

function renderNewsFilings(items, region) {
  if (!items.length) {
    setContent('nf-content', '<div class="empty">No recent filings found.</div>');
    return;
  }

  const tagCls = t => ({
    'SC TO-T':  'tag-red',
    'SC TO-I':  'tag-red',
    'SC 13E-3': 'tag-yellow',
    '15-12G':   'tag-yellow',
    '25':       'tag-yellow',
    'NEWS':     'tag-blue',
  }[t] || 'tag-gray');

  const cards = items.map(it => `
    <div class="news-card">
      <div class="type-col">
        <span class="tag ${tagCls(it.type)}">${esc(it.label || it.type)}</span>
      </div>
      <div class="body">
        <h3>${esc(it.title)}</h3>
        <p>${[it.date, it.company, it.ticker ? `(${it.ticker})` : ''].filter(Boolean).join(' · ')}</p>
        ${it.url ? `<a href="${esc(it.url)}" target="_blank" rel="noopener noreferrer">View filing →</a>` : ''}
      </div>
    </div>`).join('');

  const src = region === 'us'
    ? 'SEC EDGAR — SC TO-T, SC TO-I, SC 13E-3, 15-12G, 25'
    : 'FMP News — M&A / event-driven filter';

  setContent('nf-content', `
    <div class="stats-bar">
      <span><strong>${items.length}</strong> filings</span>
      <span>${src}</span>
    </div>
    <div class="news-list">${cards}</div>`);
}

/* ─── XSS helper ─────────────────────────────────────────────────────────── */

function esc(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* ─── Init ───────────────────────────────────────────────────────────────── */

window.addEventListener('DOMContentLoaded', () => {
  // Bind region toggles (static elements present at load)
  bindRegionToggles('deep-value',     loadDeepValue);
  bindRegionToggles('value-screener', loadValueScreener);
  bindRegionToggles('news-filings',   loadNewsFilings);

  // Mark first tab loaded and kick off initial data fetch
  qs('.tab[data-tab="deep-value"]').dataset.loaded = '1';
  loadDeepValue('us');
});
