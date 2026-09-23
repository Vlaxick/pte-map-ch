"""Build external ADM1 regions and Moldova's ADM0 contour from pinned geoBoundaries data.

Run `python3 tools/build_external_regions.py`. Source files are downloaded only
when missing from the optional cache directory passed as the first argument.
The generated per-country files keep their source licences separate.
"""

import json
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "data" / "external-admin1"
CACHE = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / ".boundary-cache"
REVISION = "9469f09"
COUNTRIES = ("RUS", "BLR", "POL", "SVK", "HUN", "ROU")
NEIGHBOR_NAMES = {
    "BLR": {"Brest", "Gomel"},
    "POL": {"Lublin Voivodeship", "Subcarpathian Voivodeship"},
    "SVK": {"Region of Prešov", "Region of Košice"},
    "HUN": {"Szabolcs-Szatmár-Bereg"},
    "ROU": {"SATU MARE", "MARAMURES", "SUCEAVA", "BOTOSANI", "GALATI", "TULCEA"},
}


def context_strength(iso, name, center):
    """Keep the near half of three neighbors and soften their outer edge."""
    lon, lat = center
    if iso == "RUS":
        return 1.0
    if iso in ("BLR", "SVK"):
        return 1.0 if name in NEIGHBOR_NAMES[iso] else 0.0
    if iso == "POL":
        distance = lon - 19.2
    elif iso == "HUN":
        distance = lon - 19.25
    else:  # ROU: the southern edge slopes toward the Danube delta.
        distance = lat - (46.0 - 0.15 * (lon - 22))
    if distance < 0:
        return 0.0
    if name in NEIGHBOR_NAMES[iso]:
        return 1.0
    return round(min(1.0, max(0.28, distance / 1.1)), 2)
UKRAINIAN_LABELS = {
    "Belgorod Oblast": "Бєлгородська", "Bryansk Oblast": "Брянська",
    "Kursk Oblast": "Курська", "Voronezh Oblast": "Воронезька",
    "Rostov Oblast": "Ростовська", "Lipetsk Oblast": "Липецька",
    "Oryol Oblast": "Орловська", "Kaluga Oblast": "Калузька",
    "Smolensk Oblast": "Смоленська", "Tambov Oblast": "Тамбовська",
    "Saratov Oblast": "Саратовська", "Volgograd Oblast": "Волгоградська",
    "Astrakhan Oblast": "Астраханська", "Krasnodar Krai": "Краснодарський край",
    "Tula Oblast": "Тульська", "Moscow Oblast": "Московська",
    "Ryazan Oblast": "Рязанська", "Penza Oblast": "Пензенська",
    "Murmansk Oblast": "Мурманська", "Stavropol Krai": "Ставропольський край",
    "Brest": "Берестейська", "Gomel": "Гомельська",
    "Lublin Voivodeship": "Люблінське", "Subcarpathian Voivodeship": "Підкарпатське",
    "Region of Prešov": "Пряшівський край", "Region of Košice": "Кошицький край",
    "Szabolcs-Szatmár-Bereg": "Саболч-Сатмар-Берег",
}


def simplified_ring(ring, tolerance=0.006):
    """Iterative Douglas-Peucker simplification, preserving closed rings."""
    points = ring[:-1] if ring[0] == ring[-1] else ring
    if len(points) <= 4:
        return ring
    points = points + [points[0]]
    keep = {0, len(points) - 1}
    stack = [(0, len(points) - 1)]
    limit = tolerance * tolerance
    while stack:
        start, end = stack.pop()
        ax, ay = points[start][:2]
        bx, by = points[end][:2]
        dx, dy = bx - ax, by - ay
        length = dx * dx + dy * dy
        best_distance, best_index = 0, None
        for index in range(start + 1, end):
            px, py = points[index][:2]
            t = max(0, min(1, ((px - ax) * dx + (py - ay) * dy) / length)) if length else 0
            distance = (px - ax - t * dx) ** 2 + (py - ay - t * dy) ** 2
            if distance > best_distance:
                best_distance, best_index = distance, index
        if best_distance > limit and best_index is not None:
            keep.add(best_index)
            stack.extend(((start, best_index), (best_index, end)))
    result = [[round(points[i][0], 5), round(points[i][1], 5)] for i in sorted(keep)]
    return result if len(result) >= 4 else ring


def simplify_geometry(geometry):
    if geometry["type"] == "Polygon":
        return {"type": "Polygon", "coordinates": [simplified_ring(ring) for ring in geometry["coordinates"]]}
    return {"type": "MultiPolygon", "coordinates": [
        [simplified_ring(ring) for ring in polygon] for polygon in geometry["coordinates"]
    ]}


def signed_area(ring):
    return sum(a[0] * b[1] - b[0] * a[1] for a, b in zip(ring, ring[1:])) / 2


def inside(point, ring):
    x, y = point
    result = False
    for a, b in zip(ring, ring[1:]):
        if (a[1] > y) != (b[1] > y) and x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]:
            result = not result
    return result


def label_center(geometry):
    polygons = geometry["coordinates"] if geometry["type"] == "MultiPolygon" else [geometry["coordinates"]]
    ring = max(polygons, key=lambda polygon: abs(signed_area(polygon[0])))[0]
    area = signed_area(ring)
    if area:
        cx = sum((a[0] + b[0]) * (a[0] * b[1] - b[0] * a[1]) for a, b in zip(ring, ring[1:])) / (6 * area)
        cy = sum((a[1] + b[1]) * (a[0] * b[1] - b[0] * a[1]) for a, b in zip(ring, ring[1:])) / (6 * area)
        if inside((cx, cy), ring):
            return [round(cx, 5), round(cy, 5)]
    # Concave regions can have an exterior centroid; use an interior grid point.
    xs, ys = [p[0] for p in ring], [p[1] for p in ring]
    for divisions in (2, 4, 8, 16):
        for iy in range(divisions):
            for ix in range(divisions):
                point = (min(xs) + (max(xs) - min(xs)) * (ix + .5) / divisions,
                         min(ys) + (max(ys) - min(ys)) * (iy + .5) / divisions)
                if inside(point, ring):
                    return [round(point[0], 5), round(point[1], 5)]
    return [round(ring[0][0], 5), round(ring[0][1], 5)]


def main():
    CACHE.mkdir(parents=True, exist_ok=True)
    OUTPUT.mkdir(parents=True, exist_ok=True)
    for iso in COUNTRIES:
        path = CACHE / f"{iso}.geojson"
        if not path.exists():
            url = (f"https://github.com/wmgeolab/geoBoundaries/raw/{REVISION}/"
                   f"releaseData/gbOpen/{iso}/ADM1/geoBoundaries-{iso}-ADM1_simplified.geojson")
            urllib.request.urlretrieve(url, path)
        source = json.loads(path.read_text())
        chosen = []
        for feature in source["features"]:
            name = feature["properties"]["shapeName"]
            center = label_center(feature["geometry"])
            strength = context_strength(iso, name, center)
            if not strength:
                continue
            geometry = simplify_geometry(feature["geometry"])
            chosen.append({"type": "Feature", "geometry": geometry, "properties": {
                "id": feature["properties"]["shapeID"], "country": iso,
                "name": name, "label": UKRAINIAN_LABELS.get(name, name.title() if iso == "ROU" else name),
                "center": label_center(geometry), "strength": strength
            }})
        if iso != "RUS":
            missing = NEIGHBOR_NAMES[iso] - {f["properties"]["name"] for f in chosen}
            if missing:
                raise ValueError(f"Missing {iso} border regions: {missing}")
        if iso == "RUS" and len(chosen) != 83:
            raise ValueError("Unexpected Russia ADM1 count; check source for territorial changes")
        output = OUTPUT / f"{iso}.geojson"
        output.write_text(json.dumps({"type": "FeatureCollection", "features": chosen}, ensure_ascii=False, separators=(",", ":")))
        print(f"{iso}: {len(chosen)} regions, {output.stat().st_size:,} bytes")

    # The 37 Moldovan raions create an unreadable cluster at this map scale.
    moldova_cache = CACHE / "MDA-adm0.geojson"
    if not moldova_cache.exists():
        url = (f"https://github.com/wmgeolab/geoBoundaries/raw/{REVISION}/"
               "releaseData/gbOpen/MDA/ADM0/geoBoundaries-MDA-ADM0_simplified.geojson")
        urllib.request.urlretrieve(url, moldova_cache)
    moldova_source = json.loads(moldova_cache.read_text())
    if len(moldova_source["features"]) != 1:
        raise ValueError("Unexpected Moldova ADM0 count")
    feature = moldova_source["features"][0]
    geometry = simplify_geometry(feature["geometry"])
    moldova = {"type": "Feature", "geometry": geometry, "properties": {
        "id": feature["properties"]["shapeID"], "country": "MDA",
        "name": feature["properties"]["shapeName"], "label": "Молдова",
        "center": label_center(geometry), "strength": 1.0
    }}
    adm0_output = ROOT / "data" / "external-admin0"
    adm0_output.mkdir(parents=True, exist_ok=True)
    output = adm0_output / "MDA.geojson"
    output.write_text(json.dumps({"type": "FeatureCollection", "features": [moldova]}, ensure_ascii=False, separators=(",", ":")))
    (OUTPUT / "MDA.geojson").unlink(missing_ok=True)
    print(f"MDA ADM0: 1 country, {output.stat().st_size:,} bytes")


if __name__ == "__main__":
    main()
