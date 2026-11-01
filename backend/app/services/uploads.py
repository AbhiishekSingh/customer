"""Image/document-upload handling shared by the staff-side /uploads endpoints and the public
portal's /portal/{token}/upload endpoint — both just need "take a file, store it safely, hand
back a URL the frontend can put straight into an <img>/<a>".

Deliberately conservative: only a small allow-list of types, a size cap, and a random filename
prefix (never trusting the client-supplied name for the actual save path) written under
app.core.config's UPLOAD_DIR so a crafted filename can't escape the upload directory or collide
with another file. The client's original filename is kept, sanitized, as a suffix purely so a
downloaded/linked file shows something more useful than a bare uuid — it is never used to decide
the file's type or trusted for anything else.
"""
import re
import uuid
from pathlib import Path

from fastapi import UploadFile

from app.core.config import settings
from app.core.errors import validation_error

# (content-type, allowed extensions) — extension is derived from content-type, not trusted
# from the client-supplied filename.
_ALLOWED_IMAGE_TYPES = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
}

# Pre-visit reference material (Customer Visit Entry → "Pre-visit attachments") also needs
# documents, not just photos — a deck, a catalogue PDF, a quote in Word/Excel.
_ALLOWED_DOCUMENT_TYPES = {
    **_ALLOWED_IMAGE_TYPES,
    "application/pdf": ".pdf",
    "application/msword": ".doc",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
    "application/vnd.ms-excel": ".xls",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
}

_SAFE_NAME_RE = re.compile(r"[^A-Za-z0-9._-]+")


def _upload_dir() -> Path:
    d = Path(settings.UPLOAD_DIR)
    d.mkdir(parents=True, exist_ok=True)
    return d


def _safe_original_name(filename: str | None) -> str:
    """Cosmetic only — strips any path component and anything that isn't a safe filename
    character, so the saved file's name stays readable without ever being trusted for the save
    path itself (that's always a fresh uuid, see save_upload below)."""
    base = (filename or "").rsplit("/", 1)[-1].rsplit("\\", 1)[-1].strip()
    base = _SAFE_NAME_RE.sub("_", base)[:80]
    return base.strip("._") or "file"


async def _save_upload(file: UploadFile, allowed: dict[str, str], error_msg: str) -> str:
    ext = allowed.get((file.content_type or "").lower())
    if not ext:
        raise validation_error(error_msg)

    data = await file.read()
    max_bytes = settings.MAX_UPLOAD_MB * 1024 * 1024
    if len(data) > max_bytes:
        raise validation_error(f"File is too large — the limit is {settings.MAX_UPLOAD_MB} MB")
    if not data:
        raise validation_error("That file is empty")

    original = _safe_original_name(file.filename)
    name = f"{uuid.uuid4().hex}_{original}{ext}" if not original.lower().endswith(ext) else f"{uuid.uuid4().hex}_{original}"
    (_upload_dir() / name).write_bytes(data)
    return f"/uploads/{name}"


async def save_image_upload(file: UploadFile) -> str:
    """Validates and saves an uploaded image, returning its public path
    (e.g. "/uploads/<uuid>_photo.jpg") for storage in an attachment_url / photo_url field."""
    return await _save_upload(file, _ALLOWED_IMAGE_TYPES, "Only JPG, PNG, WEBP or GIF images can be uploaded")


async def save_document_upload(file: UploadFile) -> str:
    """Validates and saves an uploaded reference document (PDF/Word/Excel) or photo, for use as
    pre-visit reference material (Customer Visit Entry → "Pre-visit attachments")."""
    return await _save_upload(file, _ALLOWED_DOCUMENT_TYPES, "Only PDF, Word, Excel, or JPG/PNG/WEBP/GIF files can be uploaded")
