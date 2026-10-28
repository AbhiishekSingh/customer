import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import get_current_user
from app.core.errors import rate_limited, unauthorized, validation_error
from app.core.security import (
    create_access_token,
    create_refresh_token,
    decode_token,
    hash_password,
    random_token,
    verify_password,
)
from app.core.config import settings as cfg
from app.models.user import PasswordResetToken, User
from app.schemas.auth import (
    ForgotPasswordRequest,
    LoginRequest,
    MeResponse,
    RefreshRequest,
    ResetPasswordRequest,
    ROLE_LABELS,
    TokenResponse,
)
from app.services.audit import audit
from app.services.rate_limit import ip_is_rate_limited, record_ip_attempt

router = APIRouter(prefix="/auth", tags=["auth"])

MAX_FAILED_ATTEMPTS = 5
LOCKOUT_MINUTES = 15
GENERIC_LOGIN_ERROR = "Check your role, email and password"


def _me(user: User) -> MeResponse:
    return MeResponse(id=user.id, name=user.name, email=user.email, role=user.role, role_label=ROLE_LABELS[user.role])


@router.post("/login", response_model=TokenResponse)
def login(payload: LoginRequest, request: Request, db: Session = Depends(get_db)) -> TokenResponse:
    ip = request.client.host if request.client else "unknown"
    if ip_is_rate_limited(ip):
        raise rate_limited()
    record_ip_attempt(ip)

    user = db.scalar(select(User).where(User.email == payload.email.lower()))

    # Generic failure path — never reveal which part was wrong (§1 of the validation doc).
    def fail(existing: User | None):
        if existing:
            existing.failed_attempts += 1
            if existing.failed_attempts >= MAX_FAILED_ATTEMPTS:
                existing.locked_until = datetime.now(timezone.utc) + timedelta(minutes=LOCKOUT_MINUTES)
            db.commit()
        raise unauthorized(GENERIC_LOGIN_ERROR)

    if not user or not user.is_active:
        fail(user)

    if user.locked_until and user.locked_until > datetime.now(timezone.utc):
        raise rate_limited(f"Account temporarily locked — try again after {user.locked_until.isoformat()}")

    if not user.password_hash or not verify_password(payload.password, user.password_hash):
        fail(user)

    # Role tile is a UX convenience only — the server always checks it against the real stored role.
    if user.role != payload.role_selected:
        fail(user)

    # success: reset lockout state
    user.failed_attempts = 0
    user.locked_until = None
    audit(db, user_id=user.id, action="login", entity_type="user", entity_id=user.id)
    db.commit()

    access = create_access_token(str(user.id), user.role.value)
    refresh = create_refresh_token(str(user.id))
    return TokenResponse(access_token=access, refresh_token=refresh, user=_me(user))


@router.post("/refresh", response_model=TokenResponse)
def refresh(payload: RefreshRequest, db: Session = Depends(get_db)) -> TokenResponse:
    data = decode_token(payload.refresh_token)
    if not data or data.get("type") != "refresh":
        raise unauthorized("Invalid or expired refresh token")
    user = db.get(User, uuid.UUID(data["sub"]))
    if not user or not user.is_active:
        raise unauthorized("Account is no longer active")
    # Re-check the CURRENT role from the DB — §1 edge case: a role change takes effect by the
    # next refresh at the latest, never bakes in the role from the old access token.
    access = create_access_token(str(user.id), user.role.value)
    new_refresh = create_refresh_token(str(user.id))
    return TokenResponse(access_token=access, refresh_token=new_refresh, user=_me(user))


@router.post("/logout")
def logout(db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> dict:
    audit(db, user_id=user.id, action="logout", entity_type="user", entity_id=user.id)
    db.commit()
    return {"ok": True}


@router.get("/me", response_model=MeResponse)
def me(user: User = Depends(get_current_user)) -> MeResponse:
    return _me(user)


@router.post("/forgot-password")
def forgot_password(payload: ForgotPasswordRequest, db: Session = Depends(get_db)) -> dict:
    user = db.scalar(select(User).where(User.email == payload.email.lower()))
    # Always return the same generic response whether or not the email exists (§1 edge case).
    if user:
        # Invalidate any previous still-live token for this user before issuing a new one.
        db.query(PasswordResetToken).filter(
            PasswordResetToken.user_id == user.id, PasswordResetToken.used.is_(False)
        ).update({"used": True})
        rec = PasswordResetToken(
            user_id=user.id,
            token=random_token(32),
            expires_at=datetime.now(timezone.utc) + timedelta(minutes=cfg.RESET_TOKEN_MINUTES),
        )
        db.add(rec)
        db.commit()
        # In production this is emailed, never returned in the API response.
    return {"ok": True, "message": "If that email exists, a reset link has been sent."}


@router.post("/reset-password")
def reset_password(payload: ResetPasswordRequest, db: Session = Depends(get_db)) -> dict:
    rec = db.scalar(select(PasswordResetToken).where(PasswordResetToken.token == payload.token))
    if not rec or rec.used or rec.expires_at < datetime.now(timezone.utc):
        raise validation_error("This reset link is invalid or has expired.")
    user = db.get(User, rec.user_id)
    if not user:
        raise validation_error("This reset link is invalid or has expired.")
    user.password_hash = hash_password(payload.new_password)
    user.failed_attempts = 0
    user.locked_until = None
    rec.used = True
    audit(db, user_id=user.id, action="password_reset", entity_type="user", entity_id=user.id)
    db.commit()
    return {"ok": True}
