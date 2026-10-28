"""Names-only user directory, open to ANY authenticated role (unlike /users, which is admin-only
for the full account-management shape). Nearly every list/detail page in the UI needs to resolve
an owner_id, approver_id or presenter id to a display name — this is the one place that's safe to
expose without leaking email addresses or account-management detail to non-admin roles."""
from sqlalchemy import select
from sqlalchemy.orm import Session

from fastapi import APIRouter, Depends

from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.user import User
from app.schemas.user import UserDirectoryEntry

router = APIRouter(prefix="/directory", tags=["directory"])


@router.get("/users", response_model=list[UserDirectoryEntry])
def list_directory(db: Session = Depends(get_db), _: User = Depends(get_current_user)) -> list[User]:
    return db.scalars(select(User).order_by(User.name)).all()
