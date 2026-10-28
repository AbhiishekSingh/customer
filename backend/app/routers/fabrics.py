import uuid

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import require_any, require_manager_up
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
def create_fabric(payload: FabricCreate, db: Session = Depends(get_db), user: User = Depends(require_manager_up)) -> Fabric:
    if db.scalar(select(Fabric).where(Fabric.code == payload.code)):
        raise conflict(f"Item code '{payload.code}' already exists")
    fabric = Fabric(**payload.model_dump())
    db.add(fabric)
    audit(db, user_id=user.id, action="create_fabric", entity_type="fabric", detail={"code": fabric.code})
    db.commit()
    return fabric


@router.patch("/{fabric_id}", response_model=FabricOut)
def update_fabric(fabric_id: uuid.UUID, payload: FabricUpdate, db: Session = Depends(get_db), user: User = Depends(require_manager_up)) -> Fabric:
    fabric = db.get(Fabric, fabric_id)
    if not fabric:
        raise not_found("Item not found")
    data = payload.model_dump(exclude_unset=True)
    for field, value in data.items():
        setattr(fabric, field, value)
    audit(db, user_id=user.id, action="update_fabric", entity_type="fabric", entity_id=fabric.id, detail=data)
    db.commit()
    return fabric


@router.post("/import", response_model=FabricImportResult)
def import_fabrics(rows: list[FabricImportRow], db: Session = Depends(get_db), user: User = Depends(require_manager_up)) -> FabricImportResult:
    """All-or-nothing: every row must be valid before anything is committed (§3 of the validation
    doc — avoids the ambiguity of a partial-success import the prototype's demo CSV importer had)."""
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
        if not row.name.strip():
            errors.append(f"Row {i}: name is required for '{code}'")
        if not row.quality_category.strip():
            errors.append(f"Row {i}: quality/category is required for '{code}'")
        if row.gsm is not None and row.gsm <= 0:
            errors.append(f"Row {i}: gsm must be a positive number for '{code}'")
    if errors:
        raise validation_error("Fix these rows and re-import — nothing was saved.", fields={"rows": errors})

    created = updated = 0
    for row in rows:
        code = row.code.strip().upper()
        existing = db.scalar(select(Fabric).where(Fabric.code == code))
        if existing:
            existing.name = row.name.strip()
            existing.quality_category = row.quality_category.strip()
            existing.composition = row.composition
            existing.gsm = row.gsm
            updated += 1
        else:
            db.add(Fabric(code=code, name=row.name.strip(), quality_category=row.quality_category.strip(),
                           composition=row.composition, gsm=row.gsm))
            created += 1
    audit(db, user_id=user.id, action="import_fabrics", entity_type="fabric", detail={"created": created, "updated": updated})
    db.commit()
    return FabricImportResult(created=created, updated=updated)
