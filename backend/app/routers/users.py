import uuid

from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import require_admin
from app.core.errors import conflict, not_found, validation_error
from app.core.security import random_token
from app.models.enums import RoleEnum
from app.models.user import PasswordResetToken, User
from app.schemas.user import UserCreate, UserCreateOut, UserOut, UserUpdate
from app.services.audit import audit
from app.services.email_sender import EmailSendError, email_configured, send_email
from datetime import datetime, timedelta, timezone
from app.core.config import settings as cfg
import logging

logger = logging.getLogger("abg.users")

router = APIRouter(prefix="/users", tags=["users"], dependencies=[Depends(require_admin)])


def _active_admin_count(db: Session) -> int:
    return db.scalar(
        select(func.count()).select_from(User).where(User.role == RoleEnum.admin, User.is_active == True)  # noqa: E712
    ) or 0


def _block_if_removes_last_admin(db: Session, user: User, final_role: RoleEnum, final_active: bool) -> None:
    """§ at least one admin must always remain, so the system is never locked out of its own
    admin-only screens (Users & roles, Categories, Settings). Only matters when the user being
    changed is CURRENTLY an active admin and the change would take them out of that state (role
    change away from admin, or deactivation) — any other edit is unaffected."""
    was_active_admin = user.role == RoleEnum.admin and user.is_active
    would_stay_active_admin = final_role == RoleEnum.admin and final_active
    if was_active_admin and not would_stay_active_admin and _active_admin_count(db) <= 1:
        raise validation_error("At least one active admin must remain — promote another user to Admin first.")


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

    invite_link = f"{cfg.FRONTEND_URL}/set-password?token={rec.token}"
    invite_emailed = False
    if email_configured():
        try:
            send_email(
                to_email=user.email,
                subject="Set your password — Customer Follow-Up",
                body=(
                    f"Hi {user.name},\n\n"
                    "An account has been created for you on the Customer Follow-Up system.\n\n"
                    f"Set your password here (valid for {cfg.RESET_TOKEN_MINUTES * 48 // 60} hours):\n"
                    f"{invite_link}\n\n"
                    "If you weren't expecting this, you can ignore this email."
                ),
            )
            invite_emailed = True
        except EmailSendError:
            # Fall back to the link shown in the UI — don't block account creation over it.
            logger.exception("Failed to send invite email to %s", user.email)
    # Always hand the link back too, regardless of whether the email went out — covers SMTP
    # not being configured yet, a failed send, or the admin just wanting to share it directly.
    return {**UserOut.model_validate(user).model_dump(), "invite_link": invite_link, "invite_emailed": invite_emailed}


@router.patch("/{user_id}", response_model=UserOut)
def update_user(user_id: uuid.UUID, payload: UserUpdate, db: Session = Depends(get_db), admin: User = Depends(require_admin)) -> User:
    user = db.get(User, user_id)
    if not user:
        raise not_found("User not found")
    data = payload.model_dump(exclude_unset=True)
    final_role = data.get("role", user.role)
    final_active = data.get("is_active", user.is_active)
    _block_if_removes_last_admin(db, user, final_role, final_active)
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
    _block_if_removes_last_admin(db, user, user.role, False)
    user.is_active = False
    audit(db, user_id=admin.id, action="deactivate_user", entity_type="user", entity_id=user.id)
    db.commit()
    return user
