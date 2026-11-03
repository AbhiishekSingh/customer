import logging
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.core.config import settings as app_settings
from app.routers import auth, blacklist, categories, customers, directory, fabrics, mail_templates, mails, notifications, portal, reports, settings, uploads, users, visits
from app.scheduler import start_scheduler, stop_scheduler

app = FastAPI(title="ABG Customer Follow-Up API")

# The React frontend is a separate origin (served by its own dev server / static host) —
# CORS has to be open for it to call this API at all. Credentials aren't cookie-based (JWT in the
# Authorization header), so a permissive origin list here doesn't expose a CSRF surface.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(users.router)
app.include_router(directory.router)
app.include_router(categories.router)
app.include_router(fabrics.router)
app.include_router(customers.router)
app.include_router(visits.router)
app.include_router(mails.router)
app.include_router(mail_templates.router)
app.include_router(portal.router)
app.include_router(blacklist.router)
app.include_router(reports.router)
app.include_router(settings.router)
app.include_router(settings.public_router)
app.include_router(notifications.router)
app.include_router(uploads.router)

# Uploaded fabric photos / item-feedback attachments are served straight back out from disk.
Path(app_settings.UPLOAD_DIR).mkdir(parents=True, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=app_settings.UPLOAD_DIR), name="uploads")


@app.on_event("startup")
def _on_startup() -> None:
    start_scheduler()
    # Every follow-up email's one-time response link is built as f"{FRONTEND_URL}/portal/{token}"
    # (see app/services/mail_engine.py send_mail). Outside local dev this MUST be set to the
    # real, public site address in .env — if it's left at the localhost default, every link a
    # customer receives is dead on arrival (and on a production box, an unmatched/unreachable
    # link is exactly what makes the customer's browser fall through to the app's own login
    # screen instead of the response form). This only ever logs a warning; it never blocks startup.
    if app_settings.ENV != "development" and "localhost" in app_settings.FRONTEND_URL:
        logging.getLogger("abg.config").warning(
            "FRONTEND_URL is still set to %r outside development (ENV=%r) — every portal link "
            "in an outgoing email will be broken for customers. Set FRONTEND_URL in .env to this "
            "site's real public address (e.g. http://46.202.164.88:8083) and restart.",
            app_settings.FRONTEND_URL, app_settings.ENV,
        )


@app.on_event("shutdown")
def _on_shutdown() -> None:
    stop_scheduler()


@app.get("/health")
def health() -> dict:
    return {"ok": True}
