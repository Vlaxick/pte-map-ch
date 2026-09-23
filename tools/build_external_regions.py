"""Build nearby ADM1 regions and country outlines from pinned geoBoundaries data.

Run `python3 tools/build_external_regions.py` or pass `--only POL ROU` to
regenerate selected countries. Source files are downloaded only when missing
from the optional cache directory passed as the first argument.
The generated per-country files keep their source licences separate.
"""

import argparse
import json
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "data" / "external-admin1"
CACHE = ROOT / ".boundary-cache"
REVISION = "9469f09"
COUNTRIES = ("RUS", "BLR", "POL", "SVK", "HUN", "ROU")
NEIGHBOR_NAMES = {
    "BLR": {"Brest", "Gomel"},
    "POL": {"Lublin Voivodeship", "Subcarpathian Voivodeship"},
    "SVK": {"Region of Prešov", "Region of Košice"},
    "HUN": {"Szabolcs-Szatmár-Bereg"},
    "ROU": {"SATU MARE", "MARAMURES", "SUCEAVA", "BOTOSANI", "GALATI", "TULCEA"},
}
COUNTRY_OUTLINES = (*COUNTRIES, "MDA")
RUSSIAN_OVERVIEW_LABELS = {
    "Bryansk Oblast", "Kursk Oblast", "Belgorod Oblast", "Voronezh Oblast",
    "Rostov Oblast", "Lipetsk Oblast", "Volgograd Oblast", "Krasnodar Krai",
}


def context_strength(iso, name):
    """Keep complete nearby countries; limit Belarus to its border regions."""
    return 1.0 if iso != "BLR" or name in NEIGHBOR_NAMES[iso] else 0.0
UKRAINIAN_LABELS = {
    "Adygea": "Адигея", "Altai Krai": "Алтайський край",
    "Altai Republic": "Республіка Алтай", "Amur Oblast": "Амурська",
    "Arkhangelsk Oblast": "Архангельська", "Bashkortostan": "Башкортостан",
    "Belgorod Oblast": "Бєлгородська", "Bryansk Oblast": "Брянська",
    "Buryatia": "Бурятія", "Chechnya": "Чечня",
    "Chelyabinsk Oblast": "Челябінська", "Chukotka Autonomous Okrug": "Чукотський АО",
    "Chuvashia": "Чувашія", "Dagestan": "Дагестан",
    "Ingushetia": "Інгушетія", "Irkutsk Oblast": "Іркутська",
    "Ivanovo Oblast": "Івановська", "Jewish Autonomous Oblast": "Єврейська АО",
    "Kabardino-Balkaria": "Кабардино-Балкарія", "Kaliningrad": "Калінінградська",
    "Kalmykia": "Калмикія", "Kamchatka Krai": "Камчатський край",
    "Karachay-Cherkessia": "Карачаєво-Черкесія", "Kemerovo Oblast": "Кемеровська",
    "Khabarovsk Krai": "Хабаровський край", "Khakassia": "Хакасія",
    "Khanty-Mansiysk Autonomous Okrug – Ugra": "Ханти-Мансійський АО",
    "Kirov Oblast": "Кіровська", "Komi Republic": "Республіка Комі",
    "Kostroma Oblast": "Костромська", "Krasnoyarsk Krai": "Красноярський край",
    "Kurgan Oblast": "Курганська", "Leningrad oblast": "Ленінградська",
    "Magadan Oblast": "Магаданська", "Mari El": "Марій Ел",
    "Moscow": "Москва", "Murmansk Oblast": "Мурманська",
    "Nenets Autonomous Okrug": "Ненецький АО",
    "Nizhny Novgorod Oblast": "Нижньогородська",
    "North Ossetia–Alania": "Північна Осетія-Аланія",
    "Novgorod Oblast": "Новгородська", "Novosibirsk Oblast": "Новосибірська",
    "Omsk Oblast": "Омська", "Orenburg Oblast": "Оренбурзька",
    "Perm Krai": "Пермський край", "Primorsky Krai": "Приморський край",
    "Pskov Oblast": "Псковська", "Republic of Karelia": "Республіка Карелія",
    "Republic of Mordovia": "Республіка Мордовія",
    "Kursk Oblast": "Курська", "Voronezh Oblast": "Воронезька",
    "Rostov Oblast": "Ростовська", "Lipetsk Oblast": "Липецька",
    "Oryol Oblast": "Орловська", "Kaluga Oblast": "Калузька",
    "Smolensk Oblast": "Смоленська", "Tambov Oblast": "Тамбовська",
    "Saratov Oblast": "Саратовська", "Volgograd Oblast": "Волгоградська",
    "Astrakhan Oblast": "Астраханська", "Krasnodar Krai": "Краснодарський край",
    "Tula Oblast": "Тульська", "Moscow Oblast": "Московська",
    "Ryazan Oblast": "Рязанська", "Penza Oblast": "Пензенська",
    "Saint Petersburg": "Санкт-Петербург", "Sakha Republic": "Республіка Саха",
    "Sakhalin Oblast": "Сахалінська", "Samara Oblast": "Самарська",
    "Stavropol Krai": "Ставропольський край", "Sverdlovsk Oblast": "Свердловська",
    "Tatarstan": "Татарстан", "Tomsk Oblast": "Томська", "Tuva": "Тува",
    "Tver Oblast": "Тверська", "Tyumen Oblast": "Тюменська",
    "Udmurtia": "Удмуртія", "Ulyanovsk Oblast": "Ульяновська",
    "Vladimir Oblast": "Володимирська", "Vologda Oblast": "Вологодська",
    "Yamalo-Nenets Autonomous Okrug": "Ямало-Ненецький АО",
    "Yaroslavl Oblast": "Ярославська", "Zabaykalsky Krai": "Забайкальський край",
    "Brest": "Берестейська", "Gomel": "Гомельська",
    "Lublin Voivodeship": "Люблінське", "Subcarpathian Voivodeship": "Підкарпатське",
    "Region of Prešov": "Пряшівський край", "Region of Košice": "Кошицький край",
    "Szabolcs-Szatmár-Bereg": "Саболч-Сатмар-Берег",
    "BOTOSANI": "Ботошані", "GALATI": "Галац",
    "MARAMURES": "Марамуреш", "SATU MARE": "Сату-Маре",
    "SUCEAVA": "Сучава", "TULCEA": "Тулча",
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


def border_extent(iso, point):
    """Positive values lie in the part of a neighbor shown near Ukraine."""
    lon, lat = point
    if iso == "POL":
        return lon - 19.2
    if iso == "SVK":
        return lon - 20.0
    if iso == "HUN":
        return lon - 19.25
    if iso == "ROU":
        return lat - (46.0 - 0.15 * (lon - 22))
    if iso == "BLR":
        return 54.0 - lat
    return 1.0


def clipped_border(geometry, iso):
    """Trim distant border segments without drawing a line across the cut."""
    polygons = geometry["coordinates"] if geometry["type"] == "MultiPolygon" else [geometry["coordinates"]]
    lines = []
    for polygon in polygons:
        ring = polygon[0]
        current = []
        for start, end in zip(ring, ring[1:]):
            start_value, end_value = border_extent(iso, start), border_extent(iso, end)
            if start_value >= 0:
                if not current:
                    current = [start]
                if end_value >= 0:
                    current.append(end)
                else:
                    ratio = start_value / (start_value - end_value)
                    current.append([round(start[0] + ratio * (end[0] - start[0]), 5),
                                    round(start[1] + ratio * (end[1] - start[1]), 5)])
                    if len(current) > 1:
                        lines.append(current)
                    current = []
            elif end_value >= 0:
                ratio = start_value / (start_value - end_value)
                current = [[round(start[0] + ratio * (end[0] - start[0]), 5),
                            round(start[1] + ratio * (end[1] - start[1]), 5)], end]
        if len(current) > 1:
            lines.append(current)
    if not lines:
        raise ValueError(f"No visible country border for {iso}")
    return {"type": "MultiLineString", "coordinates": lines}


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


def main(countries=None, cache=CACHE):
    selected = COUNTRIES if countries is None else tuple(countries)
    cache.mkdir(parents=True, exist_ok=True)
    OUTPUT.mkdir(parents=True, exist_ok=True)
    for iso in selected:
        path = cache / f"{iso}.geojson"
        if not path.exists():
            url = (f"https://github.com/wmgeolab/geoBoundaries/raw/{REVISION}/"
                   f"releaseData/gbOpen/{iso}/ADM1/geoBoundaries-{iso}-ADM1_simplified.geojson")
            urllib.request.urlretrieve(url, path)
        source = json.loads(path.read_text())
        chosen = []
        for feature in source["features"]:
            name = feature["properties"]["shapeName"]
            strength = context_strength(iso, name)
            if not strength:
                continue
            geometry = simplify_geometry(feature["geometry"])
            chosen.append({"type": "Feature", "geometry": geometry, "properties": {
                "id": feature["properties"]["shapeID"], "country": iso,
                "name": name, "label": UKRAINIAN_LABELS.get(name, name.title() if iso == "ROU" else name),
                "center": label_center(geometry), "strength": strength,
                "showLabel": iso == "RUS" or name in NEIGHBOR_NAMES[iso],
                "priorityLabel": iso == "RUS" and name in RUSSIAN_OVERVIEW_LABELS
            }})
        if iso != "RUS":
            missing = NEIGHBOR_NAMES[iso] - {f["properties"]["name"] for f in chosen}
            if missing:
                raise ValueError(f"Missing {iso} border regions: {missing}")
        if iso == "RUS" and len(chosen) != 83:
            raise ValueError("Unexpected Russia ADM1 count; check source for territorial changes")
        if iso == "RUS" and any(f["properties"]["name"] not in UKRAINIAN_LABELS for f in chosen):
            raise ValueError("Every Russian region needs a Ukrainian label")
        output = OUTPUT / f"{iso}.geojson"
        output.write_text(json.dumps({"type": "FeatureCollection", "features": chosen}, ensure_ascii=False, separators=(",", ":")))
        print(f"{iso}: {len(chosen)} regions, {output.stat().st_size:,} bytes")

    adm0_output = ROOT / "data" / "external-admin0"
    adm0_output.mkdir(parents=True, exist_ok=True)
    for iso in COUNTRY_OUTLINES if countries is None else selected:
        path = cache / f"{iso}-adm0.geojson"
        if not path.exists():
            url = (f"https://github.com/wmgeolab/geoBoundaries/raw/{REVISION}/"
                   f"releaseData/gbOpen/{iso}/ADM0/geoBoundaries-{iso}-ADM0_simplified.geojson")
            urllib.request.urlretrieve(url, path)
        source = json.loads(path.read_text())
        if len(source["features"]) != 1:
            raise ValueError(f"Unexpected {iso} ADM0 count")
        feature = source["features"][0]
        geometry = simplify_geometry(feature["geometry"])
        if iso == "BLR":
            geometry = clipped_border(geometry, iso)
        country = {"type": "Feature", "geometry": geometry, "properties": {
            "id": feature["properties"]["shapeID"], "country": iso,
            "name": feature["properties"]["shapeName"],
            **({"label": "Молдова", "center": label_center(geometry)} if iso == "MDA" else {})
        }}
        output = adm0_output / f"{iso}.geojson"
        output.write_text(json.dumps({"type": "FeatureCollection", "features": [country]}, ensure_ascii=False, separators=(",", ":")))
        print(f"{iso} ADM0: 1 country, {output.stat().st_size:,} bytes")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("cache", nargs="?", type=Path, default=CACHE)
    parser.add_argument("--only", nargs="+", choices=COUNTRIES)
    args = parser.parse_args()
    main(args.only, args.cache)
