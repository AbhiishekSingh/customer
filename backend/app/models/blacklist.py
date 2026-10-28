import uuid
from datetime import date

from sqlalchemy import Boolean, Date, Enum, ForeignKey, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.models.base import Timestamped, UUIDPk
from app.models.enums import ApprovalParentEnum, ApprovalStatusEnum, BlacklistCatEnum


class BlacklistEvent(Base, UUIDPk, Timestamped):
    """A proposal to flag (or that already flagged) a customer Blacklist A/B/C."""
    __tablename__ = "blacklist_events"

    customer_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("customers.id"), nullable=False)
    cat: Mapped[BlacklistCatEnum] = mapped_column(Enum(BlacklistCatEnum, name="blacklist_cat_enum"), nullable=False)
    status: Mapped[ApprovalStatusEnum] = mapped_column(Enum(ApprovalStatusEnum, name="approval_status_enum"), default=ApprovalStatusEnum.pending, nullable=False)
    reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    # evidence signature (cat + the visit_contact_ids it was raised from) — lets the auto-evaluator
    # recognise "Top Management already said no to this exact evidence" and not re-raise it
    # (prototype's c.proposal.sig). Null for a staff-raised suggestion (task 42's manual path).
    sig: Mapped[str | None] = mapped_column(String(300), nullable=True)
    auto_raised: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    # Approvals for this event are looked up by (parent_type='blacklist_event', parent_id=this.id) —
    # a plain query in the service layer, not an ORM relationship (parent_id is a polymorphic FK
    # across two tables, which SQLAlchemy can't express cleanly as a declarative relationship).


class Exception_(Base, UUIDPk, Timestamped):
    """A request to give swatches to a Blacklist-C customer anyway. Single-use once approved
    (§6 of the validation doc — confirm scope with Urvish before relying on 'usedOn' semantics)."""
    __tablename__ = "exceptions"

    customer_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("customers.id"), nullable=False)
    requested_by: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    reason: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[ApprovalStatusEnum] = mapped_column(Enum(ApprovalStatusEnum, name="approval_status_enum"), default=ApprovalStatusEnum.pending, nullable=False)
    valid_till: Mapped[date | None] = mapped_column(Date, nullable=True)
    used_on_visit_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("visits.id"), nullable=True)


class Approval(Base, UUIDPk, Timestamped):
    """One Top Management member's decision on a blacklist_event or exception.
    Unanimous 'yes' from every CURRENT top-role user is required to approve; a single
    'no' immediately rejects (asymmetric by design — never make this a majority vote)."""
    __tablename__ = "approvals"

    parent_type: Mapped[ApprovalParentEnum] = mapped_column(Enum(ApprovalParentEnum, name="approval_parent_enum"), nullable=False)
    parent_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False, index=True)
    approver_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    decision: Mapped[bool] = mapped_column(nullable=False)  # True = yes/approve, False = no/reject
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
