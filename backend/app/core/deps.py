import uuid

from fastapi import Depends
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.errors import forbidden, unauthorized
from app.core.security import decode_token
from app.models.user import User

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="auth/login", auto_error=False)


def get_current_user(token: str | None = Depends(oauth2_scheme), db: Session = Depends(get_db)) -> User:
    if not token:
        raise unauthorized()
    payload = decode_token(token)
    if not payload or payload.get("type") != "access":
        raise unauthorized("Invalid or expired token")
    user = db.get(User, uuid.UUID(payload["sub"]))
    if not user or not user.is_active:
        raise unauthorized("Account is no longer active")
    return user


def require_roles(*roles: str):
    """Role-gate a route. §3 of the workflow doc: design < manager < admin as nested capability,
    top is a separate track. Pass the exact roles allowed for this endpoint."""

    def _dep(user: User = Depends(get_current_user)) -> User:
        if user.role.value not in roles:
            raise forbidden(f"Requires one of: {', '.join(roles)}")
        return user

    return _dep


# Convenience role gates matching the workflow doc's hierarchy
require_manager_up = require_roles("manager", "admin", "top")
require_admin = require_roles("admin")
require_top = require_roles("top")
require_any = get_current_user
