"""Build a responsive SVG atlas from the OCHA Ukraine admin-1 GeoJSON."""
import json
import math
import heapq
from pathlib import Path
from xml.sax.saxutils import escape

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "data/ocha-adm1.geojson"
DISTRICTS = ROOT / "data/ocha-adm2.geojson"
SVG = ROOT / "data/ukraine-map.svg"
META = ROOT / "data/map-regions.json"

CODE_OVERRIDES = {"UA01": "UA-43", "UA44": "UA-09", "UA73": "UA-77", "UA80": "UA-30", "UA85": "UA-40"}
SHORT_NAMES = {
    "UA-43": "АР Крим", "UA-30": "Київ", "UA-40": "Севастополь",
    "UA-26": "Івано-Франківська", "UA-12": "Дніпропетровська",
}
CITY_LABELS = {"UA-30": (50.45, 30.52), "UA-40": (44.61, 33.53)}
CENTERED_LABELS = {"UA-12", "UA-59", "UA-68", "UA-71", "UA-77"}
PRIORITY = {"UA-43", "UA-46", "UA-51", "UA-63", "UA-74", "UA-12", "UA-05", "UA-14"}

features = json.loads(SOURCE.read_text())["features"]
districts = json.loads(DISTRICTS.read_text())["features"]

def polygons(geometry):
    return geometry["coordinates"] if geometry["type"] == "MultiPolygon" else [geometry["coordinates"]]

def mercator(point):
    lon, lat = point[:2]
    return math.radians(lon), -math.log(math.tan(math.pi / 4 + math.radians(lat) / 2))

points = [mercator(p) for f in features for poly in polygons(f["geometry"]) for ring in poly for p in ring]
left, right = min(p[0] for p in points), max(p[0] for p in points)
top, bottom = min(p[1] for p in points), max(p[1] for p in points)
width = 1200
height = round(width * (bottom - top) / (right - left))
padding = 12

def project(point):
    x, y = mercator(point)
    return padding + (x - left) / (right - left) * width, padding + (y - top) / (bottom - top) * height

def unproject(x, y):
    longitude = left + (x - padding) / width * (right - left)
    mercator_y = top + (y - padding) / height * (bottom - top)
    latitude = 2 * math.atan(math.exp(-mercator_y)) - math.pi / 2
    return math.degrees(latitude), math.degrees(longitude)

def path(geometry):
    pieces = []
    for poly in polygons(geometry):
        for ring in poly:
            if not ring:
                continue
            coords = [project(p) for p in ring]
            pieces.append("M" + " ".join(f"{x:.2f},{y:.2f}" if i == 0 else f"L{x:.2f},{y:.2f}" for i, (x, y) in enumerate(coords)) + "Z")
    return " ".join(pieces)

def ring_area(ring):
    return abs(sum(ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1] for i in range(len(ring) - 1)))

def distance_to_polygon(x, y, rings):
    inside = False
    best = float("inf")
    for ring in rings:
        for i in range(len(ring) - 1):
            ax, ay = ring[i]
            bx, by = ring[i + 1]
            if (ay > y) != (by > y) and x < (bx - ax) * (y - ay) / (by - ay) + ax:
                inside = not inside
            dx, dy = bx - ax, by - ay
            t = max(0, min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy))) if dx or dy else 0
            best = min(best, (x - ax - t * dx) ** 2 + (y - ay - t * dy) ** 2)
    distance = math.sqrt(best)
    return distance if inside else -distance

def label_point(geometry):
    # Place the name inside the largest mainland polygon, away from its borders.
    poly = max(polygons(geometry), key=lambda p: ring_area([project(v) for v in p[0]]))
    rings = [[project(v) for v in ring] for ring in poly]
    outer = rings[0]
    xmin, xmax = min(p[0] for p in outer), max(p[0] for p in outer)
    ymin, ymax = min(p[1] for p in outer), max(p[1] for p in outer)
    size = min(xmax - xmin, ymax - ymin)
    queue = []
    counter = 0

    def add(x, y, half):
        nonlocal counter
        distance = distance_to_polygon(x, y, rings)
        heapq.heappush(queue, (-(distance + half * math.sqrt(2)), counter, x, y, half, distance))
        counter += 1

    x = xmin
    while x < xmax:
        y = ymin
        while y < ymax:
            add(x + size / 2, y + size / 2, size / 2)
            y += size
        x += size
    best = ((xmin + xmax) / 2, (ymin + ymax) / 2, -float("inf"))
    while queue:
        neg_max, _, x, y, half, distance = heapq.heappop(queue)
        if distance > best[2]:
            best = (x, y, distance)
        if -neg_max - best[2] <= 3:
            continue
        half /= 2
        for dx in (-half, half):
            for dy in (-half, half):
                add(x + dx, y + dy, half)
    return best[:2]

def centroid_point(geometry):
    """Area centroid in the same Mercator projection used by the map."""
    poly = max(polygons(geometry), key=lambda p: ring_area([project(v) for v in p[0]]))
    ring = [project(v) for v in poly[0]]
    area_twice = cx = cy = 0
    for (x1, y1), (x2, y2) in zip(ring, ring[1:]):
        cross = x1 * y2 - x2 * y1
        area_twice += cross
        cx += (x1 + x2) * cross
        cy += (y1 + y2) * cross
    if not area_twice:
        return label_point(geometry)
    point = (cx / (3 * area_twice), cy / (3 * area_twice))
    return point if distance_to_polygon(*point, [ring]) > 0 else label_point(geometry)

parts = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width + padding * 2} {height + padding * 2}" preserveAspectRatio="xMidYMid meet" aria-label="Карта регіонів України">']
parts.append('<g class="regions">')
metadata = []
for feature in features:
    props = feature["properties"]
    pcode = props["adm1_pcode"]
    code = CODE_OVERRIDES.get(pcode, pcode[:2] + "-" + pcode[2:])
    name = props["adm1_name1"]
    short = SHORT_NAMES.get(code, name)
    x, y = (project((CITY_LABELS[code][1], CITY_LABELS[code][0])) if code in CITY_LABELS
            else centroid_point(feature["geometry"]) if code in CENTERED_LABELS
            else label_point(feature["geometry"]))
    lat, lon = unproject(x, y)
    metadata.append({"code": code, "name": name, "label": short, "lat": round(lat, 6), "lon": round(lon, 6), "x": round(x / (width + padding * 2) * 100, 4), "y": round(y / (height + padding * 2) * 100, 4), "priority": code in PRIORITY})
    parts.append(f'<path id="region-{code}" data-code="{code}" class="region" d="{path(feature["geometry"])}"><title>{escape(name)}</title></path>')
parts.append("</g>")
parts.append('<g class="districts" aria-hidden="true">')
for district in districts:
    parts.append(f'<path class="district-boundary" d="{path(district["geometry"])}"/>')
parts.append("</g>")
parts.append('<g class="oblast-outlines" aria-hidden="true">')
for feature in features:
    props = feature["properties"]
    pcode = props["adm1_pcode"]
    code = CODE_OVERRIDES.get(pcode, pcode[:2] + "-" + pcode[2:])
    parts.append(f'<path class="oblast-outline" data-code="{code}" d="{path(feature["geometry"])}"/>')
parts.append("</g>")
parts.append("</svg>")
SVG.write_text("\n".join(parts))
META.write_text(json.dumps(metadata, ensure_ascii=False, indent=2) + "\n")
print(f"Wrote {len(metadata)} regions, {width + padding*2}×{height + padding*2} SVG")
