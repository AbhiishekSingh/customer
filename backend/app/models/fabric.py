from sqlalchemy import Enum, Numeric, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.models.base import Timestamped, UUIDPk
from app.models.enums import StatusEnum


class Fabric(Base, UUIDPk, Timestamped):
    __tablename__ = "fabrics"

    code: Mapped[str] = mapped_column(String(40), nullable=False, unique=True, index=True)  # stored upper-case
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    quality_category: Mapped[str] = mapped_column(String(100), nullable=False)  # references categories(type='fabric').name
    composition: Mapped[str | None] = mapped_column(String(200), nullable=True)
    gsm: Mapped[float | None] = mapped_column(Numeric(8, 2), nullable=True)
    status: Mapped[StatusEnum] = mapped_column(Enum(StatusEnum, name="status_enum"), default=StatusEnum.active, nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    colour_variants: Mapped[str | None] = mapped_column(String(300), nullable=True)
    supplier: Mapped[str | None] = mapped_column(String(200), nullable=True)
    photo_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
