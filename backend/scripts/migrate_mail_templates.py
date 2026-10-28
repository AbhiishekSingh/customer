"""One-off schema patch: creates the mail_templates table and seeds it with the exact wording
that used to be hardcoded in app/services/mail_engine.py (mail_subject_intro() + send_mail()'s
body f-string) — see app/services/mail_templates.py for the new placeholder-substitution version
those functions now call instead.

Installing this changes NOTHING about what customers receive until someone actually edits a
template from Settings → Email Templates — the seeded rows are word-for-word what was already
being sent.

Safe to re-run — table creation is IF NOT EXISTS and seeding only inserts rows that don't already
exist (so an admin's edits are never overwritten by re-running this).

Run once, against the same database the app points at:
    python3 -m scripts.migrate_mail_templates
"""
import uuid

from sqlalchemy import text

from app.core.database import engine
from app.services.mail_templates import DEFAULT_TEMPLATES

with engine.begin() as conn:
    conn.execute(text("""
        CREATE TABLE IF NOT EXISTS mail_templates (
            id UUID PRIMARY KEY,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            mail_number INTEGER NOT NULL,
            variant VARCHAR(20),
            subject VARCHAR(300) NOT NULL,
            body TEXT NOT NULL,
            updated_by_user_id UUID REFERENCES users(id),
            updated_at TIMESTAMPTZ
        )
    """))
    conn.execute(text("""
        CREATE UNIQUE INDEX IF NOT EXISTS ix_mail_templates_number_variant
        ON mail_templates (mail_number, COALESCE(variant, ''))
    """))

    for (mail_number, variant), tpl in DEFAULT_TEMPLATES.items():
        existing = conn.execute(
            text("SELECT 1 FROM mail_templates WHERE mail_number = :n AND COALESCE(variant, '') = COALESCE(:v, '')"),
            {"n": mail_number, "v": variant},
        ).first()
        if existing:
            continue
        conn.execute(
            text("""
                INSERT INTO mail_templates (id, mail_number, variant, subject, body)
                VALUES (:id, :n, :v, :subject, :body)
            """),
            {"id": str(uuid.uuid4()), "n": mail_number, "v": variant, "subject": tpl["subject"], "body": tpl["body"]},
        )

print("mail_templates table created and seeded with the 6 default templates.")
