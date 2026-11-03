"""One-off schema patch: adds a human-facing unique `visit_code` (e.g. "VISIT-0001") to every row
in `visits`, backed by a Postgres sequence so new creates can mint the next code atomically without
a race condition. Exact same pattern as scripts/migrate_customer_code.py for customers.customer_code
— see that script's docstring for the full reasoning (no live Alembic chain in this project, so a
schema change to an already-created table needs a one-off patch like this instead of relying on
Base.metadata.create_all(), which only CREATES missing tables).

Safe to re-run:
  - the ADD COLUMN and CREATE SEQUENCE/INDEX statements are all IF NOT EXISTS
  - the backfill loop only touches rows where visit_code IS NULL
  - the sequence is only (re)synced past the current max code once, after backfilling

Run once, against the same database the app points at:
    python3 -m scripts.migrate_visit_code
"""
from sqlalchemy import text

from app.core.database import engine

with engine.begin() as conn:
    conn.execute(text("ALTER TABLE visits ADD COLUMN IF NOT EXISTS visit_code VARCHAR(20)"))
    conn.execute(text("CREATE SEQUENCE IF NOT EXISTS visit_code_seq START 1"))

    # Backfill any existing rows that don't have a code yet, oldest first, so codes roughly follow
    # creation order. Done in Python (not a single SQL UPDATE) so each row gets a sequence-minted
    # value instead of a window-function guess that could collide with a code assigned concurrently
    # by the app in between.
    rows = conn.execute(text("SELECT id FROM visits WHERE visit_code IS NULL ORDER BY created_at")).fetchall()
    for (visit_id,) in rows:
        n = conn.execute(text("SELECT nextval('visit_code_seq')")).scalar()
        conn.execute(
            text("UPDATE visits SET visit_code = :code WHERE id = :id"),
            {"code": f"VISIT-{n:04d}", "id": visit_id},
        )

    conn.execute(text("ALTER TABLE visits ALTER COLUMN visit_code SET NOT NULL"))
    conn.execute(text("CREATE UNIQUE INDEX IF NOT EXISTS ix_visits_visit_code ON visits (visit_code)"))

    backfilled = len(rows)

print(f"visits table patched with visit_code (backfilled {backfilled} existing row(s)).")
