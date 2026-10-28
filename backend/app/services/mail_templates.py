"""Editable subject/body for each of the 6 outgoing mail variants (Mail 1-4, plus Mail 5
'ordered' and Mail 5 'notordered' as two separate templates) — Settings → Email Templates.

Replaces what used to be hardcoded strings in mail_engine.py's mail_subject_intro()/send_mail().
DEFAULT_TEMPLATES below is word-for-word what those used to hardcode, and is what
scripts/migrate_mail_templates.py seeds the table with, so installing this feature changes
nothing until an admin actually edits a template.

Placeholders are plain {name} tokens substituted at send time from real visit/customer/contact
data — never typed per-email by a person. {link} is the one placeholder the whole response-portal
flow depends on, so it's required to appear exactly once in every template's body.
"""
import re
import uuid
from datetime import date, datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.errors import validation_error
from app.models.mail import MailTemplate

# (mail_number, variant) -> defaults. variant is None for Mail 1-4; Mail 5 has two variants.
DEFAULT_TEMPLATES: dict[tuple[int, str | None], dict[str, str]] = {
    (1, None): {
        "subject": "Swatches from our meeting on {visit_date} — your feedback",
        "body": (
            "Dear {contact_name},\n\nThank you for meeting us. Could you share your feedback on the "
            "fabric selections below?\n\nFabrics selected on {visit_date}:\n{items}"
            "\n\nPlease respond here — no login needed:\n{link}"
            "\n\n(The link stays valid until you open it. Once opened, it remains active for "
            "{link_validity_hours} hours, and you can edit your response during that time.)"
        ),
    },
    (2, None): {
        "subject": "Update on swatch testing — {customer_name}",
        "body": (
            "Dear {contact_name},\n\nWe hope the performance testing of the swatches is going well. "
            "Could you share an update?\n\nFabrics selected on {visit_date}:\n{items}"
            "\n\nPlease respond here — no login needed:\n{link}"
            "\n\n(The link stays valid until you open it. Once opened, it remains active for "
            "{link_validity_hours} hours, and you can edit your response during that time.)"
        ),
    },
    (3, None): {
        "subject": "Proto sample and fabric quality feedback — {customer_name}",
        "body": (
            "Dear {contact_name},\n\nHas a proto sample been made, and was the fabric quality okay?"
            "\n\nFabrics selected on {visit_date}:\n{items}"
            "\n\nPlease respond here — no login needed:\n{link}"
            "\n\n(The link stays valid until you open it. Once opened, it remains active for "
            "{link_validity_hours} hours, and you can edit your response during that time.)"
        ),
    },
    (4, None): {
        "subject": "Order status for the selected fabrics — {customer_name}",
        "body": (
            "Dear {contact_name},\n\nCould you let us know whether an order has been placed?"
            "\n\nFabrics selected on {visit_date}:\n{items}"
            "\n\nPlease respond here — no login needed:\n{link}"
            "\n\n(The link stays valid until you open it. Once opened, it remains active for "
            "{link_validity_hours} hours, and you can edit your response during that time.)"
        ),
    },
    (5, "ordered"): {
        "subject": "Your order — execution status and in-store availability",
        "body": (
            "Dear {contact_name},\n\nCould you share the order execution status and where it can be "
            "purchased?\n\nFabrics selected on {visit_date}:\n{items}"
            "\n\nPlease respond here — no login needed:\n{link}"
            "\n\n(The link stays valid until you open it. Once opened, it remains active for "
            "{link_validity_hours} hours, and you can edit your response during that time.)"
        ),
    },
    (5, "notordered"): {
        "subject": "Our new collection — would you like a preview?",
        "body": (
            "Dear {contact_name},\n\nOur new collection is ready. Would you be interested in seeing it?"
            "\n\nFabrics selected on {visit_date}:\n{items}"
            "\n\nPlease respond here — no login needed:\n{link}"
            "\n\n(The link stays valid until you open it. Once opened, it remains active for "
            "{link_validity_hours} hours, and you can edit your response during that time.)"
        ),
    },
}

# Shown to the admin as the available merge fields; also used to flag an unknown {placeholder}
# in validate_template() so a typo gets caught at save time, not discovered by a customer.
PLACEHOLDERS = [
    {"key": "contact_name", "label": "Customer contact's name"},
    {"key": "customer_name", "label": "Company name"},
    {"key": "visit_date", "label": "Date of the visit (dd/mm/yyyy)"},
    {"key": "items", "label": "The fabric list for this visit"},
    {"key": "link", "label": "The customer's one-time response link — required, exactly once"},
    {"key": "link_validity_hours", "label": "How many hours the link stays open once opened"},
]
PLACEHOLDER_KEYS = {p["key"] for p in PLACEHOLDERS}

_TOKEN_RE = re.compile(r"\{([a-zA-Z0-9_]*)\}")


def _fmt_date(d: date) -> str:
    return f"{d.day:02d}/{d.month:02d}/{d.year}"


def all_templates(db: Session) -> list[MailTemplate]:
    rows = {(r.mail_number, r.variant): r for r in db.scalars(select(MailTemplate)).all()}
    out = []
    for (mail_number, variant), defaults in DEFAULT_TEMPLATES.items():
        row = rows.get((mail_number, variant))
        if row:
            out.append(row)
        else:
            # Table not migrated/seeded yet for this one — hand back an unsaved row with the
            # built-in defaults rather than erroring, so the Settings tab still renders.
            out.append(MailTemplate(id=uuid.uuid4(), mail_number=mail_number, variant=variant,
                                     subject=defaults["subject"], body=defaults["body"]))
    out.sort(key=lambda t: (t.mail_number, t.variant or ""))
    return out


def get_template(db: Session, mail_number: int, variant: str | None) -> MailTemplate:
    row = db.scalar(select(MailTemplate).where(MailTemplate.mail_number == mail_number, MailTemplate.variant == variant))
    if row:
        return row
    defaults = DEFAULT_TEMPLATES.get((mail_number, variant))
    if not defaults:
        raise validation_error("Unknown mail template")
    return MailTemplate(id=uuid.uuid4(), mail_number=mail_number, variant=variant,
                         subject=defaults["subject"], body=defaults["body"])


def validate_template(subject: str, body: str) -> None:
    if not subject or not subject.strip():
        raise validation_error("Subject can't be empty")
    if not body or not body.strip():
        raise validation_error("Body can't be empty")

    for text, field in ((subject, "subject"), (body, "body")):
        for token in _TOKEN_RE.findall(text):
            if token not in PLACEHOLDER_KEYS:
                raise validation_error(f"Unknown placeholder {{{token}}} in {field} — see the list of available placeholders")

    link_count = len(re.findall(r"\{link\}", body))
    if link_count == 0:
        raise validation_error("The body must include {link} — it's the customer's response link, and without it the mail can't be responded to")
    if link_count > 1:
        raise validation_error("{link} can only appear once in the body")


def render(template: MailTemplate, *, contact_name: str, customer_name: str, visit_date: date,
           items: str, link: str, link_validity_hours: int) -> tuple[str, str]:
    """Substitutes every {placeholder} with real data for one actual send. Any {token} left in
    the saved text that isn't a known placeholder was already rejected at save time by
    validate_template(), so this never has to guess what to do with an unrecognised one."""
    values = {
        "contact_name": contact_name,
        "customer_name": customer_name,
        "visit_date": _fmt_date(visit_date),
        "items": items,
        "link": link,
        "link_validity_hours": str(link_validity_hours),
    }
    subject = template.subject.format(**values)
    body = template.body.format(**values)
    return subject, body


def save_template(db: Session, mail_number: int, variant: str | None, subject: str, body: str, user_id) -> MailTemplate:
    validate_template(subject, body)
    row = db.scalar(select(MailTemplate).where(MailTemplate.mail_number == mail_number, MailTemplate.variant == variant))
    if not row:
        defaults = DEFAULT_TEMPLATES.get((mail_number, variant))
        if not defaults:
            raise validation_error("Unknown mail template")
        row = MailTemplate(mail_number=mail_number, variant=variant, subject=subject, body=body)
        db.add(row)
    else:
        row.subject = subject
        row.body = body
    row.updated_by_user_id = user_id
    row.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(row)
    return row


def reset_template(db: Session, mail_number: int, variant: str | None, user_id) -> MailTemplate:
    defaults = DEFAULT_TEMPLATES.get((mail_number, variant))
    if not defaults:
        raise validation_error("Unknown mail template")
    return save_template(db, mail_number, variant, defaults["subject"], defaults["body"], user_id)
