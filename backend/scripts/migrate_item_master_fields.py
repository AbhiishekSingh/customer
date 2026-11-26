"""One-off schema patch for the Item Master rebuild (client's AW 27-28 Commercial sheet).
Same pattern as the other scripts/migrate_*.py files — create_all() only creates missing tables,
never alters existing ones, so new columns on an already-running database need an explicit ALTER.
Safe to re-run: every statement is IF NOT EXISTS / conditional.

Run once, against the same database the app points at:
    python3 -m scripts.migrate_item_master_fields

Run scripts/seed_masters.py and scripts/import_item_master_excel.py AFTER this one.
"""
from sqlalchemy import text

from app.core.database import engine

STATEMENTS = [
    # quality_category (legacy D&D "fabric category") is no longer collected on new items per the
    # client's Item Master rebuild — it was never a column in their sheet. Existing rows/values are
    # untouched; this just stops the API from requiring it on every future insert.
    "ALTER TABLE fabrics ALTER COLUMN quality_category DROP NOT NULL",

    "ALTER TABLE fabrics ADD COLUMN IF NOT EXISTS development_no VARCHAR(100)",
    "ALTER TABLE fabrics ADD COLUMN IF NOT EXISTS gender JSONB",
    "ALTER TABLE fabrics ADD COLUMN IF NOT EXISTS season VARCHAR(100)",
    "ALTER TABLE fabrics ADD COLUMN IF NOT EXISTS story VARCHAR(100)",
    "ALTER TABLE fabrics ADD COLUMN IF NOT EXISTS fabric_category VARCHAR(100)",
    "ALTER TABLE fabrics ADD COLUMN IF NOT EXISTS fabric_type VARCHAR(100)",
    "ALTER TABLE fabrics ADD COLUMN IF NOT EXISTS print_type VARCHAR(100)",
    "ALTER TABLE fabrics ADD COLUMN IF NOT EXISTS lapf_domestic JSONB",
    "ALTER TABLE fabrics ADD COLUMN IF NOT EXISTS lapf_export JSONB",
    "ALTER TABLE fabrics ADD COLUMN IF NOT EXISTS warp VARCHAR(200)",
    "ALTER TABLE fabrics ADD COLUMN IF NOT EXISTS weft VARCHAR(200)",
    "ALTER TABLE fabrics ADD COLUMN IF NOT EXISTS fin_const VARCHAR(100)",
    "ALTER TABLE fabrics ADD COLUMN IF NOT EXISTS width_cm VARCHAR(50)",
    "ALTER TABLE fabrics ADD COLUMN IF NOT EXISTS width_inch VARCHAR(50)",
    "ALTER TABLE fabrics ADD COLUMN IF NOT EXISTS price_meter VARCHAR(50)",
    "ALTER TABLE fabrics ADD COLUMN IF NOT EXISTS moq VARCHAR(50)",
    "ALTER TABLE fabrics ADD COLUMN IF NOT EXISTS remark TEXT",
    "ALTER TABLE fabrics ADD COLUMN IF NOT EXISTS sort_no_sticker VARCHAR(100)",
    "ALTER TABLE fabrics ADD COLUMN IF NOT EXISTS dia_inch VARCHAR(50)",
    "ALTER TABLE fabrics ADD COLUMN IF NOT EXISTS structure_gauge VARCHAR(100)",
    "ALTER TABLE fabrics ADD COLUMN IF NOT EXISTS fibre VARCHAR(100)",
    "ALTER TABLE fabrics ADD COLUMN IF NOT EXISTS yarn_details TEXT",

    # Optional From/To date range on a category row — only meaningful for type='season' (e.g.
    # "AW 27-28" ~ Jul-Dec), left NULL for every other category type.
    "ALTER TABLE categories ADD COLUMN IF NOT EXISTS date_from DATE",
    "ALTER TABLE categories ADD COLUMN IF NOT EXISTS date_to DATE",
]

with engine.begin() as conn:
    for stmt in STATEMENTS:
        conn.execute(text(stmt))

print("fabrics + categories tables patched for the Item Master rebuild.")
