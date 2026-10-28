import uuid
from datetime import datetime

from pydantic import BaseModel


class MailTemplateOut(BaseModel):
    mail_number: int
    variant: str | None
    subject: str
    body: str
    updated_by_user_id: uuid.UUID | None = None
    updated_at: datetime | None = None

    model_config = {"from_attributes": True}


class MailTemplateUpdate(BaseModel):
    subject: str
    body: str


class PlaceholderOut(BaseModel):
    key: str
    label: str
