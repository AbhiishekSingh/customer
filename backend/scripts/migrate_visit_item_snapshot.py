"""One-off schema patch adding the per-visit-line Item Master snapshot column.
Same pattern as scripts/migrate_item_master_fields.py — safe to re-run (IF NOT EXISTS).

Run once, against the same database the app points at:
    python3 -m scripts.migrate_visit_item_snapshot
"""
from sqlalchemy import text

from app.core.database import engine

STATEMENTS = [
    "ALTER TABLE visit_items ADD COLUMN IF NOT EXISTS item_details JSONB",
]

with engine.begin() as conn:
    for stmt in STATEMENTS:
        conn.execute(text(stmt))

print("visit_items table patched with the item_details snapshot column.")
