from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import require_admin
from app.models.user import User
from app.schemas.settings import SettingsUpdate
from app.services.audit import audit
from app.services.settings_service import get_settings, update_settings

router = APIRouter(prefix="/settings", tags=["settings"], dependencies=[Depends(require_admin)])


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
