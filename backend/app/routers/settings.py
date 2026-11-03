from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import require_admin, require_any
from app.models.user import User
from app.schemas.settings import SettingsUpdate
from app.services.audit import audit
from app.services.settings_service import get_settings, update_settings

router = APIRouter(prefix="/settings", tags=["settings"], dependencies=[Depends(require_admin)])

# Separate router, NOT gated by require_admin: any authenticated staff member needs to know
# whether auto_send is on, so the Dashboard can flag a mail that's due but stuck waiting for a
# manual "Send now" (see Dashboard.jsx's todo list). This intentionally exposes only the one
# boolean flag — none of the other settings (emails, intervals, holidays) are admin-only for a
# reason and stay behind read_settings above.
public_router = APIRouter(prefix="/settings", tags=["settings"])


@public_router.get("/auto-send-status")
def read_auto_send_status(db: Session = Depends(get_db), _: User = Depends(require_any)) -> dict:
    return {"auto_send": get_settings(db)["auto_send"]}


@router.get("")
def read_settings(db: Session = Depends(get_db)) -> dict:
    return get_settings(db)


@router.patch("")
def patch_settings(payload: SettingsUpdate, db: Session = Depends(get_db), admin: User = Depends(require_admin)) -> dict:
    # PATCH semantics only — sent fields change, everything else is left alone (§11 of the
    # validation doc: never a full-row replace that could null out fields the form didn't send).
    patch = payload.model_dump(exclude_unset=True, exclude_none=True)
    if "holidays" in patch:
        patch["holidays"] = [h if isinstance(h, dict) else h.model_dump() for h in payload.holidays]
    result = update_settings(db, patch)
    audit(db, user_id=admin.id, action="update_settings", entity_type="settings", detail=patch)
    db.commit()
    return result
