"""Settings → Email Templates: lets a manager+ edit the subject/body of each of the 6 outgoing
mail variants without needing a code change. See app/services/mail_templates.py for the
placeholder/validation rules and the defaults this seeds from."""
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import require_any, require_manager_up
from app.models.user import User
from app.schemas.mail_template import MailTemplateOut, MailTemplateUpdate, PlaceholderOut
from app.services.audit import audit
from app.services.mail_templates import PLACEHOLDERS, all_templates, reset_template, save_template

router = APIRouter(prefix="/mail-templates", tags=["mail-templates"])


@router.get("", response_model=list[MailTemplateOut])
def list_templates(db: Session = Depends(get_db), _: User = Depends(require_any)) -> list:
    return all_templates(db)


@router.get("/placeholders", response_model=list[PlaceholderOut])
def list_placeholders(_: User = Depends(require_any)) -> list:
    return PLACEHOLDERS


@router.patch("/{mail_number}/{variant}", response_model=MailTemplateOut)
def update_template(mail_number: int, variant: str, payload: MailTemplateUpdate, db: Session = Depends(get_db), user: User = Depends(require_manager_up)):
    v = None if variant in ("none", "null", "-") else variant
    row = save_template(db, mail_number, v, payload.subject, payload.body, user.id)
    audit(db, user_id=user.id, action=f"Edited the Mail {mail_number}{f' ({v})' if v else ''} template",
          entity_type="mail_template", entity_id=row.id, detail={"subject": payload.subject})
    db.commit()
    return row


@router.post("/{mail_number}/{variant}/reset", response_model=MailTemplateOut)
def reset(mail_number: int, variant: str, db: Session = Depends(get_db), user: User = Depends(require_manager_up)):
    v = None if variant in ("none", "null", "-") else variant
    row = reset_template(db, mail_number, v, user.id)
    audit(db, user_id=user.id, action=f"Reset the Mail {mail_number}{f' ({v})' if v else ''} template to its default",
          entity_type="mail_template", entity_id=row.id, detail={})
    db.commit()
    return row
