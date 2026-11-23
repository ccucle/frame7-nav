#!/usr/bin/env python3
"""Build the static USDA SR Legacy catalogue from a verified official CSV ZIP.

No third-party packages or API keys are required. The source manifest contains
the pinned archive checksum, exact nutrient definitions and reviewed Korean
search labels. Raw source values are never inferred from other foods.

Usage:
  python fitplan-dev/build-catalog.py --archive /path/to/official-source.zip
  python fitplan-dev/build-catalog.py --check --archive /path/to/official-source.zip
  python fitplan-dev/build-catalog.py --download  # official public ZIP only

--check rebuilds in memory and compares the shipped catalogue and validation
report without writing. Normal builds write food-catalog.json and the manifest's
validationResults. The checkedAt date is fixed in the manifest, not the clock.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
from collections import Counter, defaultdict
from decimal import Decimal, InvalidOperation
from pathlib import Path
from urllib.request import urlopen
from zipfile import ZipFile

ROOT = Path(__file__).resolve().parents[1]
LIMIT = Decimal("0.1")
EXPECTED_ANOMALY_IDS = {168246, 168314, 169191, 170603, 174513}


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ValueError(message)


def json_number(value: Decimal | None) -> int | float | None:
    if value is None:
        return None
    return int(value) if value == value.to_integral_value() else float(value)


def parse_amount(raw: str, context: str) -> Decimal | None:
    if raw == "":
        return None
    try:
        number = Decimal(raw)
    except InvalidOperation as error:
        raise ValueError(f"Invalid nutrient amount ({context}): {raw!r}") from error
    require(number.is_finite() and number >= 0, f"Invalid nutrient amount ({context}): {raw!r}")
    return number


def read_table(archive: ZipFile, filename: str) -> list[dict[str, str]]:
    matches = [name for name in archive.namelist() if name.endswith("/" + filename)]
    require(len(matches) == 1, f"Expected exactly one {filename} inside source ZIP")
    with archive.open(matches[0]) as source:
        with io.TextIOWrapper(source, encoding="utf-8-sig", newline="") as text:
            return list(csv.DictReader(text))


def make_catalog(archive_path: Path, manifest: dict) -> tuple[dict, dict]:
    payload = archive_path.read_bytes()
    digest = hashlib.sha256(payload).hexdigest()
    expected = manifest["archive"]
    require(digest == expected["sha256"], "Source ZIP SHA256 mismatch; do not silently substitute another release")
    require(len(payload) == expected["bytes"], "Source ZIP byte count mismatch")
    with ZipFile(io.BytesIO(payload)) as archive:
        source_foods = read_table(archive, "food.csv")
        source_values = read_table(archive, "food_nutrient.csv")
        definitions = {row["id"]: row for row in read_table(archive, "nutrient.csv")}
        sr_rows = read_table(archive, "sr_legacy_food.csv")
        categories = {row["id"]: row for row in read_table(archive, "food_category.csv")}
        derivations = {row["id"]: row for row in read_table(archive, "food_nutrient_derivation.csv")}
        nutrient_sources = {row["id"]: row for row in read_table(archive, "food_nutrient_source.csv")}

    food_map = {row["fdc_id"]: row for row in source_foods}
    sr_map = {row["fdc_id"]: row for row in sr_rows}
    require(len(source_foods) == 7793 == len(food_map) == len(sr_map), "Unexpected or duplicate food IDs")
    require(set(food_map) == set(sr_map), "Food and SR Legacy ID sets differ")
    require(all(row["data_type"] == "sr_legacy_food" for row in source_foods), "Source contains an unexpected data type")
    require({row["publication_date"] for row in source_foods} == {"2019-04-01"}, "Unexpected FDC publication date")

    wanted: dict[str, str] = {}
    for key, spec in manifest["nutrientMapping"].items():
        nutrient_id = str(spec["fdcNutrientId"])
        actual = definitions.get(nutrient_id)
        require(actual is not None, f"Missing nutrient definition: {nutrient_id}")
        for actual_field, expected_field in [("name", "name"), ("unit_name", "unit"), ("nutrient_nbr", "legacyNutrientNumber")]:
            require(actual[actual_field] == spec[expected_field], f"Nutrient definition mismatch: {key}/{actual_field}")
        wanted[nutrient_id] = key

    values: dict[str, dict[str, Decimal | None]] = defaultdict(dict)
    value_rows: dict[str, dict[str, dict]] = defaultdict(dict)
    for row in source_values:
        key = wanted.get(row["nutrient_id"])
        if key is None:
            continue
        food_id = row["fdc_id"]
        require(food_id in food_map, f"Unknown nutrient food ID: {food_id}")
        require(key not in values[food_id], f"Duplicate {key} value for {food_id}")
        values[food_id][key] = parse_amount(row["amount"], f"FDC {food_id}, {key}")
        value_rows[food_id][key] = row

    curated = manifest["curatedKorean"]
    for food_id, entry in curated.items():
        require(food_id in food_map, f"Unknown curated FDC ID: {food_id}")
        require(food_map[food_id]["description"] == entry["nameEn"], f"Curated English description mismatch: {food_id}")
        require(isinstance(entry["nameKo"], str) and entry["nameKo"].strip(), f"Missing Korean name: {food_id}")
        require(all(isinstance(alias, str) and alias.strip() for alias in entry["aliases"]), f"Invalid aliases: {food_id}")
        require(len(set(entry["aliases"])) == len(entry["aliases"]), f"Duplicate aliases: {food_id}")

    missing = Counter()
    status_counts = Counter()
    category_counts = Counter()
    maxima: dict[str, Decimal] = defaultdict(lambda: Decimal(0))
    inconsistencies = []
    rounding_differences = []
    output_rows = []

    def value_provenance(food_id: str, key: str) -> dict:
        row = value_rows[food_id][key]
        derivation = derivations.get(row["derivation_id"], {})
        nutrient_source = nutrient_sources.get(derivation.get("source_id", ""), {})
        return {
            "fdcNutrientId": int(row["nutrient_id"]),
            "sourceAmount": row["amount"],
            "foodNutrientRowId": int(row["id"]),
            "derivationId": row["derivation_id"] or None,
            "derivationCode": derivation.get("code") or None,
            "derivationDescription": derivation.get("description") or None,
            "sourceCode": nutrient_source.get("code") or None,
            "sourceDescription": nutrient_source.get("description") or None,
        }

    for food_id in sorted(food_map, key=int):
        food = food_map[food_id]
        nutrients = {key: values[food_id].get(key) for key in manifest["nutrientMapping"]}
        for key, amount in nutrients.items():
            if amount is None:
                missing[key] += 1
            else:
                maxima[key] = max(maxima[key], amount)
                maximum = Decimal(1000) if key == "kcal" else Decimal("100.1")
                require(amount <= maximum, f"Out-of-range {key} for FDC {food_id}: {amount}")
        require(all(nutrients[key] is not None for key in ["kcal", "protein", "carbs", "fat"]), f"Missing required macronutrient for {food_id}")
        mono, poly, fat = nutrients["mono"], nutrients["poly"], nutrients["fat"]
        if mono is None or poly is None:
            unsat = None
            unsat_status = "missing"
        else:
            source_sum = mono + poly
            difference = source_sum - fat
            if difference > LIMIT:
                unsat = None
                unsat_status = "source-inconsistent"
                inconsistencies.append({
                    "fdcId": int(food_id), "ndbNumber": sr_map[food_id]["NDB_number"],
                    "nameEn": food["description"], "sourceUrl": manifest["sourceUrl"],
                    "monoPlusPoly": json_number(source_sum), "excessOverTotalFat": json_number(difference),
                    "handling": "Original mono/poly/fat retained. Derived unsat is null; not zero and not clamped.",
                    "sourceNutrients": {key: value_provenance(food_id, key) for key in ["fat", "mono", "poly"]},
                })
            else:
                unsat = source_sum
                unsat_status = "calculated"
                if difference > 0:
                    rounding_differences.append({"fdcId": int(food_id), "excessOverTotalFat": json_number(difference)})
        nutrients["unsat"] = unsat
        status_counts[unsat_status] += 1
        category = categories[food["food_category_id"]]["description"]
        category_counts[category] += 1
        translation = curated.get(food_id, {})
        output_rows.append({
            "id": "usda-sr-" + food_id, "fdcId": int(food_id), "ndbNumber": sr_map[food_id]["NDB_number"],
            "nameEn": food["description"], "nameKo": translation.get("nameKo"),
            "aliases": translation.get("aliases", []), "category": category,
            "per100g": {key: json_number(amount) for key, amount in nutrients.items()},
            "unsatStatus": unsat_status, "sourceUrl": manifest["sourceUrl"],
        })

    require({row["fdcId"] for row in inconsistencies} == EXPECTED_ANOMALY_IDS, "Unexpected fatty-acid inconsistency set")
    require(status_counts == {"missing": 518, "source-inconsistent": 5, "calculated": 7270}, "Unexpected unsaturated-fat completeness counts")
    require(len(rounding_differences) == 29, "Unexpected minor fatty-acid rounding difference count")
    require(len(curated) == 80, "Expected 80 reviewed Korean descriptions")
    require(len({row["id"] for row in output_rows}) == 7793, "Duplicate output IDs")
    report = {
        "foodCount": len(output_rows), "sourceFoodNutrientRows": len(source_values),
        "curatedKoreanCount": len(curated), "englishOnlyCount": len(output_rows) - len(curated),
        "missingBySourceNutrient": {key: missing[key] for key in manifest["nutrientMapping"]},
        "unsatStatuses": dict(sorted(status_counts.items())),
        "unsatUnconfirmedCount": status_counts["missing"] + status_counts["source-inconsistent"],
        "maximaPer100g": {key: json_number(maxima[key]) for key in manifest["nutrientMapping"]},
        "sourceInconsistencies": inconsistencies,
        "retainedRoundingDifferences": rounding_differences,
        "categoryCounts": dict(sorted(category_counts.items())),
        "checks": [
            "Official archive SHA256 and byte length match pinned manifest.",
            "All 7793 distinct FDC IDs join exactly to SR Legacy IDs.",
            "Energy uses nutrient 1008 in KCAL; kJ nutrient 1062 is not substituted.",
            "Every Korean display label joins by exact FDC ID AND unchanged English description.",
            "All required calorie/macronutrient values exist, are finite, nonnegative and within bounds.",
            "No missing nutrient is replaced with zero or inferred from another food.",
            "Unsaturated fat is decimal mono+poly only where both exist and pass the stated consistency policy.",
        ],
    }
    catalog = {
        "meta": {
            "schemaVersion": 1, "source": manifest["source"], "sourceUrl": manifest["sourceUrl"],
            "datasetDate": manifest["datasetDate"], "publicationDate": "2019-04-01",
            "checkedAt": manifest["checkedAt"], "basis": "100 g edible portion",
            "license": "CC0-1.0", "foodCount": len(output_rows), "curatedKoreanCount": len(curated),
            "unsatUnconfirmedCount": report["unsatUnconfirmedCount"],
            "unsatMissingCount": status_counts["missing"], "unsatInconsistentCount": status_counts["source-inconsistent"],
            "archiveSha256": digest,
            "nutrientIds": {key: spec["fdcNutrientId"] for key, spec in manifest["nutrientMapping"].items()},
            "languageNote": "영문 원문 전체 + 검토한 한국어 이름 80개. 한국어명은 USDA 공식 번역이 아니며 별칭은 검색용입니다.",
            "scopeNote": "미국 USDA SR Legacy 2018년 기준 자료이며 모든 식품 또는 최신 국내 제품을 포함하지 않습니다.",
            "missingNote": "확인할 수 없는 불포화지방은 null입니다. 0g을 의미하지 않습니다.",
        },
        "foods": output_rows,
    }
    return catalog, report


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, default=ROOT / "fitplan-dev/source-manifest.json")
    parser.add_argument("--archive", type=Path, default=ROOT / "raw-food-data/FoodData_Central_sr_legacy_food_csv_2018-04.zip")
    parser.add_argument("--output", type=Path, default=ROOT / "fitplan/food-catalog.json")
    parser.add_argument("--download", action="store_true", help="Download pinned public USDA archive if not already present")
    parser.add_argument("--check", action="store_true", help="Verify generated artifacts in memory without writing")
    args = parser.parse_args()
    manifest = json.loads(args.manifest.read_text(encoding="utf-8"))
    if args.download and not args.archive.exists():
        require(not args.check, "--check does not download or write")
        with urlopen(manifest["archive"]["url"], timeout=30) as response:
            payload = response.read()
        require(hashlib.sha256(payload).hexdigest() == manifest["archive"]["sha256"], "Downloaded source checksum mismatch")
        args.archive.parent.mkdir(parents=True, exist_ok=True)
        args.archive.write_bytes(payload)
    catalog, report = make_catalog(args.archive, manifest)
    serialized = json.dumps(catalog, ensure_ascii=False, separators=(",", ":"), allow_nan=False) + "\n"
    report["catalogBytes"] = len(serialized.encode("utf-8"))
    report["catalogSha256"] = hashlib.sha256(serialized.encode("utf-8")).hexdigest()
    if args.check:
        require(args.output.read_text(encoding="utf-8") == serialized, "Shipped catalogue differs from reproducible source build")
        require(manifest.get("validationResults") == report, "Manifest validation report differs from reproducible source build")
    else:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(serialized, encoding="utf-8")
        manifest["validationResults"] = report
        args.manifest.write_text(json.dumps(manifest, ensure_ascii=False, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    print(json.dumps({"mode": "check" if args.check else "build", "foods": report["foodCount"], "koreanNames": report["curatedKoreanCount"], "unsatMissing": report["unsatStatuses"]["missing"], "unsatInconsistent": report["unsatStatuses"]["source-inconsistent"], "catalogBytes": report["catalogBytes"], "catalogSha256": report["catalogSha256"]}, ensure_ascii=False))


if __name__ == "__main__":
    main()
