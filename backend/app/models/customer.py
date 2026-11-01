import uuid
from datetime import date

from sqlalchemy import Boolean, Enum, ForeignKey, Index, Sequence, String, Text, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.models.base import Timestamped, UUIDPk
from app.models.enums import BlacklistCatEnum, StatusEnum

# Bound to Base.metadata (not just referenced by raw SQL) so Base.metadata.create_all() — what
# every seed script and the test suite use to stand up a brand-new database — creates this
# sequence automatically along with the tables. scripts/migrate_customer_code.py's own
# `CREATE SEQUENCE IF NOT EXISTS` still runs safely on an ALREADY-existing production database
# (where create_all() only adds what's missing and never touches the existing customers table) —
# the two are complementary, not redundant: this covers "set up a database from zero", the
# migration script covers "add this to a database that already has customers in it".
customer_code_seq = Sequence("customer_code_seq", start=1, metadata=Base.metadata)


def _next_customer_code(context) -> str:
    """Column-level default so ANY insert path (the API, a seed/migration script, a test building
    a Customer() directly) gets a unique code for free, without every caller having to remember to
    set one. `context.connection` is the exact connection the INSERT is about to run on — reusing
    it keeps this inside whatever transaction is already open instead of opening a second one."""
    n = context.connection.execute(text("SELECT nextval('customer_code_seq')")).scalar()
    return f"CUST-{n:04d}"


class Customer(Base, UUIDPk, Timestamped):
    __tablename__ = "customers"

    # Human-facing unique identifier (e.g. "CUST-0001"), distinct from the internal UUID `id`.
    # Guarantees every customer record has a stable, visibly-unique identity even when two
    # companies share a similar or identical name. See scripts/migrate_customer_code.py for the
    # backfill on existing rows and the customer_code_seq sequence this draws from.
    customer_code: Mapped[str] = mapped_column(String(20), nullable=False, unique=True, index=True, default=_next_customer_code)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    category: Mapped[str | None] = mapped_column(String(100), nullable=True)  # categories(type='customer').name
    city: Mapped[str | None] = mapped_column(String(100), nullable=True)
    state: Mapped[str | None] = mapped_column(String(100), nullable=True)
    country: Mapped[str | None] = mapped_column(String(100), nullable=True)
    company_address: Mapped[str | None] = mapped_column(Text, nullable=True)
    address_line1: Mapped[str | None] = mapped_column(String(300), nullable=True)
    address_line2: Mapped[str | None] = mapped_column(String(300), nullable=True)
    pincode: Mapped[str | None] = mapped_column(String(20), nullable=True)
    company_email: Mapped[str | None] = mapped_column(String(254), nullable=True)
    company_phone: Mapped[str | None] = mapped_column(String(40), nullable=True)
    owner_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)

    # blacklist (denormalized current-state flag; history lives in blacklist_events)
    blacklist_cat: Mapped[BlacklistCatEnum | None] = mapped_column(Enum(BlacklistCatEnum, name="blacklist_cat_enum"), nullable=True)
    # visits on/before this date are never re-evaluated for auto-blacklisting — set to "today" on
    # every clear so the same old evidence can't immediately re-trigger the rule that was just
    # cleared (prototype's c.whitelistAfter).
    whitelist_after: Mapped[date | None] = mapped_column(nullable=True)
    marketing_only: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    teams: Mapped[list["Team"]] = relationship(back_populates="customer", cascade="all, delete-orphan")
    contacts: Mapped[list["Contact"]] = relationship(back_populates="customer", cascade="all, delete-orphan")


class Team(Base, UUIDPk, Timestamped):
    __tablename__ = "teams"

    customer_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("customers.id"), nullable=False)
    name: Mapped[str] = mapped_column(String(150), nullable=False)

    customer: Mapped["Customer"] = relationship(back_populates="teams")


class Contact(Base, UUIDPk, Timestamped):
    __tablename__ = "contacts"
    __table_args__ = (
        # exactly one primary contact per customer (§2 of the validation doc) — enforced at the DB
        # level, not just in application code, via a partial unique index.
        Index(
            "uq_contact_primary_per_customer",
            "customer_id",
            unique=True,
            postgresql_where=text('"primary" = true'),
        ),
    )

    customer_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("customers.id"), nullable=False)
    team_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("teams.id"), nullable=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    designation: Mapped[str | None] = mapped_column(String(150), nullable=True)
    email: Mapped[str | None] = mapped_column(String(254), nullable=True)
    phone: Mapped[str | None] = mapped_column(String(40), nullable=True)
    primary: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    senior: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    status: Mapped[StatusEnum] = mapped_column(Enum(StatusEnum, name="status_enum"), default=StatusEnum.active, nullable=False)

    # per-contact address (shared addrFields component in the prototype)
    address_line1: Mapped[str | None] = mapped_column(String(300), nullable=True)
    address_line2: Mapped[str | None] = mapped_column(String(300), nullable=True)
    city: Mapped[str | None] = mapped_column(String(100), nullable=True)
    state: Mapped[str | None] = mapped_column(String(100), nullable=True)
    country: Mapped[str | None] = mapped_column(String(100), nullable=True)
    pincode: Mapped[str | None] = mapped_column(String(20), nullable=True)

    customer: Mapped["Customer"] = relationship(back_populates="contacts")
