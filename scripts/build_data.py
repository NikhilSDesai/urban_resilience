#!/usr/bin/env python3
"""Build data/hexes.json for the Resilience Investment Atlas.

Two modes:

  python scripts/build_data.py
      Illustrative mode. Every attribute is synthetic: a hand-drawn outline of
      urban Miami-Dade, a stylised elevation surface, and exposure blended from
      a table of neighbourhood profiles. Plausible in shape, not real.

  python scripts/build_data.py --overture data/raw/overture_hex.csv
      Real buildings. The set of cells and the spread of property value,
      residents, jobs and built cover come from Overture buildings and places,
      aggregated by scripts/fetch_overture.py, then scaled to county totals.
      Elevation, canopy, income and age are still synthetic until real sources
      are wired in (see README).

Output schema (one row per H3 resolution 9 cell):
  [h3, area_idx, elev_m, dist_coast_km, impervious, canopy, value_musd,
   population, jobs, income_kusd, age65_pct, year_built, criticality]
"""
import argparse
import csv
import json
import math
import random
from pathlib import Path

import h3

RES = 9
ROOT = Path(__file__).resolve().parent.parent
SEED = 20261109

# County control totals used to scale the synthetic exposure (round numbers).
TOTAL_VALUE_MUSD = 620_000   # market value of property, $M
TOTAL_POP = 2_700_000
TOTAL_JOBS = 1_300_000
MIN_FOOTPRINT_M2 = 1500      # Overture mode: ignore cells with less building

# --- Geography (lat, lon) -------------------------------------------------
# Biscayne Bay shoreline of the mainland, north to south. Hand-drawn.
BAY_SHORE = [
    (25.975, -80.147), (25.940, -80.152), (25.900, -80.160), (25.870, -80.172),
    (25.850, -80.180), (25.800, -80.186), (25.770, -80.186), (25.750, -80.192),
    (25.735, -80.215), (25.720, -80.238), (25.700, -80.250), (25.680, -80.262),
    (25.655, -80.278), (25.630, -80.300), (25.600, -80.306), (25.580, -80.312),
    (25.550, -80.326), (25.520, -80.336), (25.470, -80.340), (25.440, -80.334),
]
# Western edge of the urban area (roughly the Urban Development Boundary).
WEST_EDGE = [
    (25.420, -80.500), (25.470, -80.510), (25.520, -80.490), (25.560, -80.455),
    (25.620, -80.460), (25.700, -80.480), (25.760, -80.445), (25.800, -80.420),
    (25.850, -80.395), (25.900, -80.385), (25.940, -80.360), (25.975, -80.340),
]
MAINLAND = BAY_SHORE + [(25.420, -80.420)] + WEST_EDGE
ISLANDS = {
    "beach": [(25.765, -80.143), (25.765, -80.128), (25.800, -80.122),
              (25.850, -80.117), (25.900, -80.119), (25.975, -80.117),
              (25.975, -80.126), (25.930, -80.131), (25.880, -80.131),
              (25.850, -80.134), (25.800, -80.147), (25.780, -80.148)],
    "key": [(25.668, -80.172), (25.668, -80.153), (25.712, -80.150),
            (25.712, -80.170)],
}
# Atlantic Coastal Ridge: the high ground, a few metres above the rest.
RIDGE = [(25.960, -80.185), (25.900, -80.190), (25.850, -80.196),
         (25.790, -80.205), (25.750, -80.222), (25.725, -80.250),
         (25.690, -80.275), (25.640, -80.310), (25.580, -80.345),
         (25.520, -80.400), (25.470, -80.460)]

# name, lat, lon, price idx, jobs idx, pop idx, income $k, age65 %, impervious,
# canopy, typical year built
AREAS = [
    ("Downtown Miami", 25.775, -80.193, 9, 14, 5, 85, 10, .92, .05, 2008),
    ("Brickell", 25.760, -80.193, 11, 10, 7, 120, 9, .90, .07, 2010),
    ("Edgewater and Wynwood", 25.801, -80.195, 6, 4, 5, 80, 10, .85, .08, 2012),
    ("Health District", 25.790, -80.212, 3, 9, 2, 45, 12, .88, .08, 1985),
    ("Little Havana", 25.768, -80.230, 1.6, 1.5, 6, 36, 20, .82, .09, 1958),
    ("Allapattah", 25.810, -80.225, 1.2, 2, 4, 34, 16, .85, .07, 1962),
    ("Liberty City", 25.835, -80.225, .7, .8, 4, 30, 15, .75, .12, 1958),
    ("Little Haiti", 25.830, -80.195, 1.1, 1, 4, 36, 14, .76, .13, 1955),
    ("Upper East Side", 25.850, -80.183, 3, 1, 3, 95, 15, .60, .25, 1950),
    ("Coconut Grove", 25.728, -80.242, 5, 1.5, 2.5, 130, 17, .50, .40, 1975),
    ("Coral Gables", 25.730, -80.270, 5.5, 3.5, 2.2, 125, 18, .50, .38, 1962),
    ("South Miami", 25.707, -80.293, 3, 2, 2.2, 90, 17, .55, .32, 1965),
    ("Pinecrest", 25.667, -80.308, 3.5, .5, 1.3, 170, 16, .35, .45, 1975),
    ("Palmetto Bay", 25.622, -80.325, 2.2, .5, 1.5, 125, 17, .40, .40, 1978),
    ("Cutler Bay", 25.580, -80.345, 1.2, .6, 2.4, 75, 14, .55, .22, 1992),
    ("Kendall", 25.680, -80.350, 1.6, 1.5, 3, 78, 17, .62, .22, 1980),
    ("West Kendall", 25.690, -80.430, 1.2, .6, 3.5, 75, 14, .65, .15, 1995),
    ("Westchester", 25.750, -80.335, 1.4, 1, 3.2, 62, 24, .66, .18, 1962),
    ("Sweetwater", 25.760, -80.375, 1.1, 1.8, 4, 48, 17, .75, .10, 1978),
    ("Tamiami", 25.750, -80.425, 1.1, .5, 3.4, 65, 17, .68, .13, 1988),
    ("Doral", 25.820, -80.355, 2.6, 5, 2.6, 85, 9, .80, .10, 2003),
    ("Airport", 25.795, -80.287, 1.5, 7, .2, 50, 10, .93, .03, 1980),
    ("Hialeah", 25.860, -80.290, 1.1, 2.2, 5.5, 40, 22, .86, .06, 1968),
    ("Hialeah Gardens", 25.880, -80.345, 1, 1.6, 3.5, 50, 16, .80, .08, 1990),
    ("Miami Lakes", 25.912, -80.315, 1.7, 1.8, 2.5, 90, 15, .60, .22, 1985),
    ("Opa-locka", 25.902, -80.250, .6, 1.5, 2.6, 28, 12, .80, .08, 1960),
    ("Miami Gardens", 25.942, -80.245, .9, .9, 3, 50, 14, .65, .15, 1970),
    ("North Miami", 25.890, -80.190, 1.3, 1, 4, 45, 13, .70, .16, 1960),
    ("North Miami Beach", 25.933, -80.168, 1.5, 1.2, 4, 50, 15, .72, .14, 1964),
    ("Aventura", 25.957, -80.150, 6, 4, 5, 75, 28, .78, .12, 1995),
    ("Sunny Isles Beach", 25.945, -80.123, 12, 1.5, 7, 70, 27, .85, .05, 2005),
    ("Surfside and Bal Harbour", 25.880, -80.125, 10, 1.2, 4, 110, 30, .75, .10, 1985),
    ("Mid-Beach", 25.820, -80.127, 9, 2, 4.5, 95, 20, .72, .15, 1975),
    ("South Beach", 25.782, -80.136, 10, 5, 7, 70, 15, .85, .10, 1960),
    ("Key Biscayne", 25.692, -80.163, 9, .6, 3, 170, 19, .50, .35, 1985),
    ("Homestead", 25.470, -80.470, .7, .8, 2.6, 48, 9, .60, .15, 1998),
    ("Florida City", 25.448, -80.480, .4, .5, 2, 35, 8, .55, .15, 1995),
    ("Naranja", 25.530, -80.410, .6, .3, 2.2, 50, 9, .50, .20, 2002),
    ("Richmond West", 25.610, -80.420, .9, .3, 3, 80, 10, .60, .15, 1998),
    ("South Miami Heights", 25.590, -80.385, .8, .4, 3.2, 52, 13, .62, .16, 1975),
]

MAP_LABELS = {"Downtown Miami", "South Beach", "Coral Gables", "Hialeah", "Doral",
              "Kendall", "Homestead", "Aventura", "Miami Gardens", "Cutler Bay",
              "Key Biscayne", "Airport", "West Kendall", "North Miami"}

# Places the regional economy depends on: name, lat, lon, radius km, weight.
CRITICAL_NODES = [
    ("Miami International Airport", 25.795, -80.287, 3.0, 1.0),
    ("PortMiami and downtown core", 25.775, -80.185, 2.5, 0.9),
    ("Health District", 25.790, -80.212, 1.5, 0.9),
    ("Doral logistics", 25.820, -80.350, 3.0, 0.6),
    ("FIU", 25.757, -80.374, 1.5, 0.5),
    ("University of Miami", 25.720, -80.278, 1.2, 0.5),
    ("Homestead Air Reserve Base", 25.490, -80.390, 2.0, 0.4),
]


def xy(lat, lon):
    """Local flat projection in km."""
    return ((lon + 80.3) * 100.27, (lat - 25.7) * 110.9)


def seg_dist(p, a, b):
    (px, py), (ax, ay), (bx, by) = p, a, b
    dx, dy = bx - ax, by - ay
    t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
    return math.hypot(px - ax - t * dx, py - ay - t * dy)


def line_dist(p, line):
    return min(seg_dist(p, line[i], line[i + 1]) for i in range(len(line) - 1))


def make_noise(rng, n=6, scale=6.0):
    """Smooth pseudo-noise in roughly [-1, 1]: a few sine waves, random phase."""
    waves = [(rng.uniform(0.5, 2.0) / scale, rng.uniform(0, math.tau),
              rng.uniform(0, math.tau)) for _ in range(n)]

    def f(x, y):
        s = sum(math.sin(k * (x * math.cos(d) + y * math.sin(d)) + ph)
                for k, d, ph in waves)
        return s / n * 1.8
    return f


def clamp(v, lo=0.0, hi=1.0):
    return max(lo, min(hi, v))


def synthetic_cells():
    cells = {}
    for name, ring in [("mainland", MAINLAND)] + list(ISLANDS.items()):
        poly = h3.LatLngPoly(ring)
        for c in h3.polygon_to_cells(poly, RES):
            cells[c] = name
    return cells


def read_overture(path):
    """CSV from fetch_overture.py. Cells with almost no building are dropped
    so farmland and wetland stay off the map."""
    rows = {}
    with open(path, newline="") as f:
        for r in csv.DictReader(f):
            o = {k: float(v) for k, v in r.items() if k != "h3"}
            if o["footprint_m2"] >= MIN_FOOTPRINT_M2:
                rows[r["h3"]] = o
    return rows


def shore_lon(lat):
    """Longitude of the mainland bay shore at a latitude."""
    pts = sorted(BAY_SHORE)
    if lat <= pts[0][0]:
        return pts[0][1]
    for (la0, lo0), (la1, lo1) in zip(pts, pts[1:]):
        if la0 <= lat <= la1:
            return lo0 + (lo1 - lo0) * (lat - la0) / (la1 - la0)
    return pts[-1][1]


def build(overture_path=None):
    rng = random.Random(SEED)
    shore = [xy(*p) for p in BAY_SHORE]
    ridge = [xy(*p) for p in RIDGE]
    areas_xy = [xy(a[1], a[2]) for a in AREAS]
    nodes_xy = [(xy(n[1], n[2]), n[3], n[4]) for n in CRITICAL_NODES]
    n_el, n_val, n_job, n_pop, n_soc, n_can = (make_noise(rng, scale=s) for s in
                                               (5, 3, 2.5, 3, 7, 3))
    ov = read_overture(overture_path) if overture_path else None
    cells = synthetic_cells()
    if ov:
        # Real footprints define where the city is. Anything east of the
        # mainland shore is a barrier island or bay island.
        cells = {}
        for c in ov:
            lat, lon = h3.cell_to_latlng(c)
            cells[c] = "island" if lon > shore_lon(lat) + 0.003 else "mainland"

    hex_area_m2 = h3.average_hexagon_area(RES, unit="m^2")
    rows = []
    for c, zone in cells.items():
        lat, lon = h3.cell_to_latlng(c)
        p = xy(lat, lon)

        # Blend neighbourhood profiles by inverse distance.
        w = [1.0 / (math.hypot(p[0] - ax, p[1] - ay) ** 2 + 1.0) ** 1.6
             for ax, ay in areas_xy]
        sw = sum(w)
        blend = lambda i: sum(wi * a[i] for wi, a in zip(w, AREAS)) / sw
        area_idx = max(range(len(w)), key=w.__getitem__)

        island = zone != "mainland"
        dc = 0.15 + 0.1 * rng.random() if island else max(0.05, line_dist(p, shore))
        dr = line_dist(p, ridge)
        if island:
            el = 1.15 + 0.25 * n_el(*p)
        else:
            el = 1.45 + 3.1 * math.exp(-(dr / 1.7) ** 2) + 0.35 * n_el(*p)
            el -= 0.5 * math.exp(-dc / 0.5)           # shoreline fringe
        el = max(0.4, el)

        soc = n_soc(*p)
        imp = clamp(blend(8) + 0.08 * n_val(*p), 0.1, 0.98)
        can = clamp(blend(9) + 0.07 * n_can(*p), 0.01, 0.7)
        inc = max(18.0, blend(6) * (1 + 0.15 * soc))
        a65 = clamp(blend(7) * (1 - 0.15 * soc), 4, 45)
        yb = round(blend(10) + 6 * n_pop(*p))

        price = blend(3) * math.exp(0.35 * n_val(*p))
        waterfront = 1 + 0.9 * math.exp(-dc / 0.6)
        if ov:
            o = ov[c]
            # Floor space sets the spread; the neighbourhood price index and
            # a waterfront premium lift it. Scaled to county totals below.
            val = o["floor_m2"] * (0.45 + 0.22 * price) * waterfront
            pop = o["res_floor_m2"]
            jobs = o["nonres_floor_m2"] + 150 * o["places"]
            # Roofs plus the paving that comes with them.
            imp = clamp(0.12 + o["footprint_m2"] / hex_area_m2 * 2.6, 0.12, 0.98)
        else:
            val = price ** 1.3 * waterfront
            pop = blend(5) * math.exp(0.30 * n_pop(*p))
            jobs = blend(4) ** 1.9 * math.exp(0.45 * n_job(*p))

        crit = sum(wt * math.exp(-(math.hypot(p[0] - nx, p[1] - ny) / r) ** 2)
                   for (nx, ny), r, wt in nodes_xy)
        rows.append(dict(h3=c, area=area_idx, el=el, dc=dc, imp=imp, can=can,
                         val=val, pop=pop, jobs=jobs, inc=inc, a65=a65, yb=yb,
                         crit=crit))

    for key, total in (("val", TOTAL_VALUE_MUSD), ("pop", TOTAL_POP),
                       ("jobs", TOTAL_JOBS)):
        k = total / sum(r[key] for r in rows)
        for r in rows:
            r[key] *= k
    # Criticality: named nodes plus a share for sheer job density.
    jmax = sorted(r["jobs"] for r in rows)[int(len(rows) * 0.995)]
    for r in rows:
        r["crit"] = clamp(0.75 * r["crit"] + 0.35 * min(1, r["jobs"] / jmax))

    rows.sort(key=lambda r: r["h3"])
    out = {
        "meta": {
            "source": "overture+synthetic" if ov else "synthetic",
            "attribution": ("Buildings and places \u00a9 OpenStreetMap contributors, "
                            "Overture Maps Foundation") if ov else "",
            "h3_resolution": RES,
            "hex_area_km2": round(hex_area_m2 / 1e6, 4),
            "fields": ["h3", "area", "el", "dc", "imp", "can", "val", "pop",
                       "jobs", "inc", "a65", "yb", "crit"],
        },
        "areas": [{"name": a[0], "lat": a[1], "lon": a[2],
                   "label": a[0] in MAP_LABELS} for a in AREAS],
        "nodes": [{"name": n[0], "lat": n[1], "lon": n[2]} for n in CRITICAL_NODES],
        "hexes": [[r["h3"], r["area"], round(r["el"], 2), round(r["dc"], 2),
                   round(r["imp"], 2), round(r["can"], 2), round(r["val"], 2),
                   round(r["pop"]), round(r["jobs"]), round(r["inc"], 1),
                   round(r["a65"], 1), r["yb"], round(r["crit"], 2)]
                  for r in rows],
    }
    path = ROOT / "data" / "hexes.json"
    path.write_text(json.dumps(out, separators=(",", ":")))
    tot = lambda k: sum(r[k] for r in rows)
    print(f"{len(rows)} cells -> {path} ({path.stat().st_size / 1e6:.2f} MB)")
    print(f"value ${tot('val') / 1e3:,.0f}B  pop {tot('pop'):,.0f}  "
          f"jobs {tot('jobs'):,.0f}  source={out['meta']['source']}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--overture", help="CSV written by fetch_overture.py")
    build(ap.parse_args().overture)
