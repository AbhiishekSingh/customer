import uuid
from datetime import date

from sqlalchemy import Date, Enum, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.models.base import Timestamped, UUIDPk
from app.models.enums import SwatchTypeEnum


class Visit(Base, UUIDPk, Timestamped):
    __tablename__ = "visits"

    customer_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("customers.id"), nullable=False)
    owner_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    date: Mapped[date] = mapped_column(Date, nullable=False)
    collections: Mapped[str | None] = mapped_column(Text, nullable=True)
    way_forward: Mapped[str | None] = mapped_column(Text, nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    # who presented in person (distinct from owner_id, who merely logged the visit record) —
    # stored as a JSON list of user-id strings since a visit can have several presenters.
    presented_by: Mapped[list | None] = mapped_column(JSONB, nullable=True)
    # pre-visit reference material — pasted links, same convention as ItemFeedback.attachment_url
    # elsewhere in this schema (there's no file-upload service in this backend, only URL fields).
    attachments: Mapped[list | None] = mapped_column(JSONB, nullable=True)

    visit_contacts: Mapped[list["VisitContact"]] = relationship(back_populates="visit", cascade="all, delete-orphan")


class VisitContact(Base, UUIDPk, Timestamped):
    """One row per attendee of a visit — this is the unit the 5-mail follow-up schedule hangs off.
    (This matches the prototype's per-attendee 'visit' object, which this schema calls Visit+VisitContact
    to avoid the prototype's overloaded 'visit'/'presentation' naming.)"""
    __tablename__ = "visit_contacts"

    visit_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("visits.id"), nullable=False)
    contact_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("contacts.id"), nullable=False)

    # derived outcome state (prototype's deriveOutcome) — order/closure, always taken from the
    # LATEST response on any mail, since customers may edit their answer.
    order_placed: Mapped[bool] = mapped_column(default=False, nullable=False)
    order_date: Mapped["date | None"] = mapped_column(nullable=True)
    order_mail_number: Mapped[int | None] = mapped_column(nullable=True)
    order_fabrics: Mapped[list | None] = mapped_column(JSONB, nullable=True)
    closure_type: Mapped[str | None] = mapped_column(String(30), nullable=True)  # 'not_proceeding'
    closure_mail_number: Mapped[int | None] = mapped_column(nullable=True)

    # staff-recorded order from a phone call / in-person confirmation, ahead of any mail reply
    # (prototype's v.manualOrder — App.recordOrder/undoOrder in actions.js). Takes priority over
    # an order derived from mail responses; cleared entirely by "undo", never partially.
    manual_order_date: Mapped["date | None"] = mapped_column(nullable=True)
    manual_order_fabrics: Mapped[list | None] = mapped_column(JSONB, nullable=True)
    manual_order_after_mail: Mapped[int | None] = mapped_column(nullable=True)
    manual_order_by: Mapped[str | None] = mapped_column(String(200), nullable=True)
    manual_order_note: Mapped[str | None] = mapped_column(String(300), nullable=True)

    visit: Mapped["Visit"] = relationship(back_populates="visit_contacts")
    items: Mapped[list["VisitItem"]] = relationship(back_populates="visit_contact", cascade="all, delete-orphan")
    mails: Mapped[list["Mail"]] = relationship(back_populates="visit_contact", cascade="all, delete-orphan")


class VisitItem(Base, UUIDPk, Timestamped):
    __tablename__ = "visit_items"

    visit_contact_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("visit_contacts.id"), nullable=False)
    fabric_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("fabrics.id"), nullable=False)
    swatch_type: Mapped[SwatchTypeEnum] = mapped_column(Enum(SwatchTypeEnum, name="swatch_type_enum"), default=SwatchTypeEnum.hanger, nullable=False)
    qty: Mapped[int] = mapped_column(Integer, default=1, nullable=False)

    visit_contact: Mapped["VisitContact"] = relationship(back_populates="items")
