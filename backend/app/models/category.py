import uuid
from datetime import date

from sqlalchemy import Date, Enum, ForeignKey, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.models.base import Timestamped, UUIDPk
from app.models.enums import StatusEnum


class Category(Base, UUIDPk, Timestamped):
    """Flat master lists, one row per (type, name). Never hard-deleted — only deactivated (status
    flag). Types in active use: 'fabric' (legacy D&D swatch category), 'customer', 'color', and —
    added for the Item Master rebuild — 'gender', 'season', 'story', 'supplier',
    'fabric_category' (Woven/Knit — distinct from the legacy 'fabric' type above), 'fabric_type',
    'print_type'. See app/routers/categories.py VALID_TYPES for the authoritative list."""
    __tablename__ = "categories"
    __table_args__ = (UniqueConstraint("type", "name", name="uq_category_type_name"),)

    type: Mapped[str] = mapped_column(String(20), nullable=False)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    status: Mapped[StatusEnum] = mapped_column(Enum(StatusEnum, name="status_enum"), default=StatusEnum.active, nullable=False)
    # Optional From/To date range — only meaningful for type='season' (e.g. "AW 27-28" ~ Jul-Dec);
    # left NULL for every other category type. Kept on the shared Category row rather than a
    # separate table since it's a single optional pair of fields used by exactly one type, and the
    # generic list/create/toggle endpoints already work for every type without change.
    date_from: Mapped["date | None"] = mapped_column(Date, nullable=True)
    date_to: Mapped["date | None"] = mapped_column(Date, nullable=True)


class Country(Base, UUIDPk, Timestamped):
    __tablename__ = "countries"

    name: Mapped[str] = mapped_column(String(100), nullable=False, unique=True)
    status: Mapped[StatusEnum] = mapped_column(Enum(StatusEnum, name="status_enum"), default=StatusEnum.active, nullable=False)

    states: Mapped[list["State"]] = relationship(back_populates="country", cascade="all, delete-orphan")


class State(Base, UUIDPk, Timestamped):
    """Nested under exactly one country for its lifetime — a state never changes parent country
    (§4 of the validation doc). Unique per-country, not globally."""
    __tablename__ = "states"
    __table_args__ = (UniqueConstraint("country_id", "name", name="uq_state_country_name"),)

    country_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("countries.id"), nullable=False)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    status: Mapped[StatusEnum] = mapped_column(Enum(StatusEnum, name="status_enum"), default=StatusEnum.active, nullable=False)

    country: Mapped["Country"] = relationship(back_populates="states")
