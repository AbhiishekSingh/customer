"""Image-upload handling shared by the staff-side /uploads endpoint and the public
portal's /portal/{token}/upload endpoint — both just need "take an image file, store it
safely, hand back a URL the frontend can put straight into an <img>/<a>".

Deliberately conservative: only a small allow-list of image types, a size cap, and a
random filename (never the client-supplied name) written under app.core.config's
UPLOAD_DIR so a crafted filename can't escape the upload directory or collide with
another file.
"""
import uuid
from pathlib import Path

from fastapi import UploadFile

from app.core.config import settings
from app.core.errors import validation_error

# (content-type, allowed extensions) — extension is derived from content-type, not trusted
# from the client-supplied filename.
_ALLOWED_TYPES = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
}


def _upload_dir() -> Path:
    d = Path(settings.UPLOAD_DIR)
    d.mkdir(parents=True, exist_ok=True)
    return d


async def save_image_upload(file: UploadFile) -> str:
    """Validates and saves an uploaded image, returning its public path
    (e.g. "/uploads/<uuid>.jpg") for storage in an attachment_url / photo_url field."""
    ext = _ALLOWED_TYPES.get((file.content_type or "").lower())
    if not ext:
        raise validation_error("Only JPG, PNG, WEBP or GIF images can be uploaded")

    data = await file.read()
    max_bytes = settings.MAX_UPLOAD_MB * 1024 * 1024
    if len(data) > max_bytes:
        raise validation_error(f"Image is too large — the limit is {settings.MAX_UPLOAD_MB} MB")
    if not data:
        raise validation_error("That file is empty")

    name = f"{uuid.uuid4().hex}{ext}"
    (_upload_dir() / name).write_bytes(data)
    return f"/uploads/{name}"
