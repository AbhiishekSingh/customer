"""One-off schema patch: lets item_feedback rows exist without a mail reply behind them, so a
Design Team member can log per-item sentiment right at visit-entry time, before any follow-up
mail has even gone out (see scripts/migrate_visit_fields.py for why this kind of script exists
instead of a real Alembic migration).

Adds:
  - item_feedback.mail_response_id becomes nullable (was NOT NULL) — null means "logged at visit
    entry", not "from a mail reply".
  - item_feedback.logged_by_user_id (nullable) — the staff user who typed a visit-entry note;
    stays null for a mail-reply-sourced row.
  - item_feedback.logged_at (NOT NULL once backfilled) — one unified timestamp to sort/pick the
    latest feedback by, regardless of source. Existing rows are backfilled from their mail
    response's submitted_at before the column is made NOT NULL, so no row is ever left without one.

Safe to re-run — every step is guarded (IF NOT EXISTS / only backfills NULLs / only sets NOT NULL
if nothing is still NULL).

Run once, against the same database the app points at:
    python3 -m scripts.migrate_item_feedback_visit_entry
"""
from sqlalchemy import text

from app.core.database import engine

with engine.begin() as conn:
    conn.execute(text("ALTER TABLE item_feedback ALTER COLUMN mail_response_id DROP NOT NULL"))
    conn.execute(text("ALTER TABLE item_feedback ADD COLUMN IF NOT EXISTS logged_by_user_id UUID REFERENCES users(id)"))
    conn.execute(text("ALTER TABLE item_feedback ADD COLUMN IF NOT EXISTS logged_at TIMESTAMPTZ"))
    conn.execute(text("""
        UPDATE item_feedback f
        SET logged_at = r.submitted_at
        FROM mail_responses r
        WHERE f.mail_response_id = r.id AND f.logged_at IS NULL
    """))
    # Any row with neither a mail response nor a backfilled timestamp yet (shouldn't exist, but
    # guard anyway) falls back to its own created_at rather than being left NULL.
    conn.execute(text("UPDATE item_feedback SET logged_at = created_at WHERE logged_at IS NULL"))
    still_null = conn.execute(text("SELECT count(*) FROM item_feedback WHERE logged_at IS NULL")).scalar()
    if still_null == 0:
        conn.execute(text("ALTER TABLE item_feedback ALTER COLUMN logged_at SET NOT NULL"))

print("item_feedback table patched: mail_response_id nullable, logged_by_user_id + logged_at added/backfilled.")
