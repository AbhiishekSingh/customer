"""One-off schema patch: adds the new company-level address/contact columns to `customers`
(state, address_line1, address_line2, pincode, company_email, company_phone).

This project has no live Alembic migration chain wired up — `Base.metadata.create_all()` (used by
scripts/seed_minimal.py and scripts/seed_masters.py) only CREATES missing tables, it never ALTERs
an existing one to add a new column. So a schema change to an already-created table needs this
kind of one-off patch script instead. Safe to re-run — every ADD COLUMN is IF NOT EXISTS.

Run once, against the same database the app points at:
    python3 -m scripts.migrate_customer_address_fields
"""
from sqlalchemy import text

from app.core.database import engine

STATEMENTS = [
    "ALTER TABLE customers ADD COLUMN IF NOT EXISTS state VARCHAR(100)",
    "ALTER TABLE customers ADD COLUMN IF NOT EXISTS address_line1 VARCHAR(300)",
    "ALTER TABLE customers ADD COLUMN IF NOT EXISTS address_line2 VARCHAR(300)",
    "ALTER TABLE customers ADD COLUMN IF NOT EXISTS pincode VARCHAR(20)",
    "ALTER TABLE customers ADD COLUMN IF NOT EXISTS company_email VARCHAR(254)",
    "ALTER TABLE customers ADD COLUMN IF NOT EXISTS company_phone VARCHAR(40)",
]

with engine.begin() as conn:
    for stmt in STATEMENTS:
        conn.execute(text(stmt))

print("customers table patched with state/address_line1/address_line2/pincode/company_email/company_phone.")
