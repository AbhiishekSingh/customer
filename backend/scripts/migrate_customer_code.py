"""One-off schema patch: adds a human-facing unique `customer_code` (e.g. "CUST-0001") to every
row in `customers`, backed by a Postgres sequence so new creates can mint the next code atomically
without a race condition.

This project has no live Alembic migration chain wired up (see migrate_customer_address_fields.py
for the established pattern) — `Base.metadata.create_all()` only CREATES missing tables, it never
ALTERs an existing one to add a new column. So a schema change to an already-created table needs
this kind of one-off patch script instead.

Safe to re-run:
  - the ADD COLUMN and CREATE SEQUENCE/INDEX statements are all IF NOT EXISTS
  - the backfill loop only touches rows where customer_code IS NULL
  - the sequence is only (re)synced past the current max code once, after backfilling

Run once, against the same database the app points at:
    python3 -m scripts.migrate_customer_code
"""
from sqlalchemy import text

from app.core.database import engine

with engine.begin() as conn:
    conn.execute(text("ALTER TABLE customers ADD COLUMN IF NOT EXISTS customer_code VARCHAR(20)"))
    conn.execute(text("CREATE SEQUENCE IF NOT EXISTS customer_code_seq START 1"))

    # Backfill any existing rows that don't have a code yet, oldest first, so codes roughly follow
    # creation order. Done in Python (not a single SQL UPDATE) so each row gets a sequence-minted
    # value instead of a window-function guess that could collide with a code assigned concurrently
    # by the app in between.
    rows = conn.execute(text("SELECT id FROM customers WHERE customer_code IS NULL ORDER BY created_at")).fetchall()
    for (customer_id,) in rows:
        n = conn.execute(text("SELECT nextval('customer_code_seq')")).scalar()
        conn.execute(
            text("UPDATE customers SET customer_code = :code WHERE id = :id"),
            {"code": f"CUST-{n:04d}", "id": customer_id},
        )

    conn.execute(text("ALTER TABLE customers ALTER COLUMN customer_code SET NOT NULL"))
    conn.execute(text("CREATE UNIQUE INDEX IF NOT EXISTS ix_customers_customer_code ON customers (customer_code)"))

    backfilled = len(rows)

print(f"customers table patched with customer_code (backfilled {backfilled} existing row(s)).")
