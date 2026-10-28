"""One-off schema patch: adds presented_by and attachments columns to `visits`
(see scripts/migrate_customer_address_fields.py for why this kind of script exists instead of a
real Alembic migration — create_all() only creates missing tables, never alters existing ones).
Safe to re-run — every ADD COLUMN is IF NOT EXISTS.

Run once, against the same database the app points at:
    python3 -m scripts.migrate_visit_fields
"""
from sqlalchemy import text

from app.core.database import engine

STATEMENTS = [
    "ALTER TABLE visits ADD COLUMN IF NOT EXISTS presented_by JSONB",
    "ALTER TABLE visits ADD COLUMN IF NOT EXISTS attachments JSONB",
]

with engine.begin() as conn:
    for stmt in STATEMENTS:
        conn.execute(text(stmt))

print("visits table patched with presented_by/attachments.")
