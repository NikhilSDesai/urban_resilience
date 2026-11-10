// Resilience Investment Atlas: risk and return model.
// Pure functions, no DOM. Runs in the browser and in Node (see scripts/check_model.mjs).
// Every coefficient here is an illustrative placeholder chosen to give plausible
// orders of magnitude. None is calibrated. Replace before relying on any number.

export const SCENARIOS = {
  2025: { slr: 0.0, label: 'Today' },
  2040: { slr: 0.25, label: '2040' },
  2060: { slr: 0.55, label: '2060' },
  2100: { slr: 1.2, label: '2100' },
};

export const DEFAULTS = { year: 2040, rate: 0.04, horizon: 30 };

const GVA_PER_JOB_DAY = 430;   // $ of output per job per working day
const OM_SHARE = 0.015;        // yearly upkeep as a share of capital cost
const MILLAGE = 0.018;         // property tax as a share of market value
const HAZARD_WEIGHTS = { coast: 0.35, rain: 0.25, wind: 0.2, heat: 0.2 };

export const HAZARDS = {
  coast: 'Coastal flooding',
  rain: 'Rainfall flooding',
  wind: 'Hurricane wind',
  heat: 'Extreme heat',
};

// reduce: share of each hazard's loss the measure removes.
// capex: capital cost in $M for one hex cell.
export const INTERVENTIONS = [
  {
    id: 'shoreline', label: 'Shoreline protection', color: '#4aa8d8',
    note: 'Raised seawalls with living shoreline. Cells within 1.2 km of the bay.',
    eligible: (h) => h.dc < 1.2,
    reduce: { coast: 0.6 },
    capex: (h) => 6.5 + 0.012 * h.val,
  },
  {
    id: 'drainage', label: 'Stormwater upgrade', color: '#7c8cf0',
    note: 'Larger drains, pumps and retention.',
    eligible: () => true,
    reduce: { rain: 0.55, coast: 0.1 },
    capex: (h) => 1.9 * (0.5 + h.imp),
  },
  {
    id: 'elevate', label: 'Elevate and floodproof', color: '#c58be0',
    note: 'Raise or floodproof buildings and critical equipment.',
    eligible: () => true,
    reduce: { coast: 0.45, rain: 0.35 },
    capex: (h) => 0.035 * h.val,
  },
  {
    id: 'wind', label: 'Wind retrofit', color: '#e9c46a',
    note: 'Roof ties, impact windows and doors on older stock.',
    eligible: () => true,
    reduce: { wind: 0.45 },
    capex: (h, c) => 0.028 * h.val * c.windVuln,
  },
  {
    id: 'cooling', label: 'Cool roofs and canopy', color: '#5fbf8f',
    note: 'Reflective roofs and street trees.',
    eligible: () => true,
    reduce: { heat: 0.4, rain: 0.08 },
    capex: (h) => 0.05 + 0.42 * h.imp,
  },
];

const clamp = (v, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));

export function annuity(rate, years) {
  return rate === 0 ? years : (1 - Math.pow(1 + rate, -years)) / rate;
}

// Hazard, loss and return for one cell. Money is $M; losses are per year.
export function computeHex(h, p) {
  const slr = SCENARIOS[p.year].slr;
  const a = annuity(p.rate, p.horizon);

  // Coastal: a 1-in-100 surge that decays inland, plus tidal flooding as seas rise.
  const surge = (2.4 + slr) * Math.exp(-h.dc / 3.5);
  const depth = Math.max(0, surge - h.el + 0.6);
  const hCoast = clamp(depth / 2.5);
  const tidal = clamp((0.75 + slr - h.el) / 0.6) * 0.004 * Math.exp(-h.dc / 2.5);
  const rCoast = Math.min(0.04, 0.0055 * Math.pow(depth, 1.3)) + tidal;

  // Rainfall: low ground and hard surfaces. Rising seas lift groundwater.
  const elEff = h.el - 0.5 * slr;
  const hRain = clamp(0.62 * clamp((2.7 - elEff) / 2.0) + 0.45 * h.imp - 0.25 * h.can);
  const rRain = 0.0038 * hRain * hRain;

  // Wind: stronger near the coast, and older buildings predate modern codes.
  const windExp = 0.55 + 0.45 * Math.exp(-h.dc / 12);
  const windVuln = (h.yb < 1994 ? 1.3 : h.yb < 2002 ? 1.0 : 0.65) / 1.3;
  const hWind = clamp(windExp * windVuln);
  const rWind = 0.0032 * hWind;

  // Heat: hard surfaces, little canopy, distance from the sea breeze.
  const hHeat = clamp(0.22 + 0.55 * h.imp - 0.4 * h.can + 0.2 * (1 - Math.exp(-h.dc / 8)));
  const heatHome = h.pop * 520 * hHeat * hHeat * (1 + 1.5 * h.a65 / 100) * Math.sqrt(60 / h.inc) / 1e6;
  const heatWork = h.jobs * 380 * hHeat * hHeat / 1e6;

  // Direct property loss.
  const prop = { coast: h.val * rCoast, rain: h.val * rRain, wind: h.val * rWind, heat: 0 };

  // Business interruption: days closed, then a multiplier for what the wider
  // economy loses when this cell stops (network criticality).
  const days = { coast: 10 * hCoast, rain: 3.5 * hRain * hRain, wind: 2.2 * hWind, heat: 0 };
  const cascade = 1 + 1.2 * h.crit;
  const biDirect = {}, bi = {};
  let biDirectSum = 0, biSum = 0, propSum = 0;
  for (const k of ['coast', 'rain', 'wind', 'heat']) {
    biDirect[k] = h.jobs * GVA_PER_JOB_DAY * days[k] / 1e6;
    bi[k] = biDirect[k] * cascade;
    biDirectSum += biDirect[k];
    biSum += bi[k];
    propSum += prop[k];
  }
  const heat = heatHome + heatWork;
  const eal = propSum + biSum + heat;

  const c = {
    slr, depth, hCoast, hRain, hWind, hHeat, windVuln, cascade,
    hazard: HAZARD_WEIGHTS.coast * hCoast + HAZARD_WEIGHTS.rain * hRain +
      HAZARD_WEIGHTS.wind * hWind + HAZARD_WEIGHTS.heat * hHeat,
    sensitivity: 0.4 * clamp((h.a65 - 8) / 22) + 0.35 * clamp((90 - h.inc) / 60) +
      0.25 * clamp((2002 - h.yb) / 45),
    propLoss: propSum, biLoss: biDirectSum, cascadeLoss: biSum - biDirectSum,
    heatLoss: heat, eal, ealPct: h.val > 0 ? eal / h.val * 100 : 0,
  };

  // Score each measure and keep the one with the highest net present value.
  c.options = {};
  let best = null;
  for (const m of INTERVENTIONS) {
    if (!m.eligible(h)) continue;
    let owners = 0, business = 0, households = 0;
    for (const k in m.reduce) {
      const r = m.reduce[k];
      owners += r * prop[k];
      business += r * bi[k];
      if (k === 'heat') { households += r * heatHome; business += r * heatWork; }
    }
    const avoided = owners + business + households;
    const capex = m.capex(h, c);
    const pvBenefit = avoided * a;
    const pvCost = capex * (1 + OM_SHARE * a);
    const net = avoided - OM_SHARE * capex;
    const discount = h.val > 0 ? Math.min(0.25, owners * a / h.val) : 0;
    const o = {
      id: m.id, capex, avoided, pvBenefit, pvCost,
      npv: pvBenefit - pvCost, bcr: pvBenefit / pvCost,
      payback: net > 0 ? capex / net : Infinity,
      owners, business, households,
      taxPV: MILLAGE * h.val * discount * a,
    };
    c.options[m.id] = o;
    if (!best || o.npv > best.npv) best = o;
  }
  c.best = best;
  return c;
}

// Portfolio view: fund the chosen measure (or each cell's best) wherever it pays back.
export function summarise(hexes, results, areas, measure = 'best') {
  const tot = {
    cells: hexes.length, value: 0, pop: 0, jobs: 0, eal: 0,
    propLoss: 0, biLoss: 0, cascadeLoss: 0, heatLoss: 0,
    funded: 0, capex: 0, avoided: 0, pvBenefit: 0, pvCost: 0, taxPV: 0,
    owners: 0, business: 0, households: 0,
  };
  const byArea = areas.map((a, i) => ({
    idx: i, name: a.name, lat: a.lat, lon: a.lon, cells: 0, value: 0, eal: 0,
    funded: 0, capex: 0, avoided: 0, pvBenefit: 0, pvCost: 0, taxPV: 0, mix: {},
  }));
  const byMeasure = {};
  hexes.forEach((h, i) => {
    const c = results[i], A = byArea[h.area];
    tot.value += h.val; tot.pop += h.pop; tot.jobs += h.jobs; tot.eal += c.eal;
    tot.propLoss += c.propLoss; tot.biLoss += c.biLoss;
    tot.cascadeLoss += c.cascadeLoss; tot.heatLoss += c.heatLoss;
    A.cells++; A.value += h.val; A.eal += c.eal;
    const o = measure === 'best' ? c.best : c.options[measure];
    if (!o || o.npv <= 0) return;
    for (const t of [tot, A]) {
      t.funded++; t.capex += o.capex; t.avoided += o.avoided;
      t.pvBenefit += o.pvBenefit; t.pvCost += o.pvCost; t.taxPV += o.taxPV;
    }
    tot.owners += o.owners; tot.business += o.business; tot.households += o.households;
    A.mix[o.id] = (A.mix[o.id] || 0) + o.capex;
    const M = byMeasure[o.id] || (byMeasure[o.id] = { cells: 0, capex: 0, npv: 0 });
    M.cells++; M.capex += o.capex; M.npv += o.npv;
  });
  for (const t of [tot, ...byArea]) {
    t.npv = t.pvBenefit - t.pvCost;
    t.bcr = t.pvCost > 0 ? t.pvBenefit / t.pvCost : 0;
  }
  byArea.forEach((A) => {
    A.lead = Object.keys(A.mix).sort((x, y) => A.mix[y] - A.mix[x])[0] || null;
  });
  return { tot, byArea, byMeasure };
}

export function unpack(data) {
  const f = data.meta.fields;
  return data.hexes.map((row) => {
    const h = {};
    f.forEach((k, i) => { h[k] = row[i]; });
    return h;
  });
}
