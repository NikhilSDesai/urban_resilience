// Sanity check for the model: node scripts/check_model.mjs
// Prints county totals per scenario and fails if basic invariants break.
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { computeHex, summarise, unpack, annuity, SCENARIOS, DEFAULTS, INTERVENTIONS } from '../js/model.js';

const data = JSON.parse(readFileSync(new URL('../data/hexes.json', import.meta.url)));
const hexes = unpack(data);
const B = (m) => `$${(m / 1e3).toFixed(1)}B`;

assert.ok(Math.abs(annuity(0.04, 30) - 17.292) < 0.001, 'annuity factor');

let prevEal = 0;
for (const year of Object.keys(SCENARIOS).map(Number)) {
  const p = { ...DEFAULTS, year };
  const res = hexes.map((h) => computeHex(h, p));
  const { tot, byArea, byMeasure } = summarise(hexes, res, data.areas);
  for (const c of res) {
    assert.ok(Number.isFinite(c.eal) && c.eal >= 0, 'loss is finite');
    for (const k of ['hCoast', 'hRain', 'hWind', 'hHeat']) assert.ok(c[k] >= 0 && c[k] <= 1, k);
    const o = c.best;
    assert.ok(Math.abs(o.owners + o.business + o.households - o.avoided) < 1e-9, 'beneficiaries add up');
    assert.ok(o.avoided <= c.eal + 1e-9, 'cannot avoid more than the loss');
  }
  const parts = tot.propLoss + tot.biLoss + tot.cascadeLoss + tot.heatLoss;
  assert.ok(Math.abs(parts - tot.eal) < 1e-6, 'loss components add up');
  assert.ok(tot.eal > prevEal, 'loss rises with sea level');
  prevEal = tot.eal;
  const top = [...byArea].sort((a, b) => b.npv - a.npv).slice(0, 5).map((a) => `${a.name} ${a.bcr.toFixed(1)}x`);
  console.log(`${year}: loss ${B(tot.eal)}/yr (${(tot.eal / tot.value * 100).toFixed(2)}% of value)` +
    ` | prop ${B(tot.propLoss)} bi ${B(tot.biLoss)} cascade ${B(tot.cascadeLoss)} heat ${B(tot.heatLoss)}`);
  console.log(`      invest ${B(tot.capex)} in ${tot.funded}/${tot.cells} cells, avoid ${B(tot.avoided)}/yr,` +
    ` NPV ${B(tot.npv)}, BCR ${tot.bcr.toFixed(2)}, tax PV ${B(tot.taxPV)}`);
  console.log('      mix ' + INTERVENTIONS.map((m) => `${m.id} ${byMeasure[m.id]?.cells || 0}`).join(', '));
  console.log('      top ' + top.join('; '));
}
console.log('ok');
