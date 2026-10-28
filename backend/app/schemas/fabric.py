import uuid

from pydantic import BaseModel, field_validator

from app.models.enums import StatusEnum


class FabricCreate(BaseModel):
    code: str
    name: str
    quality_category: str
    composition: str | None = None
    gsm: float | None = None
    description: str | None = None
    colour_variants: str | None = None
    supplier: str | None = None
    photo_url: str | None = None

    @field_validator("code")
    @classmethod
    def normalize_code(cls, v: str) -> str:
        v = v.strip().upper()
        if not v:
            raise ValueError("Code is required")
        return v

    @field_validator("name", "quality_category")
    @classmethod
    def not_blank(cls, v: str) -> str:
        if not v or not v.strip():
            raise ValueError("Required")
        return v.strip()


class FabricUpdate(BaseModel):
    name: str | None = None
    quality_category: str | None = None
    composition: str | None = None
    gsm: float | None = None
    status: StatusEnum | None = None
    description: str | None = None
    colour_variants: str | None = None
    supplier: str | None = None
    photo_url: str | None = None


class FabricOut(BaseModel):
    id: uuid.UUID
    code: str
    name: str
    quality_category: str
    composition: str | None
    gsm: float | None
    status: StatusEnum
    description: str | None
    colour_variants: str | None
    supplier: str | None
    photo_url: str | None
    used_count: int = 0

    model_config = {"from_attributes": True}


class FabricImportRow(BaseModel):
    code: str
    name: str
    quality_category: str
    composition: str | None = None
    gsm: float | None = None


class FabricImportResult(BaseModel):
    created: int
    updated: int
