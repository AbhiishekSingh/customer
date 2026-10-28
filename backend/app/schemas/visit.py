import uuid
from datetime import date

from pydantic import BaseModel, field_validator

from app.models.enums import SwatchTypeEnum


class VisitLineIn(BaseModel):
    representative_contact_id: uuid.UUID
    fabric_code: str
    swatch_type: SwatchTypeEnum = SwatchTypeEnum.hanger
    qty: int = 1
    # Optional — captured right at visit-entry time (the Review step), before any follow-up mail
    # exists. Stored as an ItemFeedback row with no mail_response_id (see app/models/mail.py).
    sentiment: str | None = None
    feedback_text: str | None = None
    attachment_url: str | None = None

    @field_validator("qty")
    @classmethod
    def positive_qty(cls, v: int) -> int:
        if v <= 0:
            raise ValueError("Quantity must be at least 1")
        return v

    @field_validator("fabric_code")
    @classmethod
    def normalize(cls, v: str) -> str:
        return v.strip().upper()


class VisitCreate(BaseModel):
    customer_id: uuid.UUID
    date: date
    collections: str
    way_forward: str | None = None
    presented_by: list[uuid.UUID] = []
    attachments: list[str] = []
    attendee_contact_ids: list[uuid.UUID]
    lines: list[VisitLineIn]

    @field_validator("collections")
    @classmethod
    def purpose_required(cls, v: str) -> str:
        if not v or not v.strip():
            raise ValueError("Visit purpose is required")
        return v.strip()

    @field_validator("attendee_contact_ids")
    @classmethod
    def at_least_one_attendee(cls, v: list[uuid.UUID]) -> list[uuid.UUID]:
        if not v:
            raise ValueError("Add at least one attendee")
        if len(set(v)) != len(v):
            raise ValueError("The same attendee was added twice")
        return v

    @field_validator("lines")
    @classmethod
    def at_least_one_line(cls, v: list[VisitLineIn]) -> list[VisitLineIn]:
        if not v:
            raise ValueError("Add at least one swatch line")
        return v


class VisitImportRow(BaseModel):
    """One row of a bulk Visits CSV import — one row = one (attendee, fabric) pairing, same shape
    as VisitCreate.lines. Rows sharing the same customer_name + visit_date + collections are
    grouped into a single Visit when imported. This is for backfilling HISTORICAL visits — two
    things deliberately differ from live New Visit Entry (visits.py create_visit):
      - no blacklist gate runs against today's date — recording that a visit already happened is
        not the same as asking to issue new swatches right now;
      - no 5-mail follow-up schedule is generated — a backfilled old visit should never start
        firing real customer emails today.
    Both the customer and the named contact must already exist (imported company-first, since a
    flat visit row can't usefully create a brand-new company); the fabric must already exist and
    be active."""
    customer_name: str
    contact_name: str
    visit_date: date
    collections: str
    fabric_code: str
    swatch_type: SwatchTypeEnum = SwatchTypeEnum.hanger
    qty: int = 1
    way_forward: str | None = None

    @field_validator("qty")
    @classmethod
    def positive_qty(cls, v: int) -> int:
        if v <= 0:
            raise ValueError("Quantity must be at least 1")
        return v

    @field_validator("fabric_code")
    @classmethod
    def normalize_code(cls, v: str) -> str:
        return v.strip().upper()

    @field_validator("collections")
    @classmethod
    def purpose_required(cls, v: str) -> str:
        if not v or not v.strip():
            raise ValueError("Collection / purpose is required")
        return v.strip()


class VisitImportResult(BaseModel):
    created: int
    updated: int = 0  # always 0 — visits are additive-only on import, never matched/overwritten


class VisitEntryFeedbackOut(BaseModel):
    sentiment: str | None = None
    text: str | None = None
    attachment_url: str | None = None
    logged_by: str | None = None
    logged_at: str | None = None


class VisitItemOut(BaseModel):
    id: uuid.UUID
    fabric_id: uuid.UUID
    swatch_type: SwatchTypeEnum
    qty: int
    # Populated only by GET /visits/{id} (see visits.py get_visit) — the latest feedback logged
    # with no mail reply behind it, i.e. typed in directly at visit-entry time. None elsewhere.
    visit_entry_feedback: VisitEntryFeedbackOut | None = None

    model_config = {"from_attributes": True}


class VisitContactOut(BaseModel):
    id: uuid.UUID
    contact_id: uuid.UUID
    order_placed: bool
    order_date: date | None = None
    order_mail_number: int | None = None
    order_fabrics: list[str] | None = None
    closure_type: str | None
    closure_mail_number: int | None = None
    items: list[VisitItemOut] = []
    manual_order_date: date | None = None
    manual_order_fabrics: list[str] | None = None
    manual_order_after_mail: int | None = None
    manual_order_by: str | None = None
    manual_order_note: str | None = None

    model_config = {"from_attributes": True}


class RecordOrderIn(BaseModel):
    order_date: date
    fabric_codes: list[str]
    note: str | None = None

    @field_validator("fabric_codes")
    @classmethod
    def _normalize_and_require(cls, v: list[str]) -> list[str]:
        v = [code.strip().upper() for code in v]
        if not v:
            raise ValueError("Tick at least one fabric")
        return v


class UndoOrderIn(BaseModel):
    reason: str

    @field_validator("reason")
    @classmethod
    def _reason_required(cls, v: str) -> str:
        v = (v or "").strip()
        if not v:
            raise ValueError("A reason is required")
        return v


class VisitOut(BaseModel):
    id: uuid.UUID
    customer_id: uuid.UUID
    owner_id: uuid.UUID
    date: date
    collections: str | None
    way_forward: str | None
    notes: str | None = None
    presented_by: list[str] | None = None
    attachments: list[str] | None = None
    visit_contacts: list[VisitContactOut] = []

    model_config = {"from_attributes": True}
