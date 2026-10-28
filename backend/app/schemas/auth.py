import uuid

from pydantic import BaseModel, EmailStr, field_validator

from app.models.enums import RoleEnum

ROLE_LABELS = {
    RoleEnum.design: "Design Team Member",
    RoleEnum.manager: "Manager",
    RoleEnum.admin: "Admin",
    RoleEnum.top: "Top Management",
}


class LoginRequest(BaseModel):
    email: EmailStr
    password: str
    role_selected: RoleEnum

    @field_validator("password")
    @classmethod
    def password_not_empty(cls, v: str) -> str:
        if not v:
            raise ValueError("Password is required")
        return v


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    user: "MeResponse"


class RefreshRequest(BaseModel):
    refresh_token: str


class MeResponse(BaseModel):
    id: uuid.UUID
    name: str
    email: str
    role: RoleEnum
    role_label: str

    model_config = {"from_attributes": True}


class ForgotPasswordRequest(BaseModel):
    email: EmailStr


class ResetPasswordRequest(BaseModel):
    token: str
    new_password: str

    @field_validator("new_password")
    @classmethod
    def password_strength(cls, v: str) -> str:
        if len(v) < 10:
            raise ValueError("Password must be at least 10 characters")
        if v.isdigit():
            raise ValueError("Password cannot be purely numeric")
        return v


TokenResponse.model_rebuild()
