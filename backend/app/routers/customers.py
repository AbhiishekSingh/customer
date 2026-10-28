import uuid

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.core.database import get_db
from app.core.deps import get_current_user, require_any, require_manager_up
from app.core.errors import conflict, not_found, validation_error
from app.models.category import Category, Country, State
from app.models.customer import Contact, Customer, Team
from app.models.mail import Mail
from app.models.user import User
from app.models.visit import VisitContact
from app.schemas.customer import ContactIn, CustomerCreate, CustomerImportResult, CustomerImportRow, CustomerOut, CustomerUpdate
from app.services.audit import audit
from app.services.reports import engagement

router = APIRouter(prefix="/customers", tags=["customers"])


def _visible_query(user: User):
    q = select(Customer).options(selectinload(Customer.teams), selectinload(Customer.contacts))
    if user.role.value == "design":
        q = q.where(Customer.owner_id == user.id)  # §0 of the validation doc: ownership filter server-side, always
    return q


def _get_visible(db: Session, user: User, customer_id: uuid.UUID) -> Customer:
    customer = db.scalar(_visible_query(user).where(Customer.id == customer_id))
    if not customer:
        raise not_found("Customer not found")  # never distinguish "doesn't exist" vs "not yours"
    return customer


def _validate_country_state(db: Session, country_name: str | None, state_name: str | None) -> None:
    if country_name:
        country = db.scalar(select(Country).where(Country.name == country_name, Country.status == "active"))
        if not country:
            raise validation_error(f"Unknown or inactive country '{country_name}'")
        if state_name:
            state = db.scalar(select(State).where(State.country_id == country.id, State.name == state_name))
            if not state:
                raise validation_error(f"'{state_name}' is not a state/province of {country_name}")
    elif state_name:
        raise validation_error("Pick a country before a state")


def _apply_contacts(db: Session, customer: Customer, contacts_in: list[ContactIn]) -> None:
    teams_by_name = {t.name: t for t in customer.teams}
    for c in contacts_in:
        _validate_country_state(db, c.country, c.state)
        team = teams_by_name.get(c.team_name)
        if not team:
            team = Team(customer_id=customer.id, name=c.team_name)
            db.add(team)
            db.flush()
            teams_by_name[c.team_name] = team
        contact = db.get(Contact, c.id) if c.id else None
        if contact and contact.customer_id != customer.id:
            raise validation_error("Contact does not belong to this customer")
        if not contact:
            contact = Contact(customer_id=customer.id)
            db.add(contact)
        contact.team_id = team.id
        contact.name = c.name
        contact.designation = c.designation
        contact.email = c.email
        contact.phone = c.phone
        contact.primary = c.primary
        contact.senior = c.senior
        contact.address_line1 = c.address_line1
        contact.address_line2 = c.address_line2
        contact.city = c.city
        contact.state = c.state
        contact.country = c.country
        contact.pincode = c.pincode


@router.get("", response_model=list[CustomerOut])
def list_customers(db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> list[Customer]:
    return db.scalars(_visible_query(user).order_by(Customer.name)).all()


@router.get("/summary/list")
def list_customers_summary(db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> list[dict]:
    """Per-customer health stats for the Customers list screen (prototype's Owner/Engagement/Reply
    rate/Visits/Orders/Status columns) in one call, instead of the frontend calling
    GET /customers/{id}/engagement once per row."""
    from datetime import date as _date
    from app.models.visit import Visit
    from app.services.reports import engagement as _engagement

    customers = db.scalars(_visible_query(user).order_by(Customer.name)).all()
    today = _date.today()
    out = []
    for c in customers:
        e = _engagement(db, c, today)
        visits_count = len(db.scalars(select(Visit.id).where(Visit.customer_id == c.id)).all())
        out.append({
            "id": str(c.id),
            "owner_id": str(c.owner_id),
            "tag": e["tag"],
            "rate": e["rate"],
            "sent": e["sent"],
            "resp": e["resp"],
            "orders": e["orders"],
            "repeat": e["repeat"],
            "visits": visits_count,
            "status": ("Blacklisted " + c.blacklist_cat.value) if c.blacklist_cat else ("Marketing only" if c.marketing_only else "Active"),
        })
    return out


@router.post("/import", response_model=CustomerImportResult)
def import_customers(rows: list[CustomerImportRow], db: Session = Depends(get_db), user: User = Depends(require_manager_up)) -> CustomerImportResult:
    """All-or-nothing bulk import, company-level only (no contacts — add those afterward from the
    Customer page). Upserts by company name, same validate-everything-first pattern as
    POST /fabrics/import."""
    errors: list[str] = []
    seen_names: set[str] = set()
    owner_by_email: dict[str, User] = {}
    for i, row in enumerate(rows, start=1):
        name = row.name.strip()
        if not name:
            errors.append(f"Row {i}: company name is required")
            continue
        key = name.lower()
        if key in seen_names:
            errors.append(f"Row {i}: duplicate company '{name}' within this import")
        seen_names.add(key)
        email = (row.owner_email or "").strip().lower()
        if not email:
            errors.append(f"Row {i}: owner_email is required for '{name}'")
            continue
        if email not in owner_by_email:
            owner = db.scalar(select(User).where(User.email == email))
            if owner:
                owner_by_email[email] = owner
        if email not in owner_by_email:
            errors.append(f"Row {i}: no user found with email '{row.owner_email}' for '{name}'")
    if errors:
        raise validation_error("Fix these rows and re-import — nothing was saved.", fields={"rows": errors})

    created = updated = 0
    for row in rows:
        name = row.name.strip()
        owner = owner_by_email[row.owner_email.strip().lower()]
        existing = db.scalar(select(Customer).where(Customer.name.ilike(name)))
        if existing:
            existing.category = row.category
            existing.city = row.city
            existing.country = row.country
            existing.company_address = row.company_address
            existing.owner_id = owner.id
            updated += 1
        else:
            db.add(Customer(
                name=name, category=row.category, city=row.city, country=row.country,
                company_address=row.company_address, owner_id=owner.id,
            ))
            created += 1
    audit(db, user_id=user.id, action="import_customers", entity_type="customer", detail={"created": created, "updated": updated})
    db.commit()
    return CustomerImportResult(created=created, updated=updated)


@router.get("/{customer_id}", response_model=CustomerOut)
def get_customer(customer_id: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> Customer:
    return _get_visible(db, user, customer_id)


@router.get("/{customer_id}/engagement")
def get_customer_engagement(customer_id: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> dict:
    """Hot/Warm/Cold/Non-responsive/New tag + season-over-season trend — app/services/reports.py's
    engagement(), exposed per-customer for the Customer detail page (prototype's custHeaderAlert/tagPill)."""
    from datetime import date as _date
    customer = _get_visible(db, user, customer_id)
    return engagement(db, customer, _date.today())


@router.post("", response_model=CustomerOut, status_code=201)
def create_customer(payload: CustomerCreate, force: bool = False, db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> Customer:
    if payload.category:
        if not db.scalar(select(Category).where(Category.type == "customer", Category.name == payload.category, Category.status == "active")):
            raise validation_error(f"Unknown or inactive customer category '{payload.category}'")
    _validate_country_state(db, payload.country, payload.state)

    existing = db.scalar(select(Customer).where(Customer.name == payload.name, Customer.country == payload.country))
    if existing and not force:
        raise conflict(f"A customer named '{payload.name}' in {payload.country or 'the same country'} already exists — resend with force=true to create anyway")

    customer = Customer(
        name=payload.name, category=payload.category, city=payload.city, state=payload.state, country=payload.country,
        company_address=payload.company_address, address_line1=payload.address_line1, address_line2=payload.address_line2,
        pincode=payload.pincode, company_email=payload.company_email, company_phone=payload.company_phone,
        owner_id=payload.owner_id,
    )
    db.add(customer)
    db.flush()
    _apply_contacts(db, customer, payload.contacts)
    audit(db, user_id=user.id, action="create_customer", entity_type="customer", entity_id=customer.id, detail={"name": customer.name})
    db.commit()
    db.refresh(customer)
    return customer


@router.patch("/{customer_id}", response_model=CustomerOut)
def update_customer(customer_id: uuid.UUID, payload: CustomerUpdate, db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> Customer:
    customer = _get_visible(db, user, customer_id)
    data = payload.model_dump(exclude_unset=True)
    if "country" in data or "state" in data:
        _validate_country_state(db, data.get("country", customer.country), data.get("state", customer.state))
    if "owner_id" in data:
        if user.role.value == "design":
            raise validation_error("Only a manager or above can reassign the account owner")
        new_owner = db.get(User, data["owner_id"])
        if not new_owner:
            raise validation_error("Selected owner does not exist")
    marketing_only_changed = "marketing_only" in data and data["marketing_only"] != customer.marketing_only
    for field, value in data.items():
        setattr(customer, field, value)
    audit(db, user_id=user.id, action="update_customer", entity_type="customer", entity_id=customer.id, detail=data)
    if marketing_only_changed:
        # App.toggleMarketingOnly() in the prototype re-evaluates blacklists immediately — Blacklist
        # B depends on this flag, so flipping it can newly trigger, or newly stop, that rule.
        from app.services.blacklist_eval import evaluate_blacklists
        from datetime import date as _date
        evaluate_blacklists(db, _date.today())
    db.commit()
    return customer


@router.put("/{customer_id}/contacts", response_model=CustomerOut)
def replace_contacts(customer_id: uuid.UUID, contacts: list[ContactIn], db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> Customer:
    customer = _get_visible(db, user, customer_id)
    if not contacts or not any(c.email for c in contacts):
        raise validation_error("Add at least one contact with an email")
    if sum(1 for c in contacts if c.primary) > 1:
        raise validation_error("Only one contact can be marked primary")
    _apply_contacts(db, customer, contacts)
    audit(db, user_id=user.id, action="update_contacts", entity_type="customer", entity_id=customer.id)
    db.commit()
    db.refresh(customer)
    return customer


@router.post("/{customer_id}/contacts/{contact_id}/deactivate", response_model=CustomerOut)
def deactivate_contact(customer_id: uuid.UUID, contact_id: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> Customer:
    customer = _get_visible(db, user, customer_id)
    contact = db.get(Contact, contact_id)
    if not contact or contact.customer_id != customer.id:
        raise not_found("Contact not found")
    open_mails = db.scalar(
        select(Mail).join(VisitContact).where(VisitContact.contact_id == contact.id, Mail.status == "scheduled")
    )
    contact.status = "inactive"
    audit(db, user_id=user.id, action="deactivate_contact", entity_type="contact", entity_id=contact.id,
          detail={"had_open_mails": bool(open_mails)})
    db.commit()
    db.refresh(customer)
    return customer


@router.post("/{customer_id}/contacts/{contact_id}/reactivate", response_model=CustomerOut)
def reactivate_contact(customer_id: uuid.UUID, contact_id: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> Customer:
    customer = _get_visible(db, user, customer_id)
    contact = db.get(Contact, contact_id)
    if not contact or contact.customer_id != customer.id:
        raise not_found("Contact not found")
    contact.status = "active"
    audit(db, user_id=user.id, action="reactivate_contact", entity_type="contact", entity_id=contact.id)
    db.commit()
    db.refresh(customer)
    return customer


@router.get("/{customer_id}/swatch-history")
def swatch_history(customer_id: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> list[dict]:
    """Every swatch ever given to this company, across all visits/teams — the Customer Detail
    page's missing 'Swatch history' tab (prototype's custSwatchHistory). One row per VisitItem,
    newest visit first, with the fabric, who it went to, and whether it was ultimately ordered
    (checked against both the mail-derived order_fabrics and a staff-recorded manual order)."""
    from app.models.fabric import Fabric
    from app.models.visit import Visit, VisitItem

    customer = _get_visible(db, user, customer_id)
    visits = db.scalars(
        select(Visit)
        .where(Visit.customer_id == customer.id)
        .options(selectinload(Visit.visit_contacts).selectinload(VisitContact.items), selectinload(Visit.visit_contacts))
    ).all()
    fabric_ids = {it.fabric_id for v in visits for vc in v.visit_contacts for it in vc.items}
    fabrics = {f.id: f for f in db.scalars(select(Fabric).where(Fabric.id.in_(fabric_ids))).all()} if fabric_ids else {}
    contact_ids = {vc.contact_id for v in visits for vc in v.visit_contacts}
    contacts = {ct.id: ct for ct in db.scalars(select(Contact).where(Contact.id.in_(contact_ids))).all()} if contact_ids else {}
    teams_by_id = {t.id: t.name for t in customer.teams}

    rows = []
    for v in sorted(visits, key=lambda v: v.date, reverse=True):
        for vc in v.visit_contacts:
            contact = contacts.get(vc.contact_id)
            ordered_codes = set(vc.manual_order_fabrics or vc.order_fabrics or [])
            for it in vc.items:
                fabric = fabrics.get(it.fabric_id)
                if not fabric:
                    continue
                rows.append({
                    "visit_id": str(v.id),
                    "visit_date": v.date.isoformat(),
                    "collections": v.collections,
                    "contact_name": contact.name if contact else "—",
                    "team_name": teams_by_id.get(contact.team_id) if contact else None,
                    "fabric_code": fabric.code,
                    "fabric_name": fabric.name,
                    "swatch_type": it.swatch_type.value,
                    "qty": it.qty,
                    "ordered": fabric.code in ordered_codes,
                })
    return rows
