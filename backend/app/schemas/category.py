import uuid

from pydantic import BaseModel

from app.models.enums import StatusEnum


class CategoryCreate(BaseModel):
    type: str  # 'fabric' | 'customer'
    name: str


class CategoryOut(BaseModel):
    id: uuid.UUID
    type: str
    name: str
    status: StatusEnum

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
