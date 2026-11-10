# Resilience Investment Atlas

Proof of concept, Climate Resilience Institute x Aretian.

A map of Miami-Dade that answers one question: where does a dollar of climate
adaptation return the most? Each hexagonal cell (about 0.1 km²) gets an expected
yearly loss from four hazards, then five adaptation measures are tested and the
one with the highest net present value is kept. Change the sea level year,
discount rate or appraisal period and all 12,034 cells recalculate in the browser.

**This is a demonstration of the tool, not a finding about Miami.** See
"What is real" below before quoting any number.

## Run it

It is a static site with no build step.

```
python3 -m http.server 8000     # then open http://localhost:8000
```

To publish it, turn on GitHub Pages for this repo (Settings > Pages > Deploy
from a branch > `main`, folder `/`).

## Views

| View | What it shows |
| --- | --- |
| Overview | County totals: yearly loss, capital that pays back, return per dollar |
| Risk diagnostics | Coastal flood, rainfall flood, wind and heat indices, and social sensitivity, as a weighted tree |
| Economic exposure | Property, jobs, residents, loss by type, and the knock-on loss when critical places stop |
| Interventions | Which of five measures pays best in each cell, or one measure's return everywhere |
| Return on investment | Benefit to cost, net present value, payback, and who captures the benefit |
| Priority schedule | Neighbourhoods ranked by net value |

Click any cell for its own loss breakdown and the return of every measure.

## What is real

| Input | Source | Status |
| --- | --- | --- |
| Where the city is (12,034 cells) | 599,735 Overture Maps building footprints, release 2026-10-21.0 | Real |
| Spread of property value, residents, jobs | Overture floor area (96% of buildings carry a height or floor count) and 180,097 Overture places | Real spread, scaled to round county totals ($620B, 2.7M residents, 1.3M jobs) |
| Hard surface cover | Overture footprint share per cell | Real, approximate |
| Home or workplace split | Overture `subtype`; untagged buildings guessed from size | Heuristic |
| Elevation, distance to the bay | Hand-drawn shoreline and coastal ridge | Synthetic |
| Canopy, income, age 65+, year built, price index | Blended from a hand-written table of 40 neighbourhood profiles | Synthetic |
| Network criticality | Seven hand-picked sites plus job density | Synthetic |
| Hazard, damage, cost and benefit coefficients | Placeholders in `js/model.js` | Not calibrated |
| Sea level by year | 0, 0.25, 0.55 and 1.2 m | Illustrative |

## The model

All of it is in `js/model.js`, about 150 lines.

- **Yearly loss** = property damage + lost business days + knock-on regional
  loss + heat costs. The knock-on loss multiplies a cell's business interruption
  by its network criticality.
- **Measures**: shoreline protection, stormwater upgrade, elevate and floodproof,
  wind retrofit, cool roofs and canopy. Each removes a share of specific hazards'
  losses and has a capital cost plus 1.5% yearly upkeep.
- **Return** = present value of avoided losses / present value of costs.
- **Beneficiaries**: avoided loss is split between property owners, employers
  and households. Property tax protected is reported separately and left out of
  the return.

Known simplifications: one measure per cell (no combinations), no benefit
spillover between neighbouring cells, losses held flat at the chosen year's sea
level, and no financing structure.

## Rebuild the data

```
pip install pyarrow shapely h3
python scripts/fetch_overture.py                               # about a minute
python scripts/build_data.py --overture data/raw/overture_hex.csv
node scripts/check_model.mjs                                   # sanity checks
```

`python scripts/build_data.py` with no arguments builds a fully synthetic
dataset instead. `data/raw/overture_hex.csv` is committed, so the second and
third commands work without downloading anything.

## To make it real

1. Elevation: USGS 3DEP lidar or the NOAA sea level rise viewer DEM.
2. Flood depth: FEMA flood maps and NOAA surge model output, replacing the surge formula.
3. Property value and year built: Miami-Dade Property Appraiser parcel roll.
4. Jobs and residents: Census LEHD and ACS.
5. Canopy and heat: Miami-Dade tree canopy assessment, Landsat surface temperature.
6. Knock-on loss: Aretian's business and labour network model, replacing the hand-picked list.
7. Damage and cost curves: FEMA Hazus depth-damage functions and local project costs.

## Credits

Buildings and places © OpenStreetMap contributors and Overture Maps Foundation
(ODbL and CDLA Permissive 2.0). Satellite imagery is loaded from Esri World
Imagery and is subject to Esri's terms. MapLibre GL JS, h3-js and Fira Sans are
vendored under their own licences.
