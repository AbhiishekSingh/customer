import uuid

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import require_admin
from app.core.errors import conflict, not_found, validation_error
from app.core.security import random_token
from app.models.user import PasswordResetToken, User
from app.schemas.user import UserCreate, UserCreateOut, UserOut, UserUpdate
from app.services.audit import audit
from datetime import datetime, timedelta, timezone
from app.core.config import settings as cfg

router = APIRouter(prefix="/users", tags=["users"], dependencies=[Depends(require_admin)])


@router.get("", response_model=list[UserOut])
def list_users(db: Session = Depends(get_db)) -> list[User]:
    return db.scalars(select(User).order_by(User.name)).all()


@router.post("", response_model=UserCreateOut, status_code=201)
def create_user(payload: UserCreate, db: Session = Depends(get_db), admin: User = Depends(require_admin)) -> dict:
    if db.scalar(select(User).where(User.email == payload.email.lower())):
        raise conflict(f"A user with email {payload.email} already exists")
    # §5 of the validation doc: admin never sets a password directly — a reset/invite token is
    # issued instead, and the account has no usable password_hash until the invite is completed.
    user = User(name=payload.name, email=payload.email.lower(), role=payload.role, title=payload.title, password_hash=None)
    db.add(user)
    db.flush()
    rec = PasswordResetToken(
        user_id=user.id,
        token=random_token(32),
        expires_at=datetime.now(timezone.utc) + timedelta(minutes=cfg.RESET_TOKEN_MINUTES * 48),  # invite link lives longer than a plain reset
    )
    db.add(rec)
    audit(db, user_id=admin.id, action="create_user", entity_type="user", entity_id=user.id, detail={"email": user.email, "role": user.role.value})
    db.commit()
    # No email service wired up yet: hand the one-time invite link straight back to the admin who
    # created the account (this endpoint is admin-only already) so they can pass it on themselves.
    invite_link = f"{cfg.FRONTEND_URL}/set-password?token={rec.token}"
    return {**UserOut.model_validate(user).model_dump(), "invite_link": invite_link}


@router.patch("/{user_id}", response_model=UserOut)
def update_user(user_id: uuid.UUID, payload: UserUpdate, db: Session = Depends(get_db), admin: User = Depends(require_admin)) -> User:
    user = db.get(User, user_id)
    if not user:
        raise not_found("User not found")
    data = payload.model_dump(exclude_unset=True)
    for field, value in data.items():
        setattr(user, field, value)
    audit(db, user_id=admin.id, action="update_user", entity_type="user", entity_id=user.id, detail=data)
    db.commit()
    return user


@router.post("/{user_id}/deactivate", response_model=UserOut)
def deactivate_user(user_id: uuid.UUID, db: Session = Depends(get_db), admin: User = Depends(require_admin)) -> User:
    """Users are never hard-deleted — they're owner_id/approver_id foreign keys throughout the
    schema (§5 of the validation doc). Deactivating just blocks login and drops them from pickers."""
    user = db.get(User, user_id)
    if not user:
        raise not_found("User not found")
    user.is_active = False
    audit(db, user_id=admin.id, action="deactivate_user", entity_type="user", entity_id=user.id)
    db.commit()
    return user
