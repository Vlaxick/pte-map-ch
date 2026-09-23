#!/usr/bin/env python3
"""Build the local settlement index from the GeoNames Ukraine country dump.

Usage: python3 tools/build_settlements.py /path/to/UA.zip
Source: https://download.geonames.org/export/dump/UA.zip (CC BY 4.0)
"""

import json
import re
import sys
import unicodedata
import zipfile
from difflib import SequenceMatcher
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "data" / "settlements.json"
CYRILLIC = re.compile(r"^[А-Яа-яІіЇїЄєҐґʼ’'\-\s]+$")
UKRAINIAN = set("іїєґІЇЄҐ")
KNOWN_UK = {
    "Donetsk": "Донецьк", "Luhansk": "Луганськ", "Khmelnytskyi": "Хмельницький",
    "Zaporizhzhya": "Запоріжжя", "Sevastopol": "Севастополь",
    "Kropyvnytskyi": "Кропивницький", "Lutsk": "Луцьк",
    "Kramatorsk": "Краматорськ", "Kerch": "Керч", "Simferopol": "Сімферополь",
}
TRANSLIT = {
    **dict(zip("абвгдеийклмнопрстуфхцчшщюяьъэыё", [
        "a", "b", "v", "h", "d", "e", "y", "i", "k", "l", "m", "n", "o", "p", "r", "s", "t", "u", "f", "kh", "ts", "ch", "sh", "shch", "yu", "ya", "", "", "e", "y", "yo"
    ])),
    "і": "i", "ї": "yi", "є": "ye", "ґ": "g", "г": "h",
}


def latin(value):
    value = "".join(TRANSLIT.get(char, char) for char in value.lower())
    return "".join(char for char in unicodedata.normalize("NFKD", value)
                   if char.isascii() and char.isalpha())


def choose_name(name, alternate_names):
    if name in KNOWN_UK:
        return KNOWN_UK[name]
    candidates = [value.strip() for value in alternate_names.split(",")
                  if CYRILLIC.fullmatch(value.strip()) and len(value.strip()) < 55]
    if not candidates:
        return name
    target = latin(name)
    return max(candidates, key=lambda value: (
        SequenceMatcher(None, latin(value), target).ratio() +
        (0.085 if any(char in UKRAINIAN for char in value) else 0) +
        (0.11 if "цьк" in value.lower() or "ськ" in value.lower() else 0) -
        (0.2 if " " in value and " " not in name else 0),
        -len(value)
    ))


def inside_ring(lon, lat, ring):
    inside = False
    previous = ring[-1]
    for current in ring:
        x1, y1 = previous
        x2, y2 = current
        if (y1 > lat) != (y2 > lat) and lon < (x2 - x1) * (lat - y1) / (y2 - y1) + x1:
            inside = not inside
        previous = current
    return inside


def inside_polygon(lon, lat, polygon):
    return inside_ring(lon, lat, polygon[0]) and not any(
        inside_ring(lon, lat, hole) for hole in polygon[1:]
    )


def load_raions():
    geojson = json.loads((ROOT / "data" / "neptun-raions.geojson").read_text(encoding="utf-8"))
    raions = []
    for feature in geojson["features"]:
        geometry = feature["geometry"]
        polygons = geometry["coordinates"] if geometry["type"] == "MultiPolygon" else [geometry["coordinates"]]
        for polygon in polygons:
            exterior = polygon[0]
            xs = [point[0] for point in exterior]
            ys = [point[1] for point in exterior]
            raions.append((min(xs), min(ys), max(xs), max(ys), polygon,
                           feature["properties"]["rayon"]))
    return raions


def main():
    source = Path(sys.argv[1])
    places = []
    raions = load_raions()
    with zipfile.ZipFile(source) as archive:
        for line in archive.read("UA.txt").decode("utf-8").splitlines():
            row = line.split("\t")
            if row[6] != "P" or row[7] not in {"PPL", "PPLA", "PPLA2", "PPLA3", "PPLA4", "PPLC"}:
                continue
            name = choose_name(row[1], row[3])
            lat, lon = float(row[4]), float(row[5])
            raion = next((label for west, south, east, north, polygon, label in raions
                          if west <= lon <= east and south <= lat <= north and
                          inside_polygon(lon, lat, polygon)), "")
            places.append([name, round(lat, 5), round(lon, 5), int(row[14] or 0),
                           row[10], row[1] if row[1] != name else "", raion])
    places.sort(key=lambda place: (-place[3], place[0]))
    OUTPUT.write_text(json.dumps({"source": "GeoNames UA country dump, 2026-09-23, CC BY 4.0",
                                  "places": places}, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"Wrote {len(places)} settlements to {OUTPUT}")


if __name__ == "__main__":
    main()
