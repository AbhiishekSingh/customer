import json
import uuid

from sqlalchemy.orm import Session

from app.models.misc import AuditLog


def _json_safe(detail: dict) -> dict:
    """Make a detail dict safe to store in a JSONB column.

    Callers often build `detail` straight from a Pydantic `model_dump()` (e.g. a PATCH
    payload), which can still contain non-JSON-native Python types such as `uuid.UUID`,
    `datetime.date`/`datetime.datetime`, or `Decimal`. psycopg's JSONB adapter uses the
    stdlib `json` module with no custom encoder, so any of those raise an unhandled
    `TypeError: Object of type UUID is not JSON serializable` deep inside the INSERT —
    surfacing as a 500 on an otherwise-successful save. Round-tripping through
    `json.dumps(..., default=str)` once here converts every such value to its string
    form, the same way it would have been rendered in the API response anyway.
    """
    return json.loads(json.dumps(detail, default=str))


def audit(db: Session, *, user_id: uuid.UUID | None, action: str, entity_type: str | None = None,
          entity_id: uuid.UUID | None = None, detail: dict | None = None) -> None:
    """Append-only audit trail — §10 of the validation doc: never updated/deleted via the API."""
    db.add(AuditLog(user_id=user_id, action=action, entity_type=entity_type, entity_id=entity_id,
                     detail=_json_safe(detail) if detail else {}))
