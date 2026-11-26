"""Prepare the committed atlas from Natural Earth 5.1.1 (public domain).

Requires Python 3, Node.js and npm. From the project root:
    python3 scripts/prepare-map.py --flags public/flags --output public/world.json
The site build uses the committed result and does not run this script.
"""
import argparse
import hashlib
import io
import json
from pathlib import Path
import re
import subprocess
import tempfile
from urllib.request import urlopen
from zipfile import ZipFile

DATASET = "ne_10m_admin_0_countries"
SOURCE = f"https://naturalearth.s3.amazonaws.com/5.1.1/10m_cultural/{DATASET}.zip"
SHA256 = "ce1ac7036499a0edd641fbc093cd209a98f96a49d2eca8480aaacad35138a7f6"


def download():
    with urlopen(SOURCE, timeout=60) as response:
        return response.read()


def extract_source(archive, directory):
    if hashlib.sha256(archive).hexdigest() != SHA256:
        raise ValueError("Unexpected hash for Natural Earth 5.1.1 country boundaries")
    with ZipFile(io.BytesIO(archive)) as zipped:
        for ext in ("shp", "shx", "dbf", "prj", "cpg"):
            name = f"{DATASET}.{ext}"
            (directory / name).write_bytes(zipped.read(name))


def simplify(directory, options, output):
    # Explode first so keep-shapes protects each island at both resolutions.
    subprocess.run([
        "npx", "--yes", "--package=mapshaper@0.8.10", "--", "mapshaper",
        f"{DATASET}.shp", "-filter-fields", "ADM0_A3,ISO_A2,LABEL_X,LABEL_Y",
        "-explode", "-simplify", *options, "keep-shapes", "-o",
        "precision=0.0001", "format=geojson", output,
    ], cwd=directory, check=True)
    return json.loads((directory / output).read_text())["features"]


def dec(value):
    # A concise, plain decimal keeps Path2D and bounds stable on every platform.
    return f"{value or 0:.4f}".rstrip("0").rstrip(".")


def point_text(point):
    lon, lat = point
    return f"{dec(lon)},{dec(-lat)}"


def polygon_piece(rings):
    subpaths = []
    for ring in rings:
        if len(ring) < 4 or ring[0] != ring[-1]:
            raise ValueError("Invalid polygon ring")
        if any(abs(a[0] - b[0]) > 180 for a, b in zip(ring, ring[1:])):
            raise ValueError("Found an uncut antimeridian crossing")
        coords = " ".join(map(point_text, ring[:-1]))
        subpaths.append(f"M{coords}Z")
    longitudes, latitudes = zip(*rings[0])
    bounds = [min(longitudes), -max(latitudes), max(longitudes), -min(latitudes)]
    return {"d": "".join(subpaths), "b": bounds}


def shared_borders(features):
    # Endpoints already share the output grid, so reversal is the only
    # normalization needed to match the two sides of a country border.
    rings = [(feature["properties"]["ADM0_A3"], list(map(tuple, ring)))
             for feature in features for ring in feature["geometry"]["coordinates"]]
    first_owner = {}
    shared = set()
    for owner, ring in rings:
        for a, b in zip(ring, ring[1:]):
            edge = (a, b) if a < b else (b, a)
            if a != b and first_owner.setdefault(edge, owner) != owner:
                shared.add(edge)

    # Follow the original polygon order to keep a continuous stroke along
    # adjacent shared segments; erase each segment after its first output.
    commands = []
    for _, ring in rings:
        previous = None
        for a, b in zip(ring, ring[1:]):
            edge = (a, b) if a < b else (b, a)
            if edge not in shared:
                previous = None
                continue
            shared.remove(edge)
            if previous != a:
                commands.append("M" + point_text(a))
            commands.append(" " + point_text(b))
            previous = b
    return "".join(commands)


def make_atlas(features, codes):
    features_by_id = {}
    for feature in features:
        props = feature["properties"]
        admin_id = props["ADM0_A3"]
        iso = {"FRA": "fr", "NOR": "no"}.get(admin_id, props["ISO_A2"].lower())
        country = features_by_id.setdefault(admin_id, {
            "code": iso if iso in codes else None,
            "anchor": [round(props["LABEL_X"], 4), round(-props["LABEL_Y"], 4)],
            "pieces": [],
        })
        geometry = feature["geometry"]
        if not geometry or geometry["type"] != "Polygon":
            raise ValueError(f"Expected a polygon for {admin_id}")
        country["pieces"].append(polygon_piece(geometry["coordinates"]))

    found = [f["code"] for f in features_by_id.values() if f["code"]]
    if set(found) != codes or len(found) != len(codes):
        raise ValueError("Country geometries must match all 195 flag codes exactly once")
    return {"features": list(features_by_id.values()), "borders": shared_borders(features)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--flags", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--archive", type=Path, help="Optional local copy of the official ZIP")
    args = parser.parse_args()
    codes = {p.stem for p in args.flags.glob("*.svg") if re.fullmatch("[a-z]{2}", p.stem)}
    if len(codes) != 195:
        raise ValueError(f"Expected 195 two-letter flag codes, found {len(codes)}")
    archive = args.archive.read_bytes() if args.archive else download()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    detail_path = args.output.with_stem(args.output.stem + "-detail")
    # Detailed layer uses a 50 m tolerance on polygons under 20,000 km².
    detail = ["dp", "variable", "interval=$.area < 2e10 ? 50 : 700"]
    with tempfile.TemporaryDirectory() as tmp:
        directory = Path(tmp)
        extract_source(archive, directory)
        for path, options in [(args.output, ["4%"]), (detail_path, detail)]:
            features = simplify(directory, options, path.stem + ".geojson")
            atlas = make_atlas(features, codes)
            path.write_text(json.dumps(atlas, separators=(",", ":")) + "\n")


if __name__ == "__main__":
    main()
