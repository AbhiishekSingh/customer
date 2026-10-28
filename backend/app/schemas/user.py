import uuid

from pydantic import BaseModel, EmailStr

from app.models.enums import RoleEnum


class UserCreate(BaseModel):
    name: str
    email: EmailStr
    role: RoleEnum
    title: str | None = None


class UserUpdate(BaseModel):
    name: str | None = None
    role: RoleEnum | None = None
    title: str | None = None
    is_active: bool | None = None


class UserOut(BaseModel):
    id: uuid.UUID
    name: str
    email: str
    role: RoleEnum
    title: str | None
    is_active: bool

    model_config = {"from_attributes": True}


class UserCreateOut(UserOut):
    """Returned only from POST /users, to the admin who just created the account. Carries the
    one-time invite link so the admin can hand it to the new user directly (e.g. paste into chat
    or email themselves) until real SMTP sending is wired up — never shown anywhere else, and
    never on a plain GET /users listing."""

    invite_link: str


class UserDirectoryEntry(BaseModel):
    """Minimal, non-sensitive shape (no email) for resolving owner_id/approver_id/presenter names
    anywhere in the UI — every authenticated role needs this, unlike the full UserOut (admin-only)."""

    id: uuid.UUID
    name: str
    role: RoleEnum
    title: str | None
    is_active: bool

    model_config = {"from_attributes": True}
