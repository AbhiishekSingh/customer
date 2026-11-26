"""One-off bulk load of the client's real Item Master data (AW 27-28 Commercial sheet) into the
`fabrics` table. This is the production equivalent of what the sign-off prototype seeded as demo
data — run this once the schema patch (scripts/migrate_item_master_fields.py) and master lists
(scripts/seed_masters.py) are already in place.

The workbook has four sheets — Men's Woven, Womens Woven, Men's Knits, Womens Knits — each with a
slightly different column set (woven sheets have Warp/Weft/Fin. Const.; knit sheets have
FIBRE/Yarn Details/Structure instead). Gender is NOT a column in the sheet — it comes from which
sheet a row is on. Column headers vary slightly between sheets (trailing spaces, "Weft" vs
"Weft ", "Structure" vs "Structure/Gauge", a stray typo like "Sr. no." on one sheet) — this script
matches headers by stripped name against a small set of known variants per field rather than a
fixed column index, so it tolerates that without silently misreading a column.

Idempotent / safe to re-run: upserts by Sort No. (`code`), same as the CSV importer.

Usage:
    python3 -m scripts.import_item_master_excel /path/to/AW_27-28_Commercial.xlsx
"""
import re
import sys

import openpyxl

from app.core.database import SessionLocal
from app.models.fabric import Fabric

# sheet name -> which gender it represents and which column set it uses ('woven' sheets have
# Warp/Weft/Fin. Const.; 'knit' sheets have FIBRE/Yarn Details/Structure instead).
SHEET_CFG = {
    "Men's Woven": {"gender": "Men's", "kind": "woven"},
    "Womens Woven": {"gender": "Women's", "kind": "woven"},
    "Men's Knits": {"gender": "Men's", "kind": "knit"},
    "Womens Knits": {"gender": "Women's", "kind": "knit"},
}

# Each field's accepted header spellings, matched after stripping whitespace — the sheets are not
# consistent column-to-column (see module docstring).
HEADER_ALIASES = {
    "season": ["Season"],
    "story": ["Story", "STORY"],
    "development_no": ["Development No."],
    "code": ["Sort No."],
    "gsm": ["GSM"],
    "width_cm": ["Width in cm"],
    "width_inch": ["Width in inch"],
    "supplier": ["Existing Supplier"],
    "price_meter": ["Tentative Price/meter \n(Ex-mill) 23.08.26", "Tentative Price/meter"],
    "moq": ["MOQ/MCQ", "MOQ"],
    "lapf_domestic": ["Additional LAPF Domestic"],
    "lapf_export": ["LAPF Export"],
    "remark": ["Remark"],
    "fabric_category_raw": ["Type"],
    "fabric_type_raw": ["Weave"],
    "print_type_raw": ["Process/Print Type"],
    "warp": ["Warp"],
    "weft": ["Weft"],
    "composition": ["Fabric Blend", "F Blend%", "F Blend"],
    "fin_const": ["Fin. Const."],
    "sort_no_sticker": ["Sort no for Sticker Printing"],
    "fibre": ["FIBRE"],
    "yarn_details": ["Yarn Details"],
    "structure_gauge": ["Structure/Gauge", "Structure"],
    "dia_inch": ["Dia in inch"],
}


def build_col_map(header_row: tuple) -> dict:
    """Map our field names to this sheet's actual column index, by stripped header text."""
    stripped = [str(h).strip() if h is not None else "" for h in header_row]
    col_map = {}
    for field, aliases in HEADER_ALIASES.items():
        for alias in aliases:
            if alias in stripped:
                col_map[field] = stripped.index(alias)
                break
    return col_map


def split_multi(raw) -> list[str] | None:
    """'Arthanari/BP Textile/Elite' or 'Exim, Matrix, KTP' -> ['Arthanari', 'BP Textile', ...].
    The sheet uses '/' as the separator on woven rows and ',' on knit rows (sometimes both in the
    same row) — split on either rather than assuming one per sheet."""
    if raw is None:
        return None
    parts = [p.strip() for p in re.split(r"[\/,]", str(raw)) if p.strip()]
    return parts or None


def s(v) -> str | None:
    """Stringify a cell value for a free-text column, rounding floats to 2dp (openpyxl returns
    Width in inch etc. as long floats like 57.874015748031496) and treating blank/None as unset."""
    if v is None:
        return None
    if isinstance(v, float):
        v = round(v, 2)
        if v == int(v):
            v = int(v)
    v = str(v).strip()
    return v or None


def normalize_fabric_category(raw) -> str | None:
    """'Woven' / 'Knits' / 'KNITS' -> 'Woven' / 'Knit' (matches the fabric_category master
    seeded by scripts/seed_masters.py, which uses the singular 'Knit')."""
    if raw is None:
        return None
    low = str(raw).strip().lower()
    if low.startswith("woven"):
        return "Woven"
    if low.startswith("knit"):
        return "Knit"
    return str(raw).strip() or None


def extract_rows(path: str) -> list[dict]:
    wb = openpyxl.load_workbook(path, data_only=True)
    out: list[dict] = []
    seen_codes: set[str] = set()
    for sheet_name, cfg in SHEET_CFG.items():
        if sheet_name not in wb.sheetnames:
            print(f"  ! sheet '{sheet_name}' not found in this workbook — skipped")
            continue
        ws = wb[sheet_name]
        rows = list(ws.iter_rows(values_only=True))
        if not rows:
            continue
        col_map = build_col_map(rows[0])
        if "code" not in col_map:
            print(f"  ! sheet '{sheet_name}': couldn't find a 'Sort No.' column — skipped entirely")
            continue

        def get(row, field):
            idx = col_map.get(field)
            return row[idx] if idx is not None and idx < len(row) else None

        count = 0
        for row in rows[1:]:
            if not any(row):
                continue
            code_raw = get(row, "code")
            code = s(code_raw)
            if not code:
                continue  # a blank Sort No. row — nothing to key this item on, skip
            code = code.upper()
            if code in seen_codes:
                print(f"  ! duplicate Sort No. '{code}' in '{sheet_name}' — keeping the first one seen, skipping this row")
                continue
            seen_codes.add(code)

            item = {
                "code": code,
                "development_no": s(get(row, "development_no")),
                "season": s(get(row, "season")),
                "story": s(get(row, "story")),
                "gender": [cfg["gender"]],
                "fabric_category": normalize_fabric_category(get(row, "fabric_category_raw")),
                "supplier": s(get(row, "supplier")),
                "price_meter": s(get(row, "price_meter")),
                "moq": s(get(row, "moq")),
                "lapf_domestic": split_multi(get(row, "lapf_domestic")),
                "lapf_export": split_multi(get(row, "lapf_export")),
                "remark": s(get(row, "remark")),
                "width_cm": s(get(row, "width_cm")),
            }
            gsm_raw = get(row, "gsm")
            try:
                item["gsm"] = float(gsm_raw) if gsm_raw not in (None, "") else None
            except (TypeError, ValueError):
                item["gsm"] = None

            if cfg["kind"] == "woven":
                item.update({
                    "fabric_type": s(get(row, "fabric_type_raw")),
                    "print_type": s(get(row, "print_type_raw")),
                    "warp": s(get(row, "warp")),
                    "weft": s(get(row, "weft")),
                    "composition": s(get(row, "composition")),
                    "fin_const": s(get(row, "fin_const")),
                    "width_inch": s(get(row, "width_inch")),
                })
            else:  # knit
                item.update({
                    "sort_no_sticker": s(get(row, "sort_no_sticker")),
                    "fibre": s(get(row, "fibre")),
                    "yarn_details": s(get(row, "yarn_details")),
                    "composition": s(get(row, "composition")),
                    "structure_gauge": s(get(row, "structure_gauge")),
                    "dia_inch": s(get(row, "dia_inch")),
                })

            item["name"] = item["development_no"] or item["code"]
            out.append(item)
            count += 1
        print(f"  {sheet_name}: {count} rows")
    return out


def main():
    if len(sys.argv) != 2:
        print(__doc__)
        sys.exit(1)
    path = sys.argv[1]
    print(f"Reading {path} ...")
    rows = extract_rows(path)
    print(f"Extracted {len(rows)} item rows total. Writing to the database...")

    db = SessionLocal()
    created = updated = 0
    try:
        for item in rows:
            existing = db.query(Fabric).filter_by(code=item["code"]).first()
            if existing:
                for field, value in item.items():
                    if field == "code":
                        continue
                    setattr(existing, field, value)
                updated += 1
            else:
                db.add(Fabric(**item))
                created += 1
        db.commit()
    finally:
        db.close()
    print(f"Done: {created} created, {updated} updated.")


if __name__ == "__main__":
    main()
