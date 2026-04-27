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

function setContent(id, html)          { el(id).innerHTML = html; }
function showLoading(id, msg = 'Loading…') { setContent(id, `<div class="loading">${msg}</div>`); }
function showError(id, msg)            { setContent(id, `<div class="error">${msg}</div>`); }

function esc(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/* ─── Sortable tables ────────────────────────────────────────────────────── */

function makeSortable(table) {
  let sortCol = null, sortDir = 1;
  table.querySelectorAll('th[data-col]').forEach(th => {
    th.addEventListener('click', () => {
      const col = th.dataset.col;
      sortDir = sortCol === col ? -sortDir : 1;
      sortCol = col;
      table.querySelectorAll('th').forEach(h => h.classList.remove('sort-asc', 'sort-desc'));
      th.classList.add(sortDir === 1 ? 'sort-asc' : 'sort-desc');

      const tbody = table.querySelector('tbody');
      Array.from(tbody.querySelectorAll('tr'))
        .sort((a, b) => {
          const av = a.querySelector(`td[data-col="${col}"]`)?.dataset.raw ?? '';
          const bv = b.querySelector(`td[data-col="${col}"]`)?.dataset.raw ?? '';
          const an = parseFloat(av), bn = parseFloat(bv);
          return (!isNaN(an) && !isNaN(bn) ? an - bn : av.localeCompare(bv)) * sortDir;
        })
        .forEach(r => tbody.appendChild(r));
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
    if (!tab.dataset.loaded) { tab.dataset.loaded = '1'; loadModule(target, 'us'); }
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
    const r    = await fetch(`/api/deep-value?region=${region}`);
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
    renderDeepValue(data);
  } catch (e) { showError('dv-content', e.message); }
}

function renderDeepValue(stocks) {
  if (!stocks.length) {
    setContent('dv-content', '<div class="empty">No stocks matched the criteria — try Europe or check your FMP plan.</div>');
    return;
  }

  const rows = stocks.map(s => {
    const sym    = fmt.currSym(s.currency);
    const pePass = s.pe != null && s.pe < 10;
    const evPass = s.evEbit != null && s.evEbit > 0 && s.evEbit < 10;
    const ncPass = s.netCashRatio != null && s.netCashRatio > 0;

    return `<tr>
      <td><span class="ticker">${esc(s.symbol)}</span></td>
      <td><div class="name-cell" title="${esc(s.name)}">${esc(s.name)}</div></td>
      <td>${esc(s.exchange)}</td>
      <td class="r mono" data-col="price"     data-raw="${s.price ?? ''}">${fmt.price(s.price, sym)}</td>
      <td class="r mono" data-col="marketCap" data-raw="${s.marketCap ?? ''}">${fmt.mc(s.marketCap)}</td>
      <td class="r mono ${pePass ? 'pass' : ''}"  data-col="pe"     data-raw="${s.pe ?? 99}">${fmt.num(s.pe)}</td>
      <td class="r mono ${evPass ? 'pass' : (s.evEbit != null ? 'fail' : '')}" data-col="evEbit" data-raw="${s.evEbit ?? 99}">${fmt.num(s.evEbit)}</td>
      <td class="r mono ${ncPass ? 'pass' : (s.netCashRatio != null ? 'fail' : '')}" data-col="ncr" data-raw="${s.netCashRatio ?? ''}">${s.netCashRatio != null ? fmt.pct(s.netCashRatio * 100) : '—'}</td>
      <td>${esc(s.sector)}</td>
    </tr>`;
  }).join('');

  setContent('dv-content', `
    <div class="stats-bar">
      <span>Found <strong>${stocks.length}</strong> stocks</span>
      <span>P/E &lt; 10 · EV/EBIT &lt; 10 · Mkt cap $20M–$2B</span>
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
  showLoading('vs-content', 'Running value screener — may take ~20 s…');
  try {
    const r    = await fetch(`/api/value-screener?region=${region}`);
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
    renderValueScreener(data);
  } catch (e) { showError('vs-content', e.message); }
}

function renderValueScreener(stocks) {
  if (!stocks.length) {
    setContent('vs-content', `
      <div class="empty">
        No stocks passed all five criteria simultaneously.<br>
        <small>P/E &lt; 15 · EV/EBIT &lt; 10 · 3-yr Rev CAGR ≥ 30% · 3-yr ROIC ≥ 30% · 3-yr ROE ≥ 30%
        are exceptionally strict — very few companies sustain all at once.</small>
      </div>`);
    return;
  }

  const rows = stocks.map(s => {
    const c = (pass) => pass ? 'pass' : 'fail';
    return `<tr>
      <td><span class="ticker">${esc(s.symbol)}</span></td>
      <td><div class="name-cell" title="${esc(s.name)}">${esc(s.name)}</div></td>
      <td class="r mono ${c(s.pe < 15)}"           data-col="pe"      data-raw="${s.pe ?? 99}">${fmt.num(s.pe)}</td>
      <td class="r mono ${c(s.evEbit < 10)}"        data-col="evEbit"  data-raw="${s.evEbit ?? 99}">${fmt.num(s.evEbit)}</td>
      <td class="r mono ${c(s.revCagr >= 30)}"      data-col="revCagr" data-raw="${s.revCagr ?? 0}">${fmt.pct(s.revCagr)}</td>
      <td class="r mono ${c(s.roic >= 30)}"         data-col="roic"    data-raw="${s.roic ?? 0}">${fmt.pct(s.roic)}</td>
      <td class="r mono ${c(s.roe >= 30)}"          data-col="roe"     data-raw="${s.roe ?? 0}">${fmt.pct(s.roe)}</td>
      <td class="r mono" data-col="marketCap" data-raw="${s.marketCap ?? ''}">${fmt.mc(s.marketCap)}</td>
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
   SPINOFFS — sortable table with live financial metrics
   ═══════════════════════════════════════════════════════════════════════════ */

async function loadSpinoffs() {
  showLoading('sp-content', 'Fetching spinoffs & live metrics…');
  try {
    const r    = await fetch('/api/spinoffs');
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
    renderSpinoffs(data);
  } catch (e) { showError('sp-content', e.message); }
}

function renderSpinoffs(list) {
  if (!list.length) {
    setContent('sp-content', '<div class="empty">No spinoffs data available.</div>');
    return;
  }

  const statusCls = { Completed: 'tag-green', Announced: 'tag-blue', 'Under Review': 'tag-yellow' };
  const regionCls = { US: 'tag-blue', EU: 'tag-yellow' };

  const rows = list.map(s => {
    const sym = fmt.currSym(s.currency);
    const parentNote = s.isParent
      ? `<span class="tag tag-gray" title="Spinoff not yet trading — metrics from parent">parent</span>` : '';

    // Insider: colour by net bias
    let insiderHtml = '—';
    if (s.insiderSummary) {
      const [b, sl] = s.insiderSummary.split(' / ').map(p => parseInt(p));
      const cls = b > sl ? 'pass' : (sl > b ? 'fail' : '');
      insiderHtml = `<span class="${cls}">${esc(s.insiderSummary)}</span>`;
    }

    return `<tr>
      <td>
        <div style="display:flex;align-items:center;gap:6px">
          <span class="ticker">${esc(s.ticker)}</span>${parentNote}
        </div>
        <div class="name-cell" title="${esc(s.spinoff)}">${esc(s.spinoff)}</div>
      </td>
      <td><div class="name-cell" title="${esc(s.parent)}">${esc(s.parent)}</div></td>
      <td>
        <span class="tag ${statusCls[s.status] || 'tag-gray'}">${esc(s.status)}</span>
        <span class="tag ${regionCls[s.region] || 'tag-gray'}">${esc(s.region)}</span>
      </td>
      <td>${esc(s.date)}</td>
      <td class="r mono ${s.pe != null && s.pe > 0 && s.pe < 15 ? 'pass' : ''}"
          data-col="pe" data-raw="${s.pe ?? 999}">${fmt.num(s.pe)}</td>
      <td class="r mono ${s.evEbit != null && s.evEbit > 0 && s.evEbit < 10 ? 'pass' : ''}"
          data-col="evEbit" data-raw="${s.evEbit ?? 999}">${fmt.num(s.evEbit)}</td>
      <td class="r mono ${s.roic != null && s.roic >= 15 ? 'pass' : ''}"
          data-col="roic" data-raw="${s.roic ?? ''}">${fmt.pct(s.roic)}</td>
      <td class="r mono ${s.revCagr != null && s.revCagr >= 10 ? 'pass' : ''}"
          data-col="revCagr" data-raw="${s.revCagr ?? ''}">${fmt.pct(s.revCagr)}</td>
      <td class="r mono" data-col="insiderSummary" data-raw="${s.insiderSummary ?? ''}">${insiderHtml}</td>
      <td class="r mono" data-col="marketCap" data-raw="${s.marketCap ?? ''}">${fmt.mc(s.marketCap)}</td>
      <td>${esc(s.sector)}</td>
    </tr>`;
  }).join('');

  setContent('sp-content', `
    <div class="stats-bar">
      <span><strong>${list.length}</strong> spinoffs</span>
      <span>Live metrics from FMP · 90-day insider activity · Source: The Zen of Investing</span>
    </div>
    <div class="table-wrap">
      <table id="sp-table">
        <thead><tr>
          <th data-col="symbol">Spinoff / Ticker</th>
          <th>Parent</th>
          <th>Status</th>
          <th>Date</th>
          <th class="r" data-col="pe">P/E</th>
          <th class="r" data-col="evEbit">EV/EBIT</th>
          <th class="r" data-col="roic">ROIC</th>
          <th class="r" data-col="revCagr">Rev CAGR</th>
          <th class="r" data-col="insiderSummary">Insider 90d</th>
          <th class="r" data-col="marketCap">Mkt Cap</th>
          <th>Sector</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <p style="margin-top:10px;font-size:.74rem;color:var(--muted)">
      <em>parent</em> tag = spinoff not yet listed; metrics are from the parent company. Green = favourable. Insider activity: B = buys, S = sells (last 90 days).
    </p>`);

  makeSortable(el('sp-table'));
}

/* ═══════════════════════════════════════════════════════════════════════════
   NEWS & FILINGS
   ═══════════════════════════════════════════════════════════════════════════ */

async function loadNewsFilings(region = 'us') {
  showLoading('nf-content', 'Fetching filings…');
  try {
    const r    = await fetch(`/api/news-filings?region=${region}`);
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
    renderNewsFilings(data, region);
  } catch (e) { showError('nf-content', e.message); }
}

function renderNewsFilings(items, region) {
  if (!items.length) {
    setContent('nf-content', '<div class="empty">No recent filings found.</div>');
    return;
  }

  const tagCls = { 'SC TO-T': 'tag-red', 'SC TO-I': 'tag-red', 'SC 13E-3': 'tag-yellow',
                   '15-12G': 'tag-yellow', '25': 'tag-yellow', 'NEWS': 'tag-blue' };

  const cards = items.map(it => `
    <div class="news-card">
      <div class="type-col">
        <span class="tag ${tagCls[it.type] || 'tag-gray'}">${esc(it.label || it.type)}</span>
      </div>
      <div class="body">
        <h3>${esc(it.title)}</h3>
        <p>${[it.date, it.ticker ? `(${it.ticker})` : it.company].filter(Boolean).join(' · ')}</p>
        ${it.url ? `<a href="${esc(it.url)}" target="_blank" rel="noopener noreferrer">View filing →</a>` : ''}
      </div>
    </div>`).join('');

  const src = region === 'us'
    ? 'SEC EDGAR RSS — SC TO-T · SC TO-I · SC 13E-3 · 15-12G · 25'
    : 'FMP News — M&A / event-driven filter';

  setContent('nf-content', `
    <div class="stats-bar">
      <span><strong>${items.length}</strong> filings</span>
      <span>${src}</span>
    </div>
    <div class="news-list">${cards}</div>`);
}

/* ─── Init ───────────────────────────────────────────────────────────────── */

window.addEventListener('DOMContentLoaded', () => {
  bindRegionToggles('deep-value',     loadDeepValue);
  bindRegionToggles('value-screener', loadValueScreener);
  bindRegionToggles('news-filings',   loadNewsFilings);

  qs('.tab[data-tab="deep-value"]').dataset.loaded = '1';
  loadDeepValue('us');
});
