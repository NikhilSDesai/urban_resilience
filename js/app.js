import { computeHex, summarise, unpack, SCENARIOS, DEFAULTS, INTERVENTIONS, HAZARDS } from './model.js';

const $ = (id) => document.getElementById(id);
const el = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstChild; };

// ---- Formatting ($ values are in millions) ---------------------------------
const money = (m) => {
  const a = Math.abs(m);
  if (a >= 1000) return `$${(m / 1000).toFixed(a >= 10000 ? 0 : 1)}B`;
  if (a >= 1) return `$${m.toFixed(a >= 100 ? 0 : 1)}M`;
  if (a >= 0.001) return `$${Math.round(m * 1000)}K`;
  return '$0';
};
const num = (v) => Math.round(v).toLocaleString('en-US');
const big = (v) => (v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : num(v));
const idx = (v) => v.toFixed(2);
const times = (v) => `${v.toFixed(1)}x`;
const years = (v) => (Number.isFinite(v) && v < 99 ? `${v.toFixed(v < 10 ? 1 : 0)} yr` : 'never');

// ---- Colour ramps -----------------------------------------------------------
const RAMPS = {
  hazard: ['#17120f', '#4a1512', '#8f1d18', '#d02a22', '#ff5a3c'],
  money: ['#15130f', '#4a3410', '#8f6417', '#d39a2c', '#ffd772'],
  people: ['#10141a', '#1c3350', '#2b5f93', '#4a97cf', '#a6dcff'],
  gain: ['#0e1614', '#0f3b33', '#16705c', '#2fb692', '#8ff5d0'],
};
const hex2rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const RAMP_RGB = Object.fromEntries(Object.entries(RAMPS).map(([k, v]) => [k, v.map(hex2rgb)]));
function rampColor(name, t) {
  const stops = RAMP_RGB[name], x = Math.max(0, Math.min(1, t)) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(x)), f = x - i;
  const c = stops[i].map((a, k) => Math.round(a + (stops[i + 1][k] - a) * f));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}
const NO_RETURN = '#3a3c42';

// ---- Layers: what the map can show -----------------------------------------
// get(h, c): h is the cell's inputs, c its model results. null hides the cell.
const opt = (c) => (state.measure === 'best' ? c.best : c.options[state.measure]);
const LAYERS = {
  hazard: { label: 'Combined hazard', unit: 'index 0 to 1', ramp: 'hazard', fmt: idx, get: (h, c) => c.hazard },
  hCoast: { label: HAZARDS.coast, unit: 'index 0 to 1', ramp: 'hazard', fmt: idx, get: (h, c) => c.hCoast },
  hRain: { label: HAZARDS.rain, unit: 'index 0 to 1', ramp: 'hazard', fmt: idx, get: (h, c) => c.hRain },
  hWind: { label: HAZARDS.wind, unit: 'index 0 to 1', ramp: 'hazard', fmt: idx, get: (h, c) => c.hWind },
  hHeat: { label: HAZARDS.heat, unit: 'index 0 to 1', ramp: 'hazard', fmt: idx, get: (h, c) => c.hHeat },
  sensitivity: { label: 'Social sensitivity', unit: 'index 0 to 1', ramp: 'hazard', fmt: idx, get: (h, c) => c.sensitivity },
  a65: { label: 'Population aged 65+', unit: '% of residents', ramp: 'people', fmt: (v) => `${v.toFixed(0)}%`, get: (h) => h.a65 },
  inc: { label: 'Household income', unit: '$ thousand, median', ramp: 'people', fmt: (v) => `$${v.toFixed(0)}K`, get: (h) => h.inc },
  yb: { label: 'Typical year built', unit: 'year', ramp: 'people', fmt: (v) => v.toFixed(0), get: (h) => h.yb },
  el: { label: 'Ground elevation', unit: 'metres', ramp: 'people', fmt: (v) => `${v.toFixed(1)} m`, get: (h) => h.el },
  imp: { label: 'Hard surface cover', unit: 'share of land', ramp: 'people', fmt: idx, get: (h) => h.imp },
  can: { label: 'Tree canopy', unit: 'share of land', ramp: 'gain', fmt: idx, get: (h) => h.can },
  val: { label: 'Property value', unit: 'per cell', ramp: 'money', fmt: money, get: (h) => h.val },
  jobs: { label: 'Jobs', unit: 'per cell', ramp: 'people', fmt: num, get: (h) => h.jobs },
  pop: { label: 'Residents', unit: 'per cell', ramp: 'people', fmt: num, get: (h) => h.pop },
  crit: { label: 'Network criticality', unit: 'index 0 to 1', ramp: 'money', fmt: idx, get: (h) => h.crit },
  eal: { label: 'Expected yearly loss', unit: 'per cell', ramp: 'money', fmt: money, get: (h, c) => c.eal },
  ealPct: { label: 'Yearly loss as a share of value', unit: '%', ramp: 'money', fmt: (v) => `${v.toFixed(1)}%`, get: (h, c) => c.ealPct },
  propLoss: { label: 'Property damage', unit: 'per year', ramp: 'money', fmt: money, get: (h, c) => c.propLoss },
  biLoss: { label: 'Lost business days', unit: 'per year', ramp: 'money', fmt: money, get: (h, c) => c.biLoss },
  cascadeLoss: { label: 'Knock-on loss to the region', unit: 'per year', ramp: 'money', fmt: money, get: (h, c) => c.cascadeLoss },
  best: { label: 'Best-paying measure', categorical: true, get: (h, c) => (c.best.npv > 0 ? c.best.id : 'none') },
  bcr: { label: 'Return per dollar', unit: 'benefit to cost', ramp: 'gain', fmt: times, get: (h, c) => { const o = opt(c); return o ? o.bcr : null; } },
  npv: { label: 'Net present value', unit: 'per cell', ramp: 'gain', fmt: money, get: (h, c) => { const o = opt(c); return o && o.npv > 0 ? o.npv : null; } },
  payback: { label: 'Payback period', unit: 'years, shorter is better', ramp: 'gain', invert: true, fmt: years, get: (h, c) => { const o = opt(c); return o && o.npv > 0 ? Math.min(60, o.payback) : null; } },
  capex: { label: 'Capital needed', unit: 'per cell', ramp: 'money', fmt: money, get: (h, c) => { const o = opt(c); return o && o.npv > 0 ? o.capex : null; } },
  taxPV: { label: 'Property tax protected', unit: 'present value', ramp: 'gain', fmt: money, get: (h, c) => { const o = opt(c); return o && o.npv > 0 ? o.taxPV : null; } },
};

const VIEWS = [
  { id: 'overview', tab: 'Overview', layer: 'eal', title: 'Where adaptation pays',
    text: 'Each cell is scored for what climate hazards cost it every year and what the best adaptation measure would return. Change the scenario above and the whole county recalculates.' },
  { id: 'risk', tab: 'Risk diagnostics', layer: 'hazard', title: 'Risk diagnostics',
    text: 'Inspect coastal flooding, rainfall flooding, wind and heat across Miami-Dade, and who is most sensitive to them. Pick a row to map it.' },
  { id: 'economy', tab: 'Economic exposure', layer: 'val', title: 'Economic exposure',
    text: 'What sits in harm’s way, and how a shock in one place spreads. Cells the regional economy depends on carry a knock-on loss beyond their own walls.' },
  { id: 'measures', tab: 'Interventions', layer: 'best', title: 'Intervention modeling',
    text: 'Five adaptation measures are tested in every cell. The map shows which one pays best, or the return of a single measure everywhere it is eligible.' },
  { id: 'returns', tab: 'Return on investment', layer: 'bcr', title: 'Return on investment',
    text: 'The financial case, cell by cell, and who captures the benefit. This is the starting point for deciding who should pay.' },
  { id: 'priority', tab: 'Priority schedule', layer: 'npv', title: 'Priority schedule',
    text: 'Neighbourhoods ranked by the net value of funding every measure that pays for itself. Pick one to fly there.' },
];

const state = {
  view: 'overview', layer: 'eal', measure: 'best', scale: 'emphasis', base: 'satellite',
  params: { ...DEFAULTS }, selected: null,
};
let data, hexes, results, summary, map, geo, values = [], scaleInfo = null;

// ---- Model -----------------------------------------------------------------
function recompute() {
  results = hexes.map((h) => computeHex(h, state.params));
  summary = summarise(hexes, results, data.areas, state.measure);
}

// ---- Map colouring ---------------------------------------------------------
function paint() {
  const L = LAYERS[state.layer];
  values = hexes.map((h, i) => L.get(h, results[i]));
  if (L.categorical) {
    const colors = Object.fromEntries(INTERVENTIONS.map((m) => [m.id, m.color]));
    geo.features.forEach((f, i) => { f.properties.c = colors[values[i]] || NO_RETURN; f.properties.o = values[i] === 'none' ? 0.35 : 1; });
    scaleInfo = null;
  } else {
    const present = values.filter((v) => v !== null && Number.isFinite(v)).sort((a, b) => a - b);
    const q = (p) => (present.length ? present[Math.min(present.length - 1, Math.floor(p * present.length))] : 0);
    const lo = q(0.02), hi = q(0.98);
    // Emphasis spreads colour by rank so detail shows in the crowded middle.
    const rank = (v) => {
      let a = 0, b = present.length;
      while (a < b) { const m = (a + b) >> 1; if (present[m] < v) a = m + 1; else b = m; }
      return present.length > 1 ? a / (present.length - 1) : 0;
    };
    geo.features.forEach((f, i) => {
      const v = values[i];
      if (v === null || !Number.isFinite(v)) { f.properties.c = '#000'; f.properties.o = 0; return; }
      let t = state.scale === 'emphasis' ? rank(v) : (hi > lo ? (v - lo) / (hi - lo) : 0);
      if (L.invert) t = 1 - t;
      f.properties.c = rampColor(L.ramp, t);
      f.properties.o = 1;
    });
    scaleInfo = { lo, hi, shown: present.length };
  }
  if (map && map.getSource('hex')) map.getSource('hex').setData(geo);
  renderLegend();
}

function renderLegend() {
  const L = LAYERS[state.layer], box = $('legend');
  const m = INTERVENTIONS.find((x) => x.id === state.measure);
  const scoped = ['bcr', 'npv', 'payback', 'capex', 'taxPV'].includes(state.layer);
  const who = scoped ? `<small>${m ? m.label : 'best measure per cell'}</small>` : (L.unit ? `<small>${L.unit}</small>` : '');
  if (L.categorical) {
    box.innerHTML = `<div class="legend-head"><span class="legend-name">${L.label}</span></div>
      <div class="swatches">${INTERVENTIONS.map((x) => `<span class="swatch"><i style="background:${x.color}"></i>${x.label}</span>`).join('')}
      <span class="swatch"><i style="background:${NO_RETURN}"></i>Nothing pays back</span></div>`;
    return;
  }
  const stops = L.invert ? [...RAMPS[L.ramp]].reverse() : RAMPS[L.ramp];
  const hidden = hexes.length - scaleInfo.shown;
  box.innerHTML = `<div class="legend-head">
      <span class="legend-name">${L.label} ${who}</span>
      <div class="seg" role="group" aria-label="Colour scale">
        <button type="button" data-scale="linear" aria-pressed="${state.scale === 'linear'}">Linear</button>
        <button type="button" data-scale="emphasis" aria-pressed="${state.scale === 'emphasis'}">Emphasis</button>
      </div></div>
    <div class="ramp" style="background:linear-gradient(90deg, ${stops.join(',')})">
      <span>${L.fmt(scaleInfo.lo)}</span><span>${L.fmt(scaleInfo.hi)}</span></div>
    ${hidden > 0 ? `<p class="legend-note">${num(hidden)} cells are blank: the measure is not eligible there or does not pay back.</p>` : ''}`;
  box.querySelectorAll('[data-scale]').forEach((b) => b.addEventListener('click', () => { state.scale = b.dataset.scale; paint(); }));
}

// ---- Panel views -----------------------------------------------------------
const row = (layer, label, extra = '', lead = '') =>
  `<li><button type="button" class="row" data-layer="${layer}" aria-pressed="${state.layer === layer}">${lead}<span class="row-main">${label}</span>${extra}</button></li>`;
const pie = (p) => `<i class="pie" style="--p:${p}"></i>`;
const weight = (p) => `<span class="w">${p}%</span>`;

function stackBar(parts) {
  const total = parts.reduce((s, p) => s + p.v, 0) || 1;
  return `<div class="stack" role="img" aria-label="${parts.map((p) => `${p.label} ${money(p.v)}`).join(', ')}">${parts.map((p) => `<i style="width:${p.v / total * 100}%;background:${p.color}"></i>`).join('')}</div>
    <div class="keys">${parts.map((p) => `<div><i style="background:${p.color}"></i>${p.label}<b>${money(p.v)}</b></div>`).join('')}</div>`;
}

const BODY = {
  overview() {
    const t = summary.tot;
    return `<div class="kpis">
      <div class="kpi lead"><b>${times(t.bcr)}</b><span>returned for every dollar, if every measure that pays for itself is funded</span></div>
      <div class="kpi"><b>${money(t.eal)}</b><span>expected loss every year</span></div>
      <div class="kpi"><b>${money(t.capex)}</b><span>capital that pays back</span></div>
      <div class="kpi"><b>${money(t.avoided)}</b><span>loss avoided every year</span></div>
      <div class="kpi"><b>${money(t.npv)}</b><span>net present value</span></div>
    </div>
    <div class="card" style="margin-top:10px"><h2>What the yearly loss is made of</h2>
      ${stackBar([
        { label: 'Property damage', v: t.propLoss, color: '#e3a93c' },
        { label: 'Lost business days', v: t.biLoss, color: '#4a97cf' },
        { label: 'Knock-on regional loss', v: t.cascadeLoss, color: '#c58be0' },
        { label: 'Heat costs', v: t.heatLoss, color: '#e5352c' },
      ])}</div>
    <div class="card" style="margin-top:10px"><h2>${num(t.funded)} of ${num(t.cells)} cells have a measure that pays back</h2>
      <p class="hint">${money(t.value)} of property, ${big(t.pop)} residents and ${big(t.jobs)} jobs are in the model.</p></div>`;
  },
  risk() {
    return `<div class="group-title"><span>Hazard</span></div>
      <ul class="tree">${row('hazard', 'Combined hazard index', '', pie(100))}
        <ul class="tree">${row('hCoast', HAZARDS.coast, weight(35), pie(35))}${row('hRain', HAZARDS.rain, weight(25), pie(25))}
        ${row('hWind', HAZARDS.wind, weight(20), pie(20))}${row('hHeat', HAZARDS.heat, weight(20), pie(20))}</ul></ul>
      <div class="group-title"><span>Sensitivity</span></div>
      <ul class="tree">${row('sensitivity', 'Social sensitivity index', '', pie(100))}
        <ul class="tree">${row('a65', 'Population aged 65+', weight(40), pie(40))}${row('inc', 'Household income', weight(35), pie(35))}
        ${row('yb', 'Typical year built', weight(25), pie(25))}</ul></ul>
      <div class="group-title"><span>Physical inputs</span></div>
      <ul class="tree">${row('el', 'Ground elevation')}${row('imp', 'Hard surface cover')}${row('can', 'Tree canopy')}</ul>`;
  },
  economy() {
    const t = summary.tot, v = (x) => `<span class="val">${x}</span>`;
    return `<div class="group-title"><span>What is exposed</span></div>
      <ul class="tree">${row('val', 'Property value', v(money(t.value)))}${row('jobs', 'Jobs', v(big(t.jobs)))}${row('pop', 'Residents', v(big(t.pop)))}</ul>
      <div class="group-title"><span>What it costs every year</span></div>
      <ul class="tree">${row('eal', 'Expected yearly loss', v(money(t.eal)))}
        <ul class="tree">${row('propLoss', 'Property damage', v(money(t.propLoss)))}${row('biLoss', 'Lost business days', v(money(t.biLoss)))}
        ${row('cascadeLoss', 'Knock-on loss to the region', v(money(t.cascadeLoss)))}</ul>
        ${row('ealPct', 'Yearly loss as a share of value')}</ul>
      <div class="group-title"><span>How shocks spread</span></div>
      <ul class="tree">${row('crit', 'Network criticality')}</ul>
      <div class="card" style="margin-top:10px"><h2>Critical places in this model</h2>
        <p class="hint">${data.nodes.map((n) => n.name).join(', ')}. In the full product these come from the business and labour network, not a hand-picked list.</p></div>`;
  },
  measures() {
    const bm = summary.byMeasure;
    const item = (id, label, sub, color) => `<li><button type="button" class="row" data-measure="${id}" aria-pressed="${state.measure === id}">
      <i class="dot" style="background:${color}"></i><span class="row-main">${label}<span class="sub">${sub}</span></span></button></li>`;
    const all = hexes.length ? INTERVENTIONS.map((m) => {
      let cells = 0, capex = 0, pvB = 0, pvC = 0;
      results.forEach((c) => { const o = c.options[m.id]; if (o && o.npv > 0) { cells++; capex += o.capex; pvB += o.pvBenefit; pvC += o.pvCost; } });
      const sub = cells ? `Pays back in ${num(cells)} cells. ${money(capex)} of capital returns ${times(pvB / pvC)}.` : 'Does not pay back anywhere under this scenario.';
      return item(m.id, m.label, `${m.note} ${sub}`, m.color);
    }).join('') : '';
    const mixCount = Object.values(bm).reduce((s, x) => s + x.cells, 0);
    return `<ul class="tree">${item('best', 'Best-paying measure in each cell', `${num(mixCount)} cells funded across all five measures.`, 'linear-gradient(135deg,#4aa8d8,#5fbf8f)')}${all}</ul>`;
  },
  returns() {
    const t = summary.tot, v = (x) => `<span class="val">${x}</span>`;
    return `<ul class="tree">${row('bcr', 'Return per dollar', v(times(t.bcr)))}${row('npv', 'Net present value', v(money(t.npv)))}
        ${row('payback', 'Payback period')}${row('capex', 'Capital needed', v(money(t.capex)))}${row('taxPV', 'Property tax protected', v(money(t.taxPV)))}</ul>
      <div class="card" style="margin-top:10px"><h2>Who captures the ${money(t.avoided)} avoided each year</h2>
        ${stackBar([
          { label: 'Property owners and insurers', v: t.owners, color: '#e3a93c' },
          { label: 'Employers', v: t.business, color: '#4a97cf' },
          { label: 'Households', v: t.households, color: '#3fcfa6' },
        ])}
        <p class="hint" style="margin-top:10px">Local government would also keep ${money(t.taxPV)} of property tax, in present value, that falling values would otherwise erase. It is not counted in the return.</p></div>`;
  },
  priority() {
    const rows = summary.byArea.filter((a) => a.npv > 0).sort((a, b) => b.npv - a.npv);
    if (!rows.length) return '<div class="card"><h2>Nothing pays back under this scenario</h2><p class="hint">Lower the discount rate or lengthen the period.</p></div>';
    const lab = Object.fromEntries(INTERVENTIONS.map((m) => [m.id, m]));
    return `<table class="table"><thead><tr><th>Neighbourhood</th><th>Capital</th><th>Avoided / yr</th><th>Net value</th><th>Return</th></tr></thead><tbody>
      ${rows.map((a, i) => `<tr class="pick" tabindex="0" data-area="${a.idx}">
        <td><span class="rank">${i + 1}</span><span class="name">${a.name}</span>
          <span class="lead-m"><span class="rank"></span><i class="dot" style="background:${lab[a.lead].color};width:8px;height:8px"></i>${lab[a.lead].label}</span></td>
        <td>${money(a.capex)}</td><td>${money(a.avoided)}</td><td>${money(a.npv)}</td><td class="bcr">${times(a.bcr)}</td></tr>`).join('')}
      </tbody></table>`;
  },
};

function renderView() {
  const v = VIEWS.find((x) => x.id === state.view);
  $('viewTitle').textContent = v.title;
  $('viewText').textContent = v.text;
  const body = $('viewBody');
  body.innerHTML = BODY[state.view]();
  body.querySelectorAll('[data-layer]').forEach((b) => b.addEventListener('click', () => { state.layer = b.dataset.layer; paint(); syncRows(); }));
  body.querySelectorAll('[data-measure]').forEach((b) => b.addEventListener('click', () => {
    state.measure = b.dataset.measure;
    state.layer = state.measure === 'best' ? 'best' : 'bcr';
    summary = summarise(hexes, results, data.areas, state.measure);
    paint(); renderView(); renderDetail();
  }));
  body.querySelectorAll('[data-area]').forEach((r) => {
    const go = () => { const a = data.areas[+r.dataset.area]; map.flyTo({ center: [a.lon, a.lat], zoom: 12.6, speed: 0.9 }); };
    r.addEventListener('click', go);
    r.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
  });
}
function syncRows() {
  $('viewBody').querySelectorAll('[data-layer]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.layer === state.layer));
}

function setView(id) {
  state.view = id;
  const v = VIEWS.find((x) => x.id === id);
  // The priority list always ranks the best measure per cell.
  if (id === 'priority' || id === 'overview') state.measure = 'best';
  state.layer = id === 'measures' ? (state.measure === 'best' ? 'best' : 'bcr') : v.layer;
  summary = summarise(hexes, results, data.areas, state.measure);
  document.querySelectorAll('.tab').forEach((t) => t.setAttribute('aria-selected', t.dataset.view === id));
  renderView(); paint(); renderDetail();
  $('panelScroll').scrollTop = 0;
}

// ---- Cell detail -----------------------------------------------------------
function renderDetail() {
  const box = $('detail'), i = state.selected;
  if (map && map.getLayer('hex-pick')) map.setFilter('hex-pick', ['==', ['get', 'i'], i ?? -1]);
  if (i === null) { box.hidden = true; return; }
  const h = hexes[i], c = results[i], b = c.best, m = INTERVENTIONS.find((x) => x.id === b.id);
  const pays = b.npv > 0;
  box.hidden = false;
  box.innerHTML = `<header><div><h2>${data.areas[h.area].name}</h2>
      <p class="where">${h.el.toFixed(1)} m above sea level, ${h.dc.toFixed(1)} km from the bay</p></div>
      <button class="x" type="button" aria-label="Close">×</button></header>
    <dl class="facts"><div><dt>Property</dt><dd>${money(h.val)}</dd></div><div><dt>Residents</dt><dd>${num(h.pop)}</dd></div><div><dt>Jobs</dt><dd>${num(h.jobs)}</dd></div></dl>
    <h3>Expected yearly loss <b>${money(c.eal)}</b></h3>
    ${stackBar([
      { label: 'Property', v: c.propLoss, color: '#e3a93c' }, { label: 'Business days', v: c.biLoss, color: '#4a97cf' },
      { label: 'Knock-on', v: c.cascadeLoss, color: '#c58be0' }, { label: 'Heat', v: c.heatLoss, color: '#e5352c' },
    ])}
    <div class="verdict"><strong><i class="dot" style="background:${pays ? m.color : NO_RETURN}"></i>${pays ? `${m.label}<small>highest net value</small>` : 'No measure pays back here'}</strong>
      ${pays ? `<p>${money(b.capex)} of capital avoids ${money(b.avoided)} a year. That returns <span class="big">${times(b.bcr)}</span> and pays back in ${years(b.payback)}.</p>`
        : `<p>The closest is ${m.label.toLowerCase()} at ${times(b.bcr)}.</p>`}</div>
    <ul class="opts">${INTERVENTIONS.map((x) => { const o = c.options[x.id];
      return `<li class="${!o || o.npv <= 0 ? 'neg' : ''}"><i class="dot" style="background:${x.color}"></i>${x.label}<b>${o ? times(o.bcr) : 'not eligible'}</b></li>`; }).join('')}</ul>`;
  box.querySelector('.x').addEventListener('click', () => { state.selected = null; renderDetail(); });
}

// ---- Controls --------------------------------------------------------------
function seg(host, options, current, onPick) {
  host.innerHTML = options.map((o) => `<button type="button" data-v="${o.v}" aria-pressed="${String(o.v) === String(current)}">${o.label}</button>`).join('');
  host.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
    host.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', x === b));
    onPick(b.dataset.v);
  }));
}
function scenarioChanged() {
  const s = SCENARIOS[state.params.year];
  toast(`Sea level <b>${s.slr ? `+${s.slr.toFixed(2)} m` : 'as today'}</b>, ${(state.params.rate * 100).toFixed(1)}% over ${state.params.horizon} years`);
  recompute(); renderView(); paint(); renderDetail();
}
let toastTimer;
function toast(html) {
  const t = $('toast'); t.innerHTML = html; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 2200);
}

function buildControls() {
  $('tabs').innerHTML = VIEWS.map((v) => `<button type="button" class="tab" role="tab" data-view="${v.id}" aria-selected="${v.id === state.view}">${v.tab}</button>`).join('');
  $('tabs').querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => setView(t.dataset.view)));
  seg($('yearSeg'), Object.entries(SCENARIOS).map(([y, s]) => ({ v: y, label: s.label })), state.params.year, (v) => { state.params.year = +v; scenarioChanged(); });
  seg($('horizonSeg'), [20, 30, 50].map((y) => ({ v: y, label: `${y} yr` })), state.params.horizon, (v) => { state.params.horizon = +v; scenarioChanged(); });
  const rate = $('rate'), out = $('rateOut');
  rate.value = state.params.rate * 100; out.textContent = `${rate.value}%`;
  rate.addEventListener('input', () => { out.textContent = `${rate.value}%`; });
  rate.addEventListener('change', () => { state.params.rate = rate.value / 100; scenarioChanged(); });
  seg($('baseSeg'), [{ v: 'satellite', label: 'Satellite' }, { v: 'dark', label: 'Dark' }], state.base, (v) => {
    state.base = v;
    map.setLayoutProperty('imagery', 'visibility', v === 'satellite' ? 'visible' : 'none');
    map.setPaintProperty('hex-fill', 'fill-opacity', fillOpacity());
  });
  $('tiltBtn').addEventListener('click', (e) => {
    const on = e.currentTarget.getAttribute('aria-pressed') !== 'true';
    e.currentTarget.setAttribute('aria-pressed', on);
    map.easeTo({ pitch: on ? 50 : 0, bearing: on ? -18 : 0 });
  });
  $('resetBtn').addEventListener('click', () => fitCounty(true));
  $('aboutBtn').addEventListener('click', () => $('about').showModal());
}

// ---- Map -------------------------------------------------------------------
const fillOpacity = () => ['*', ['get', 'o'], state.base === 'satellite' ? 0.74 : 0.92];
let bounds;
function fitCounty(animate) {
  map.fitBounds(bounds, { padding: 30, animate, pitch: 0, bearing: 0 });
  $('tiltBtn').setAttribute('aria-pressed', 'false');
}

function buildMap() {
  geo = { type: 'FeatureCollection', features: hexes.map((h, i) => ({
    type: 'Feature', properties: { i, c: '#000', o: 0 },
    geometry: { type: 'Polygon', coordinates: [h3.cellToBoundary(h.h3, true)] },
  })) };
  let w = 180, s = 90, e = -180, n = -90;
  geo.features.forEach((f) => f.geometry.coordinates[0].forEach(([x, y]) => { w = Math.min(w, x); e = Math.max(e, x); s = Math.min(s, y); n = Math.max(n, y); }));
  bounds = [[w, s], [e, n]];

  map = new maplibregl.Map({
    container: 'map', bounds, fitBoundsOptions: { padding: 30 }, maxPitch: 60, attributionControl: false,
    style: {
      version: 8,
      sources: {
        imagery: { type: 'raster', tileSize: 256, maxzoom: 18,
          tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
          attribution: 'Imagery © Esri, Maxar, Earthstar Geographics' },
        hex: { type: 'geojson', data: geo },
      },
      layers: [
        { id: 'bg', type: 'background', paint: { 'background-color': '#0b0c0e' } },
        { id: 'imagery', type: 'raster', source: 'imagery', paint: { 'raster-brightness-max': 0.82, 'raster-saturation': -0.15 } },
        { id: 'hex-fill', type: 'fill', source: 'hex', paint: { 'fill-color': ['get', 'c'], 'fill-opacity': fillOpacity() } },
        { id: 'hex-pick', type: 'line', source: 'hex', filter: ['==', ['get', 'i'], -1], paint: { 'line-color': '#fff', 'line-width': 2.5 } },
      ],
    },
  });
  window.atlasMap = map;
  map.addControl(new maplibregl.AttributionControl({ compact: true, customAttribution: data.meta.attribution || '' }), 'bottom-left');
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-left');

  const marks = data.areas.filter((a) => a.label).map((a) =>
    new maplibregl.Marker({ element: el(`<div class="place">${a.name}</div>`) }).setLngLat([a.lon, a.lat]).addTo(map));
  const showMarks = () => marks.forEach((m) => { m.getElement().style.display = map.getZoom() > 9.2 ? '' : 'none'; });
  map.on('zoom', showMarks); showMarks();

  const tip = $('tip');
  map.on('mousemove', 'hex-fill', (ev) => {
    const i = ev.features[0].properties.i, v = values[i], L = LAYERS[state.layer];
    if (v === null || v === undefined) { tip.hidden = true; return; }
    const label = L.categorical ? (INTERVENTIONS.find((x) => x.id === v) || { label: 'Nothing pays back' }).label : L.fmt(v);
    tip.innerHTML = `<span>${data.areas[hexes[i].area].name}</span>${label}`;
    tip.style.left = `${ev.point.x}px`; tip.style.top = `${ev.point.y}px`; tip.hidden = false;
    map.getCanvas().style.cursor = 'pointer';
  });
  map.on('mouseleave', 'hex-fill', () => { tip.hidden = true; map.getCanvas().style.cursor = ''; });
  map.on('click', (ev) => {
    const f = map.queryRenderedFeatures(ev.point, { layers: ['hex-fill'] })[0];
    state.selected = f ? f.properties.i : null;
    renderDetail();
  });
  map.on('load', () => { paint(); });
}

// ---- Start -----------------------------------------------------------------
async function start() {
  const res = await fetch('data/hexes.json');
  if (!res.ok) throw new Error(`data/hexes.json returned ${res.status}`);
  data = await res.json();
  hexes = unpack(data);
  const real = data.meta.source !== 'synthetic';
  $('statusPill').querySelector('span').textContent = real
    ? 'Proof of concept: real buildings, illustrative model' : 'Proof of concept, illustrative data';
  recompute();
  buildControls();
  buildMap();
  renderView();
  paint();
}
start().catch((err) => {
  $('viewTitle').textContent = 'The atlas could not load';
  $('viewText').textContent = `${err.message}. Serve this folder over HTTP (for example: python3 -m http.server) and reload.`;
});
