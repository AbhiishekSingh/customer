import uuid
from datetime import date

from pydantic import BaseModel

from app.models.enums import StatusEnum


class CategoryCreate(BaseModel):
    type: str  # see app/routers/categories.py VALID_TYPES
    name: str


class CategoryDatesIn(BaseModel):
    """Set/clear the optional From/To date range on a category row — only meaningful for
    type='season' categories, but not restricted at the schema level (same reasoning as the rest
    of this generic mechanism: the type check lives in the router, not duplicated per-field)."""
    date_from: "date | None" = None
    date_to: "date | None" = None


class CategoryOut(BaseModel):
    id: uuid.UUID
    type: str
    name: str
    status: StatusEnum
    date_from: "date | None" = None
    date_to: "date | None" = None

    model_config = {"from_attributes": True}


class CountryCreate(BaseModel):
    name: str


class StateCreate(BaseModel):
    name: str


class StateOut(BaseModel):
    id: uuid.UUID
    name: str
    status: StatusEnum

    model_config = {"from_attributes": True}


class CountryOut(BaseModel):
    id: uuid.UUID
    name: str
    status: StatusEnum
    states: list[StateOut] = []

    model_config = {"from_attributes": True}
