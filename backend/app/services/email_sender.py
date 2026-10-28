"""Thin SMTP sender used by mail_engine (the 5 follow-up emails) and auth (forgot-password
reset links). Deliberately simple — plain smtplib over STARTTLS, no SDK/vendor lock-in, so it
works with Brevo, any other SMTP relay, or a company mailbox without code changes, just .env.

If SMTP_HOST isn't set (local dev, tests, or a server nobody configured yet), send_email()
logs a warning and returns instead of raising — the rest of the app (follow-up scheduling,
Outbox records, portal links) must keep working even when nobody's wired up email yet. Only
once SMTP_HOST *is* set does a real failure (bad credentials, network, etc.) raise
EmailSendError, so callers that care (the manual "Send now" flow) can surface it clearly
instead of silently pretending an email went out.
"""

import logging
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

from app.core.config import settings

logger = logging.getLogger("abg.email")


class EmailSendError(Exception):
    """Raised when SMTP is configured but the actual send failed (bad auth, network, rejected
    recipient, etc.). Not raised when SMTP simply isn't configured — see module docstring."""


def send_email(to_email: str, subject: str, body: str, cc: str | None = None) -> None:
    if not settings.SMTP_HOST or not settings.SMTP_LOGIN or not settings.SMTP_PASSWORD or not settings.MAIL_FROM_EMAIL:
        logger.warning("SMTP not configured — skipping real send to %s (subject: %r)", to_email, subject)
        return

    msg = MIMEMultipart()
    msg["From"] = f"{settings.MAIL_FROM_NAME} <{settings.MAIL_FROM_EMAIL}>"
    msg["To"] = to_email
    recipients = [to_email]
    if cc:
        msg["Cc"] = cc
        recipients += [c.strip() for c in cc.split(",") if c.strip()]
    msg["Subject"] = subject
    msg.attach(MIMEText(body, "plain"))

    try:
        with smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT, timeout=20) as server:
            server.starttls()
            server.login(settings.SMTP_LOGIN, settings.SMTP_PASSWORD)
            server.sendmail(settings.MAIL_FROM_EMAIL, recipients, msg.as_string())
    except Exception as exc:  # noqa: BLE001 — deliberately broad: any SMTP failure is reported the same way
        logger.exception("Failed to send email to %s", to_email)
        raise EmailSendError(str(exc)) from exc
