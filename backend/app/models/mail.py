import uuid
from datetime import date, datetime

from sqlalchemy import Boolean, Date, DateTime, Enum, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.models.base import Timestamped, UUIDPk
from app.models.enums import MailStatusEnum, ResponseSourceEnum


class Mail(Base, UUIDPk, Timestamped):
    __tablename__ = "mails"

    visit_contact_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("visit_contacts.id"), nullable=False)
    mail_number: Mapped[int] = mapped_column(Integer, nullable=False)  # 1..5
    base_date: Mapped[date] = mapped_column(Date, nullable=False)  # computed, before working-day roll-forward
    due_date: Mapped[date] = mapped_column(Date, nullable=False)  # base_date rolled to next working day
    status: Mapped[MailStatusEnum] = mapped_column(Enum(MailStatusEnum, name="mail_status_enum"), default=MailStatusEnum.scheduled, nullable=False)
    sent_at: Mapped[date | None] = mapped_column(Date, nullable=True)
    pinned: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)  # mail 5 pinned to order_date+N once an order lands
    auto_skip: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)  # skipped automatically (order/closure/all-items-done) vs skipped for Blacklist C
    variant: Mapped[str | None] = mapped_column(String(20), nullable=True)  # mail 5 only: 'ordered' | 'notordered'
    note: Mapped[str | None] = mapped_column(String(300), nullable=True)

    # public portal token — see §7/§8 of the validation doc for the expiry-from-first-open rule
    token: Mapped[str | None] = mapped_column(String(64), nullable=True, unique=True, index=True)
    first_opened_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    requested_new: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    request_resolved: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    # true once this visit-contact's items were skipped due to Blacklist C at send time
    c_skip: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    unreviewed: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    visit_contact: Mapped["VisitContact"] = relationship(back_populates="mails")
    responses: Mapped[list["MailResponse"]] = relationship(back_populates="mail", cascade="all, delete-orphan", order_by="MailResponse.submitted_at")

    @property
    def has_token(self) -> bool:
        """Read-only convenience for MailOut — true once a live portal link exists."""
        return bool(self.token)


class PastMailToken(Base, UUIDPk, Timestamped):
    """Every token a mail has ever had, once superseded (§7/§8 validation doc). Mail.token only
    ever holds the CURRENT live token — overwriting it on resend would otherwise make an old,
    already-emailed link look like it was never recognised rather than correctly explained as
    superseded ('a newer link was sent')."""
    __tablename__ = "past_mail_tokens"

    mail_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("mails.id"), nullable=False)
    token: Mapped[str] = mapped_column(String(64), nullable=False, unique=True, index=True)


class MailResponse(Base, UUIDPk, Timestamped):
    __tablename__ = "mail_responses"

    mail_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("mails.id"), nullable=False)
    submitted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    source: Mapped[ResponseSourceEnum] = mapped_column(Enum(ResponseSourceEnum, name="response_source_enum"), nullable=False)
    raw_data: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    by_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    by_designation: Mapped[str | None] = mapped_column(String(150), nullable=True)
    by_email: Mapped[str | None] = mapped_column(String(254), nullable=True)

    mail: Mapped["Mail"] = relationship(back_populates="responses")
    item_feedback: Mapped[list["ItemFeedback"]] = relationship(back_populates="mail_response", cascade="all, delete-orphan")


class ItemFeedback(Base, UUIDPk, Timestamped):
    """Feedback on one swatch/item. Two sources share this one table (deliberately — so every
    screen that shows "feedback on this item" sees both without having to merge two tables):
      - a reply to a follow-up mail (mail_response_id set, source = that MailResponse's own
        'portal'/'manual'; logged_by_user_id is None since the customer, not a staff user, gave it);
      - a note the Design Team typed in directly while logging the visit itself, before any mail
        has gone out (mail_response_id is NULL; logged_by_user_id is the staff user who typed it).
    logged_at is the one unified timestamp to sort/pick 'latest feedback' by, regardless of source —
    it mirrors MailResponse.submitted_at for the first kind, and is 'now' for the second."""
    __tablename__ = "item_feedback"

    mail_response_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("mail_responses.id"), nullable=True)
    visit_item_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("visit_items.id"), nullable=False)
    sentiment: Mapped[str | None] = mapped_column(String(20), nullable=True)  # Positive/Negative/Neutral etc.
    text: Mapped[str | None] = mapped_column(Text, nullable=True)
    attachment_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    logged_by_user_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    logged_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    mail_response: Mapped["MailResponse | None"] = relationship(back_populates="item_feedback")


class MailTemplate(Base, UUIDPk, Timestamped):
    """Editable subject/body for one of the 6 outgoing mail variants (Mail 1-4, plus Mail 5
    'ordered' and Mail 5 'notordered' as two separate templates). Replaces what used to be
    hardcoded strings in mail_subject_intro()/send_mail() — see app/services/mail_templates.py
    for the placeholder-substitution and the seeded defaults (identical wording to what was
    previously hardcoded, so installing this changes nothing until someone actually edits one)."""
    __tablename__ = "mail_templates"

    mail_number: Mapped[int] = mapped_column(Integer, nullable=False)  # 1..5
    variant: Mapped[str | None] = mapped_column(String(20), nullable=True)  # mail 5 only: 'ordered' | 'notordered'
    subject: Mapped[str] = mapped_column(String(300), nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    updated_by_user_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
