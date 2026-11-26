import uuid

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.core.database import get_db
from app.core.deps import require_any, require_manager_up
from app.core.errors import conflict, not_found, validation_error
from app.models.category import Category, Country, State
from app.models.enums import sv
from app.models.user import User
from app.schemas.category import (
    CategoryCreate,
    CategoryDatesIn,
    CategoryOut,
    CountryCreate,
    CountryOut,
    StateCreate,
    StateOut,
)
from app.services.audit import audit

router = APIRouter(prefix="/categories", tags=["categories"])

# 'fabric' is the legacy D&D swatch category (Linen/Cotton/Viscose/...); 'fabric_category' is the
# separate Woven/Knit master added for the Item Master rebuild — kept as distinct types so neither
# list's values collide with or shadow the other's.
VALID_TYPES = {
    "fabric", "customer", "color",
    "gender", "season", "story", "supplier", "fabric_category", "fabric_type", "print_type",
}
# Only 'season' categories ever carry a date range — enforced in set_category_dates below so a
# stray date never gets attached to, say, a Supplier or Gender row.
DATED_TYPES = {"season"}

# Every mutating endpoint below uses require_manager_up (manager/admin/top), not require_admin.
# Found while end-to-end testing the Item Master rebuild: the frontend's own permission model
# (Categories.jsx / Fabrics.jsx canEdit = isMgr(role), i.e. manager-and-up) already shows every
# Add/Deactivate control — including the Item Master form's inline "+ Add new…" — to managers, but
# these endpoints were gated to admin-only, so a manager got a silent 403 the moment they actually
# used a control the UI told them they could. Widened to match what the UI already promises, for
# every category type (this wasn't specific to the new Item Master types).


# ---------- flat categories (fabric / customer) ----------

@router.get("/{type_}", response_model=list[CategoryOut])
def list_categories(type_: str, db: Session = Depends(get_db), _: User = Depends(require_any)) -> list[Category]:
    if type_ not in VALID_TYPES:
        raise validation_error(f"Unknown category type '{type_}'")
    return db.scalars(select(Category).where(Category.type == type_).order_by(Category.name)).all()


@router.post("", response_model=CategoryOut, status_code=201)
def create_category(payload: CategoryCreate, db: Session = Depends(get_db), admin: User = Depends(require_manager_up)) -> Category:
    if payload.type not in VALID_TYPES:
        raise validation_error(f"Unknown category type '{payload.type}'")
    name = payload.name.strip()
    if not name:
        raise validation_error("Name is required")
    if db.scalar(select(Category).where(Category.type == payload.type, Category.name == name)):
        raise conflict(f"'{name}' already exists under {payload.type} categories")
    cat = Category(type=payload.type, name=name)
    db.add(cat)
    audit(db, user_id=admin.id, action="create_category", entity_type="category", detail={"type": payload.type, "name": name})
    db.commit()
    return cat


@router.patch("/{category_id}/dates", response_model=CategoryOut)
def set_category_dates(category_id: uuid.UUID, payload: CategoryDatesIn, db: Session = Depends(get_db), admin: User = Depends(require_manager_up)) -> Category:
    """Set or clear the optional From/To date range on a category row. Restricted to
    DATED_TYPES ('season' only) so this can't be used to silently attach dates to a category type
    the UI never shows them for."""
    cat = db.get(Category, category_id)
    if not cat:
        raise not_found("Category not found")
    if cat.type not in DATED_TYPES:
        raise validation_error(f"'{cat.type}' categories don't support a date range")
    if payload.date_from and payload.date_to and payload.date_from > payload.date_to:
        raise validation_error("From date must be on or before the To date")
    cat.date_from = payload.date_from
    cat.date_to = payload.date_to
    audit(db, user_id=admin.id, action="set_category_dates", entity_type="category", entity_id=cat.id,
          detail={"name": cat.name, "date_from": str(payload.date_from) if payload.date_from else None,
                  "date_to": str(payload.date_to) if payload.date_to else None})
    db.commit()
    return cat


@router.post("/{category_id}/toggle", response_model=CategoryOut)
def toggle_category(category_id: uuid.UUID, db: Session = Depends(get_db), admin: User = Depends(require_manager_up)) -> Category:
    """Categories are never hard-deleted — only (de)activated (§4 of the validation doc)."""
    cat = db.get(Category, category_id)
    if not cat:
        raise not_found("Category not found")
    cat.status = "inactive" if sv(cat.status) == "active" else "active"
    audit(db, user_id=admin.id, action="toggle_category", entity_type="category", entity_id=cat.id, detail={"new_status": sv(cat.status)})
    db.commit()
    return cat


# ---------- nested country -> state ----------

@router.get("/countries/all", response_model=list[CountryOut])
def list_countries(db: Session = Depends(get_db), _: User = Depends(require_any)) -> list[Country]:
    return db.scalars(select(Country).options(selectinload(Country.states)).order_by(Country.name)).all()


@router.post("/countries", response_model=CountryOut, status_code=201)
def create_country(payload: CountryCreate, db: Session = Depends(get_db), admin: User = Depends(require_manager_up)) -> Country:
    name = payload.name.strip()
    if not name:
        raise validation_error("Country name is required")
    if db.scalar(select(Country).where(Country.name == name)):
        raise conflict(f"Country '{name}' already exists")
    country = Country(name=name)
    db.add(country)
    audit(db, user_id=admin.id, action="create_country", entity_type="country", detail={"name": name})
    db.commit()
    return country


@router.post("/countries/{country_id}/toggle", response_model=CountryOut)
def toggle_country(country_id: uuid.UUID, db: Session = Depends(get_db), admin: User = Depends(require_manager_up)) -> Country:
    country = db.get(Country, country_id)
    if not country:
        raise not_found("Country not found")
    country.status = "inactive" if sv(country.status) == "active" else "active"
    audit(db, user_id=admin.id, action="toggle_country", entity_type="country", entity_id=country.id, detail={"new_status": sv(country.status)})
    db.commit()
    return country


@router.post("/countries/{country_id}/states", response_model=StateOut, status_code=201)
def add_state(country_id: uuid.UUID, payload: StateCreate, db: Session = Depends(get_db), admin: User = Depends(require_manager_up)) -> State:
    country = db.get(Country, country_id)
    if not country:
        raise validation_error("Unknown or inactive country")
    name = payload.name.strip()
    if not name:
        raise validation_error("State/province name is required")
    if db.scalar(select(State).where(State.country_id == country_id, State.name == name)):
        raise conflict(f"'{name}' already exists under {country.name}")
    state = State(country_id=country_id, name=name)
    db.add(state)
    audit(db, user_id=admin.id, action="add_state", entity_type="state", detail={"country": country.name, "name": name})
    db.commit()
    return state


@router.post("/states/{state_id}/toggle", response_model=StateOut)
def toggle_state(state_id: uuid.UUID, db: Session = Depends(get_db), admin: User = Depends(require_manager_up)) -> State:
    """A state never changes parent country for its lifetime — only its active/inactive flag
    changes (§4 of the validation doc)."""
    state = db.get(State, state_id)
    if not state:
        raise not_found("State not found")
    state.status = "inactive" if sv(state.status) == "active" else "active"
    audit(db, user_id=admin.id, action="toggle_state", entity_type="state", entity_id=state.id, detail={"new_status": sv(state.status)})
    db.commit()
    return state
