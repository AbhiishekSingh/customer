"""Staff notifications — a faithful port of the prototype's notify()/myNotifications() helpers
(core.js). `to_user_id=None` with `to_managers=True` fans out to every active manager/admin/top
user, matching the prototype's special 'managers' pseudo-recipient (myNotifications() shows a
'managers' notification to anyone who isMgr() — manager, admin or top)."""
import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.enums import RoleEnum
from app.models.misc import Notification
from app.models.user import User

MANAGER_ROLES = (RoleEnum.manager, RoleEnum.admin, RoleEnum.top)


def notify_user(db: Session, user_id: uuid.UUID, text: str, link: str | None = None) -> None:
    db.add(Notification(user_id=user_id, text=text, link=link))


def notify_managers(db: Session, text: str, link: str | None = None) -> None:
    for u in db.scalars(select(User).where(User.role.in_(MANAGER_ROLES))):
        db.add(Notification(user_id=u.id, text=text, link=link))
