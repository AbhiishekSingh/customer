import uuid
from datetime import datetime

from pydantic import BaseModel


class NotificationOut(BaseModel):
    id: uuid.UUID
    text: str
    link: str | None
    read: bool
    created_at: datetime

    model_config = {"from_attributes": True}
