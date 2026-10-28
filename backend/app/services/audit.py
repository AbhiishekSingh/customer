import uuid

from sqlalchemy.orm import Session

from app.models.misc import AuditLog


def audit(db: Session, *, user_id: uuid.UUID | None, action: str, entity_type: str | None = None,
          entity_id: uuid.UUID | None = None, detail: dict | None = None) -> None:
    """Append-only audit trail — §10 of the validation doc: never updated/deleted via the API."""
    db.add(AuditLog(user_id=user_id, action=action, entity_type=entity_type, entity_id=entity_id, detail=detail or {}))
