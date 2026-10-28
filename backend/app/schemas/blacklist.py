import uuid
from datetime import date, datetime

from pydantic import BaseModel, field_validator

from app.models.enums import ApprovalStatusEnum, BlacklistCatEnum


class SuggestBlacklistIn(BaseModel):
    cat: BlacklistCatEnum
    reason: str

    @field_validator("reason")
    @classmethod
    def _reason_required(cls, v: str) -> str:
        v = (v or "").strip()
        if not v:
            raise ValueError("A reason is required")
        return v


class DecideIn(BaseModel):
    decision: bool
    note: str | None = None

    @field_validator("note")
    @classmethod
    def _note_trim(cls, v: str | None) -> str | None:
        return v.strip() if v else None


class RequestExceptionIn(BaseModel):
    reason: str

    @field_validator("reason")
    @classmethod
    def _reason_required(cls, v: str) -> str:
        v = (v or "").strip()
        if not v:
            raise ValueError("Please give a reason")
        return v


class ClearBlacklistIn(BaseModel):
    reason: str

    @field_validator("reason")
    @classmethod
    def _reason_required(cls, v: str) -> str:
        v = (v or "").strip()
        if not v:
            raise ValueError("A reason is required")
        return v


class ApprovalOut(BaseModel):
    approver_id: uuid.UUID
    decision: bool
    note: str | None
    created_at: datetime

    model_config = {"from_attributes": True}


class BlacklistEventOut(BaseModel):
    id: uuid.UUID
    customer_id: uuid.UUID
    cat: BlacklistCatEnum
    status: ApprovalStatusEnum
    reason: str | None
    created_at: datetime

    model_config = {"from_attributes": True}


class ExceptionOut(BaseModel):
    id: uuid.UUID
    customer_id: uuid.UUID
    requested_by: uuid.UUID
    reason: str
    status: ApprovalStatusEnum
    valid_till: date | None
    used_on_visit_id: uuid.UUID | None
    created_at: datetime

    model_config = {"from_attributes": True}
