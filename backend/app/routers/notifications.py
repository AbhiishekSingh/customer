"""The bell icon in the top bar — app/services/notify.py writes these, this just reads/acks them.
Not covered by any task doc explicitly, but notify_user()/notify_managers() are called all over
the mail engine and blacklist flows, and without a way to read them back those calls were dead
writes. Matches the prototype's myNotifications()/markNotificationsRead()."""
import uuid

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import get_current_user
from app.core.errors import not_found
from app.models.misc import Notification
from app.models.user import User
from app.schemas.notification import NotificationOut

router = APIRouter(prefix="/notifications", tags=["notifications"])


@router.get("", response_model=list[NotificationOut])
def list_notifications(limit: int = Query(50, le=200), db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> list[Notification]:
    return db.scalars(
        select(Notification).where(Notification.user_id == user.id).order_by(Notification.created_at.desc()).limit(limit)
    ).all()


@router.post("/{notification_id}/read", response_model=NotificationOut)
def mark_read(notification_id: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> Notification:
    n = db.get(Notification, notification_id)
    if not n or n.user_id != user.id:
        raise not_found("Notification not found")
    n.read = True
    db.commit()
    return n


@router.post("/read-all")
def mark_all_read(db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> dict:
    updated = (
        db.query(Notification)
        .filter(Notification.user_id == user.id, Notification.read.is_(False))
        .update({"read": True})
    )
    db.commit()
    return {"updated": updated}
