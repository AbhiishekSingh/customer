"""Staff-side file upload. POST /uploads: a fabric photo or item-feedback attachment photo from
the user's own device (images only — replacing the old "paste a URL" text box, which only worked
if the image already lived somewhere public). POST /uploads/document: the broader set of reference
material — PDF/Word/Excel/photo — used for Customer Visit Entry's "Pre-visit attachments"."""
from fastapi import APIRouter, Depends, File, UploadFile

from app.core.deps import require_any
from app.models.user import User
from app.services.uploads import save_document_upload, save_image_upload

router = APIRouter(prefix="/uploads", tags=["uploads"])


@router.post("")
async def upload_image(file: UploadFile = File(...), _: User = Depends(require_any)) -> dict:
    url = await save_image_upload(file)
    return {"url": url, "name": file.filename}


@router.post("/document")
async def upload_document(file: UploadFile = File(...), _: User = Depends(require_any)) -> dict:
    url = await save_document_upload(file)
    return {"url": url, "name": file.filename}
