"""Staff-side image upload — any logged-in user can upload a fabric photo or an
item-feedback attachment photo from their own device (replacing the old "paste a URL"
text box, which only worked if the image already lived somewhere public)."""
from fastapi import APIRouter, Depends, File, UploadFile

from app.core.deps import require_any
from app.models.user import User
from app.services.uploads import save_image_upload

router = APIRouter(prefix="/uploads", tags=["uploads"])


@router.post("")
async def upload_image(file: UploadFile = File(...), _: User = Depends(require_any)) -> dict:
    url = await save_image_upload(file)
    return {"url": url}
