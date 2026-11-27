import uuid

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import require_any
from app.core.errors import conflict, not_found, validation_error
from app.models.fabric import Fabric
from app.models.user import User
from app.schemas.fabric import (
    FabricCreate,
    FabricImportResult,
    FabricImportRow,
    FabricOut,
    FabricUpdate,
)
from app.services.audit import audit

router = APIRouter(prefix="/fabrics", tags=["fabrics"])


@router.get("", response_model=list[FabricOut])
def list_fabrics(active_only: bool = False, db: Session = Depends(get_db), _: User = Depends(require_any)) -> list[dict]:
    from sqlalchemy import func
    from app.models.visit import VisitItem

    q = select(Fabric).order_by(Fabric.code)
    if active_only:
        q = q.where(Fabric.status == "active")
    fabrics = db.scalars(q).all()
    counts = dict(db.execute(select(VisitItem.fabric_id, func.count(VisitItem.id)).group_by(VisitItem.fabric_id)).all())
    return [{**{c.name: getattr(f, c.name) for c in Fabric.__table__.columns}, "used_count": counts.get(f.id, 0)} for f in fabrics]


@router.post("", response_model=FabricOut, status_code=201)
def create_fabric(payload: FabricCreate, db: Session = Depends(get_db), user: User = Depends(require_any)) -> Fabric:
    if db.scalar(select(Fabric).where(Fabric.code == payload.code)):
        raise conflict(f"Item code '{payload.code}' already exists")
    # Required on the Item Master form (Urvish, 2026-11-26) — NOT enforced on the CSV/Excel bulk
    # importers below, which intentionally allow older/partial rows to backfill gradually.
    if not payload.season:
        raise validation_error("Season is required")
    if not payload.story:
        raise validation_error("Story is required")
    fabric = Fabric(**payload.model_dump())
    db.add(fabric)
    audit(db, user_id=user.id, action="create_fabric", entity_type="fabric", detail={"code": fabric.code})
    db.commit()
    return fabric


@router.patch("/{fabric_id}", response_model=FabricOut)
def update_fabric(fabric_id: uuid.UUID, payload: FabricUpdate, db: Session = Depends(get_db), user: User = Depends(require_any)) -> Fabric:
    fabric = db.get(Fabric, fabric_id)
    if not fabric:
        raise not_found("Item not found")
    data = payload.model_dump(exclude_unset=True)
    # Same required-field rule as create_fabric — checked against the value AFTER this update is
    # applied (so a save that doesn't touch season/story but already has them set is unaffected),
    # not enforced for CSV/Excel bulk import.
    final_season = data.get("season", fabric.season)
    final_story = data.get("story", fabric.story)
    if "season" in data and not final_season:
        raise validation_error("Season is required")
    if "story" in data and not final_story:
        raise validation_error("Story is required")
    for field, value in data.items():
        setattr(fabric, field, value)
    audit(db, user_id=user.id, action="update_fabric", entity_type="fabric", entity_id=fabric.id, detail=data)
    db.commit()
    return fabric


#: Columns copied verbatim from a FabricImportRow onto a Fabric when importing — everything
#: except `code` (normalized separately, used as the lookup key) and `name` (always re-derived
#: below so a row with a blank name still gets one, matching FabricCreate's own behaviour).
_IMPORT_FIELDS = [
    "quality_category", "composition", "gsm", "supplier",
    "development_no", "gender", "season", "story", "fabric_category", "fabric_type", "print_type",
    "lapf_domestic", "lapf_export", "warp", "weft", "fin_const", "width_cm", "width_inch",
    "price_meter", "moq", "remark", "sort_no_sticker", "dia_inch", "structure_gauge", "fibre", "yarn_details",
]


@router.post("/import", response_model=FabricImportResult)
def import_fabrics(rows: list[FabricImportRow], db: Session = Depends(get_db), user: User = Depends(require_any)) -> FabricImportResult:
    """All-or-nothing: every row must be valid before anything is committed (§3 of the validation
    doc — avoids the ambiguity of a partial-success import the prototype's demo CSV importer had).
    Only `code` is required per row — name is auto-derived (FabricImportRow.derive_name) and every
    other field, including the legacy quality_category, is optional, matching the Item Master
    rebuild (the client's sheet has no name/quality_category columns at all)."""
    errors: list[str] = []
    seen_codes: set[str] = set()
    for i, row in enumerate(rows, start=1):
        code = row.code.strip().upper()
        if not code:
            errors.append(f"Row {i}: code is required")
            continue
        if code in seen_codes:
            errors.append(f"Row {i}: duplicate code '{code}' within this import")
        seen_codes.add(code)
        if row.gsm is not None and row.gsm <= 0:
            errors.append(f"Row {i}: gsm must be a positive number for '{code}'")
    if errors:
        raise validation_error("Fix these rows and re-import — nothing was saved.", fields={"rows": errors})

    created = updated = 0
    for row in rows:
        code = row.code.strip().upper()
        values = {field: getattr(row, field) for field in _IMPORT_FIELDS}
        existing = db.scalar(select(Fabric).where(Fabric.code == code))
        if existing:
            existing.name = row.name or existing.name
            for field, value in values.items():
                setattr(existing, field, value)
            updated += 1
        else:
            db.add(Fabric(code=code, name=row.name or code, **values))
            created += 1
    audit(db, user_id=user.id, action="import_fabrics", entity_type="fabric", detail={"created": created, "updated": updated})
    db.commit()
    return FabricImportResult(created=created, updated=updated)
