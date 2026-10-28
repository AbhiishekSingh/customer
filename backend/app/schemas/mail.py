import uuid
from datetime import date, datetime

from pydantic import BaseModel

from app.models.enums import MailStatusEnum


class ItemFeedbackIn(BaseModel):
    visit_item_id: uuid.UUID
    sentiment: str | None = None
    text: str | None = None
    attachment_url: str | None = None


class SendNowIn(BaseModel):
    """Optional one-off override for this single send only — lets staff tweak the wording in the
    'review before sending' dialog without changing the saved template everyone else uses.
    Leaving both out sends exactly what the template renders, same as before."""
    subject: str | None = None
    body: str | None = None


class ManualResponseIn(BaseModel):
    data: dict = {}
    item_feedback: list[ItemFeedbackIn] = []
    by_name: str | None = None
    by_designation: str | None = None
    by_email: str | None = None
    submitted_at: datetime | None = None


class ItemFeedbackOut(BaseModel):
    id: uuid.UUID
    visit_item_id: uuid.UUID
    sentiment: str | None
    text: str | None
    attachment_url: str | None

    model_config = {"from_attributes": True}


class MailResponseOut(BaseModel):
    id: uuid.UUID
    submitted_at: datetime
    source: str
    raw_data: dict
    by_name: str | None
    by_designation: str | None
    by_email: str | None
    item_feedback: list[ItemFeedbackOut] = []

    model_config = {"from_attributes": True}


class MailOut(BaseModel):
    id: uuid.UUID
    visit_contact_id: uuid.UUID
    mail_number: int
    base_date: date
    due_date: date
    status: MailStatusEnum
    sent_at: date | None
    unreviewed: bool
    variant: str | None
    note: str | None
    # link-state fields (§7/§8 validation doc) — the frontend uses these to show "link not yet
    # opened", "a new link was sent", etc. without a separate call.
    has_token: bool = False
    first_opened_at: datetime | None = None
    link_expires_at: datetime | None = None  # computed: first_opened_at + settings.link_validity_days
    requested_new: bool = False
    request_resolved: bool = False
    responses: list[MailResponseOut] = []

    model_config = {"from_attributes": True}
