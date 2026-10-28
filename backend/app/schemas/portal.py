import uuid

from pydantic import BaseModel, Field


class PortalItemFeedbackIn(BaseModel):
    visit_item_id: uuid.UUID
    sentiment: str | None = None
    text: str | None = None
    attachment_url: str | None = None


class PortalRespondIn(BaseModel):
    by_name: str = Field(default="")
    by_designation: str = Field(default="")
    by_email: str | None = None
    data: dict = {}
    item_feedback: list[PortalItemFeedbackIn] = []
