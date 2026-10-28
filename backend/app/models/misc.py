import uuid
from datetime import date

from sqlalchemy import Boolean, Date, Enum, ForeignKey, String, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.models.base import Timestamped, UUIDPk
from app.models.enums import MailStatusEnum


class Outbox(Base, UUIDPk, Timestamped):
    """Full log of every mail sent/attempted — §9 of the workflow doc."""
    __tablename__ = "outbox"

    mail_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("mails.id"), nullable=True)
    to_email: Mapped[str] = mapped_column(String(254), nullable=False)
    cc: Mapped[str | None] = mapped_column(String(500), nullable=True)
    subject: Mapped[str] = mapped_column(String(300), nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[MailStatusEnum] = mapped_column(Enum(MailStatusEnum, name="mail_status_enum"), default=MailStatusEnum.sent, nullable=False)
    sent_at: Mapped[date | None] = mapped_column(Date, nullable=True)
    customer_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("customers.id"), nullable=True)


class Notification(Base, UUIDPk, Timestamped):
    __tablename__ = "notifications"

    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False, index=True)
    text: Mapped[str] = mapped_column(String(500), nullable=False)
    link: Mapped[str | None] = mapped_column(String(300), nullable=True)
    read: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)


class AuditLog(Base, UUIDPk, Timestamped):
    """Append-only — §10 of the validation doc: no API should ever expose update/delete on this table."""
    __tablename__ = "audit_log"

    user_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    action: Mapped[str] = mapped_column(String(200), nullable=False)
    entity_type: Mapped[str | None] = mapped_column(String(100), nullable=True)
    entity_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    detail: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)


class SystemSettings(Base, UUIDPk, Timestamped):
    """Single-row config table — §11 of the validation doc. The app only ever reads/writes the one row."""
    __tablename__ = "settings"

    data: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
