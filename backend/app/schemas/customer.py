import re
import uuid

from pydantic import BaseModel, EmailStr, field_validator

from app.models.enums import StatusEnum

PHONE_RE = re.compile(r"^[0-9+\-() ]+$")
PINCODE_RE = re.compile(r"^\d{6}$")


def _check_phone(v: str | None) -> str | None:
    if v is None or not v.strip():
        return v
    v = v.strip()
    if not PHONE_RE.match(v) or not any(ch.isdigit() for ch in v):
        raise ValueError("Phone number can only contain digits, spaces, +, -, ( and )")
    return v


def _check_pincode(v: str | None) -> str | None:
    if v is None or not v.strip():
        return v
    v = v.strip()
    if not PINCODE_RE.match(v):
        raise ValueError("Pincode must be exactly 6 digits")
    return v


class ContactIn(BaseModel):
    id: uuid.UUID | None = None  # present when updating an existing contact
    team_name: str  # resolved to a team on save; new team name auto-creates it
    name: str
    designation: str | None = None
    email: EmailStr | None = None
    phone: str | None = None
    primary: bool = False
    senior: bool = False
    address_line1: str | None = None
    address_line2: str | None = None
    city: str | None = None
    state: str | None = None
    country: str | None = None
    pincode: str | None = None

    @field_validator("name")
    @classmethod
    def name_required(cls, v: str) -> str:
        if not v or not v.strip():
            raise ValueError("Contact name is required")
        return v.strip()

    @field_validator("phone")
    @classmethod
    def phone_valid(cls, v: str | None) -> str | None:
        return _check_phone(v)

    @field_validator("pincode")
    @classmethod
    def pincode_valid(cls, v: str | None) -> str | None:
        return _check_pincode(v)


class CustomerCreate(BaseModel):
    name: str
    category: str | None = None
    city: str | None = None
    state: str | None = None
    country: str | None = None
    company_address: str | None = None
    address_line1: str | None = None
    address_line2: str | None = None
    pincode: str | None = None
    company_email: EmailStr | None = None
    company_phone: str | None = None
    owner_id: uuid.UUID
    contacts: list[ContactIn]

    @field_validator("name")
    @classmethod
    def name_required(cls, v: str) -> str:
        if not v or not v.strip():
            raise ValueError("Name is required")
        return v.strip()

    @field_validator("contacts")
    @classmethod
    def at_least_one_with_email(cls, v: list[ContactIn]) -> list[ContactIn]:
        if not v:
            raise ValueError("Add at least one contact")
        if not any(c.email for c in v):
            raise ValueError("Add at least one contact with an email")
        primaries = [c for c in v if c.primary]
        if len(primaries) > 1:
            raise ValueError("Only one contact can be marked primary")
        return v

    @field_validator("company_phone")
    @classmethod
    def company_phone_valid(cls, v: str | None) -> str | None:
        return _check_phone(v)

    @field_validator("pincode")
    @classmethod
    def pincode_valid(cls, v: str | None) -> str | None:
        return _check_pincode(v)


class CustomerUpdate(BaseModel):
    name: str | None = None
    category: str | None = None
    city: str | None = None
    state: str | None = None
    country: str | None = None
    company_address: str | None = None
    address_line1: str | None = None
    address_line2: str | None = None
    pincode: str | None = None
    company_email: EmailStr | None = None
    company_phone: str | None = None
    marketing_only: bool | None = None
    notes: str | None = None
    owner_id: uuid.UUID | None = None

    @field_validator("company_phone")
    @classmethod
    def company_phone_valid(cls, v: str | None) -> str | None:
        return _check_phone(v)

    @field_validator("pincode")
    @classmethod
    def pincode_valid(cls, v: str | None) -> str | None:
        return _check_pincode(v)


class ContactOut(BaseModel):
    id: uuid.UUID
    team_id: uuid.UUID | None
    name: str
    designation: str | None
    email: str | None
    phone: str | None
    primary: bool
    senior: bool
    status: StatusEnum
    address_line1: str | None
    address_line2: str | None
    city: str | None
    state: str | None
    country: str | None
    pincode: str | None

    model_config = {"from_attributes": True}


class TeamOut(BaseModel):
    id: uuid.UUID
    name: str

    model_config = {"from_attributes": True}


class CustomerImportRow(BaseModel):
    """One row of a bulk Customers CSV import (company-level only — contacts are added afterward
    from the Customer page, since a flat CSV row can't cleanly carry a nested contact list)."""
    name: str
    category: str | None = None
    city: str | None = None
    country: str | None = None
    company_address: str | None = None
    owner_email: str  # resolved to a user id on import


class CustomerImportResult(BaseModel):
    created: int
    updated: int


class CustomerOut(BaseModel):
    id: uuid.UUID
    name: str
    category: str | None
    city: str | None
    state: str | None = None
    country: str | None
    company_address: str | None
    address_line1: str | None = None
    address_line2: str | None = None
    pincode: str | None = None
    company_email: str | None = None
    company_phone: str | None = None
    owner_id: uuid.UUID
    blacklist_cat: str | None
    marketing_only: bool
    notes: str | None
    teams: list[TeamOut] = []
    contacts: list[ContactOut] = []

    model_config = {"from_attributes": True}
