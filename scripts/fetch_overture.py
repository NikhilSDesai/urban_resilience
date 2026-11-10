#!/usr/bin/env python3
"""Download Overture Maps buildings and places for Miami-Dade and aggregate
them to H3 cells.

  pip install pyarrow shapely h3
  python scripts/fetch_overture.py            # writes data/raw/overture_hex.csv
  python scripts/build_data.py --overture data/raw/overture_hex.csv

Reads the public Overture bucket anonymously. Only row groups that overlap the
bounding box are fetched, so the download is a few hundred MB, not the planet.
Behind an HTTPS proxy, set HTTPS_PROXY (and SSL_CERT_FILE for a custom CA).
"""
import argparse
import csv
import os
import time
from collections import defaultdict
from pathlib import Path

import h3
import pyarrow.compute as pc
import pyarrow.dataset as ds
import pyarrow.fs as fs
import shapely

ROOT = Path(__file__).resolve().parent.parent
BUCKET = "overturemaps-us-west-2"
RES = 9
# west, south, east, north: urban Miami-Dade, stopping at the Broward line.
BBOX = (-80.56, 25.40, -80.10, 25.975)
# Square metres per square degree at this latitude (flat approximation).
M2_PER_DEG2 = 100_270 * 110_900
FLOOR_HEIGHT_M = 3.3
RESIDENTIAL = {"residential"}
NON_RESIDENTIAL = {"commercial", "industrial", "education", "medical", "civic",
                   "transportation", "service", "entertainment", "religious",
                   "military", "agricultural"}


def filesystem():
    kw = dict(anonymous=True, region="us-west-2", endpoint_override="s3.amazonaws.com",
              force_virtual_addressing=True, request_timeout=180, connect_timeout=30)
    proxy = os.environ.get("HTTPS_PROXY") or os.environ.get("https_proxy")
    if proxy:
        kw["proxy_options"] = proxy
    ca = os.environ.get("SSL_CERT_FILE")
    if ca:
        kw["tls_ca_file_path"] = ca
    return fs.S3FileSystem(**kw)


def latest_release(s3):
    infos = s3.get_file_info(fs.FileSelector(f"{BUCKET}/release/"))
    return sorted(i.base_name for i in infos)[-1]


def batches(s3, release, theme, typ, columns):
    w, s, e, n = BBOX
    path = f"{BUCKET}/release/{release}/theme={theme}/type={typ}/"
    data = ds.dataset(path, filesystem=s3, format="parquet")
    box = ((pc.field("bbox", "xmin") < e) & (pc.field("bbox", "xmax") > w) &
           (pc.field("bbox", "ymin") < n) & (pc.field("bbox", "ymax") > s))
    return data.to_batches(columns=columns, filter=box, batch_size=50_000)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--release", help="Overture release, e.g. 2026-10-21.0 (default: latest)")
    ap.add_argument("--out", default=str(ROOT / "data" / "raw" / "overture_hex.csv"))
    args = ap.parse_args()

    s3 = filesystem()
    release = args.release or latest_release(s3)
    print(f"Overture release {release}, bbox {BBOX}")
    cells = defaultdict(lambda: dict(buildings=0, footprint_m2=0.0, floor_m2=0.0,
                                     res_floor_m2=0.0, nonres_floor_m2=0.0, places=0))
    w, s, e, n = BBOX
    t0 = time.time()

    n_b = n_height = 0
    for b in batches(s3, release, "buildings", "building",
                     ["geometry", "height", "num_floors", "subtype"]):
        geoms = shapely.from_wkb(b.column("geometry").to_numpy(zero_copy_only=False))
        cents = shapely.centroid(geoms)
        xs, ys = shapely.get_x(cents), shapely.get_y(cents)
        areas = shapely.area(geoms) * M2_PER_DEG2
        heights = b.column("height").to_pylist()
        floors = b.column("num_floors").to_pylist()
        subtypes = b.column("subtype").to_pylist()
        for x, y, a, ht, fl, st in zip(xs, ys, areas, heights, floors, subtypes):
            if not (w <= x <= e and s <= y <= n) or a < 12:
                continue
            if fl:
                levels = float(fl)
            elif ht:
                levels = max(1.0, ht / FLOOR_HEIGHT_M)
            else:
                levels = 1.0
            n_height += bool(fl or ht)
            floor = a * levels
            # Untagged buildings: small or tall ones are treated as homes,
            # large low ones as workplaces.
            if st in RESIDENTIAL:
                res = 1.0
            elif st in NON_RESIDENTIAL:
                res = 0.0
            else:
                res = 1.0 if (a < 450 or levels >= 6) else 0.15
            c = cells[h3.latlng_to_cell(y, x, RES)]
            c["buildings"] += 1
            c["footprint_m2"] += a
            c["floor_m2"] += floor
            c["res_floor_m2"] += floor * res
            c["nonres_floor_m2"] += floor * (1 - res)
            n_b += 1
        print(f"  buildings {n_b:,} ({time.time() - t0:.0f}s)", end="\r", flush=True)
    print(f"\nbuildings: {n_b:,}, {n_height / max(1, n_b):.0%} with a height or floor count")

    n_p = 0
    for b in batches(s3, release, "places", "place", ["geometry", "confidence"]):
        pts = shapely.from_wkb(b.column("geometry").to_numpy(zero_copy_only=False))
        conf = b.column("confidence").to_pylist()
        for x, y, cf in zip(shapely.get_x(pts), shapely.get_y(pts), conf):
            if w <= x <= e and s <= y <= n and (cf is None or cf >= 0.5):
                cells[h3.latlng_to_cell(y, x, RES)]["places"] += 1
                n_p += 1
    print(f"places: {n_p:,}")

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    fields = ["h3", "buildings", "footprint_m2", "floor_m2", "res_floor_m2",
              "nonres_floor_m2", "places"]
    with open(out, "w", newline="") as f:
        wr = csv.writer(f)
        wr.writerow(fields)
        for cid in sorted(cells):
            c = cells[cid]
            wr.writerow([cid] + [round(c[k]) for k in fields[1:]])
    (out.parent / "overture_release.txt").write_text(release + "\n")
    print(f"{len(cells):,} cells -> {out} in {time.time() - t0:.0f}s")


if __name__ == "__main__":
    main()
