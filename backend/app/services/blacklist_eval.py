"""Automatic blacklist rule evaluation — a port of the prototype's evaluateAll()/evaluateBlacklists()
(core.js ~346-410). §6 of the validation doc. Task 47 follow-up to task 42 (which only covered the
manual suggest/decide workflow).

The system never blacklists anyone itself — it only ever raises a BlacklistEvent *suggestion*,
which still needs every current Top Management user's approval (blacklist_service.py) before
Customer.blacklist_cat is actually set. This module decides WHEN a suggestion should exist, and
withdraws one the moment its evidence stops holding — it never approves, rejects, or sets
blacklist_cat directly.

Rule priority, evaluated in this order, first match wins (matches the prototype's C, A, B order):
  C — two consecutive seasons (each one fully delivered, no bounces/holds) with no feedback and
      no closure on any visit in either season.
  A — the company replied ONLY to Mail 5, never to Mails 1-4, Mails 1-4 were actually delivered
      (not bounced), and no co-attendee from the same visit answered Mails 1-4 either.
  B — partial replies with no feedback/closure for the full 5-mail sequence, AND the company is
      flagged "only in touch with marketing" (Customer.marketing_only).
"""
import uuid
from datetime import date, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.blacklist import BlacklistEvent
from app.models.customer import Customer
from app.models.mail import Mail, MailResponse
from app.models.visit import Visit, VisitContact
from app.services.blacklist_service import current_top_user_ids, restore_c_skipped_mails
from app.services.audit import audit
from app.services.notify import notify_managers, notify_user
from app.services.scheduler_service import on_hold
from app.services.settings_service import get_settings


def season_of(d: date) -> dict:
    aw = d.month >= 7
    key = f"{'AW' if aw else 'SS'} {d.year}"
    idx = d.year * 2 + (1 if aw else 0)
    end = date(d.year, 12, 31) if aw else date(d.year, 6, 30)
    return {"key": key, "idx": idx, "end": end}


def _delivered(m: Mail) -> bool:
    return m.status.value == "sent"


def _vc_mails(db: Session, vc_id) -> list[Mail]:
    return sorted(db.scalars(select(Mail).where(Mail.visit_contact_id == vc_id)), key=lambda m: m.mail_number)


def _latest_response_data(db: Session, mail_id) -> dict | None:
    resp = db.scalar(select(MailResponse).where(MailResponse.mail_id == mail_id).order_by(MailResponse.submitted_at.desc()).limit(1))
    return resp.raw_data if resp else None


def _is_feedback(data: dict) -> bool:
    return data.get("testStatus") in ("approved", "issues") or bool(data.get("proto")) or bool(data.get("quality"))


def _is_closure(data: dict, mail_number: int) -> bool:
    return data.get("orderPlaced") in ("yes", "no") or bool(data.get("notProceeding")) or mail_number == 5


def visit_contact_resp(db: Session, vc: VisitContact) -> dict:
    """{any, feedback, closure} — using the LATEST response on each mail that has one, since a
    customer may edit their answer (matches the prototype's visitResp())."""
    any_ = feedback = closure = False
    for m in _vc_mails(db, vc.id):
        data = _latest_response_data(db, m.id)
        if data is None:
            continue
        any_ = True
        if _is_feedback(data):
            feedback = True
        if _is_closure(data, m.mail_number):
            closure = True
    if vc.order_placed:
        closure = True
    return {"any": any_, "feedback": feedback, "closure": closure}


def _visit_contacts_of(db: Session, customer_id: uuid.UUID) -> list[VisitContact]:
    return list(db.scalars(select(VisitContact).join(Visit).where(Visit.customer_id == customer_id).order_by(Visit.date)))


def b_candidate_vc(db: Session, customer: Customer, today: date, settings: dict) -> VisitContact | None:
    after = customer.whitelist_after or date.min
    for vc in db.scalars(select(VisitContact).join(Visit).where(Visit.customer_id == customer.id, Visit.date > after).order_by(Visit.date)):
        visit = db.get(Visit, vc.visit_id)
        mails = _vc_mails(db, vc.id)
        if len(mails) < 5:
            continue
        r = visit_contact_resp(db, vc)
        m5 = mails[4]
        if not r["any"] or r["feedback"] or r["closure"] or not _delivered(m5):
            continue
        if not m5.sent_at or (today - m5.sent_at).days < settings["b_grace_days"]:
            continue
        return vc
    return None


def evaluate_all(db: Session, customer: Customer, today: date, settings: dict) -> list[dict]:
    out: list[dict] = []
    after = customer.whitelist_after or date.min
    vcs = [vc for vc in _visit_contacts_of(db, customer.id) if db.get(Visit, vc.visit_id).date > after]

    # ---------- C: two consecutive silent seasons ----------
    groups: dict[int, dict] = {}
    for vc in vcs:
        visit = db.get(Visit, vc.visit_id)
        s = season_of(visit.date)
        g = groups.setdefault(s["idx"], {"season": s, "vcs": []})
        g["vcs"].append(vc)
    ordered = [groups[k] for k in sorted(groups.keys())]

    def _silent(group: dict) -> bool:
        if group["season"]["end"] >= today:
            return False
        for vc in group["vcs"]:
            if on_hold(db, vc.id):
                return False
            mails = _vc_mails(db, vc.id)
            if len(mails) < 4 or not any(_delivered(m) for m in mails[1:4]):
                return False
            r = visit_contact_resp(db, vc)
            if r["feedback"] or r["closure"]:
                return False
        return True

    for i in range(len(ordered) - 2, -1, -1):
        if _silent(ordered[i]) and _silent(ordered[i + 1]):
            vc_ids = [vc.id for vc in ordered[i]["vcs"]] + [vc.id for vc in ordered[i + 1]["vcs"]]
            out.append({
                "cat": "C",
                "reason": f"No feedback or closure in {ordered[i]['season']['key']} and {ordered[i + 1]['season']['key']}",
                "visit_contact_ids": vc_ids,
            })
            break

    # ---------- A: answered Mail 5 only ----------
    for vc in reversed(vcs):
        mails = _vc_mails(db, vc.id)
        if len(mails) < 5:
            continue
        first4 = mails[:4]
        m5 = mails[4]
        if not db.scalar(select(MailResponse.id).where(MailResponse.mail_id == m5.id)):
            continue
        if any(db.scalar(select(MailResponse.id).where(MailResponse.mail_id == m.id)) for m in first4):
            continue
        if not any(_delivered(m) for m in first4):
            continue
        if any(m.status.value == "bounced" for m in first4):
            continue
        visit = db.get(Visit, vc.visit_id)
        siblings = [x for x in vcs if x.id != vc.id and db.get(Visit, x.visit_id).id == visit.id]
        sib_responded = False
        for sib in siblings:
            sib_first4 = _vc_mails(db, sib.id)[:4]
            if any(db.scalar(select(MailResponse.id).where(MailResponse.mail_id == m.id)) for m in sib_first4):
                sib_responded = True
                break
        if sib_responded:
            continue
        out.append({
            "cat": "A",
            "reason": f"Visit of {visit.date.isoformat()}: only Mail 5 answered",
            "visit_contact_ids": [vc.id],
        })
        break

    # ---------- B: partial replies + marketing-only ----------
    bvc = b_candidate_vc(db, customer, today, settings)
    if bvc and customer.marketing_only:
        visit = db.get(Visit, bvc.visit_id)
        out.append({
            "cat": "B",
            "reason": f"Visit of {visit.date.isoformat()}: replies without feedback or closure; only in touch with marketing",
            "visit_contact_ids": [bvc.id],
        })

    return out


def evaluate_customer(db: Session, customer: Customer, today: date, settings: dict) -> dict | None:
    all_ = evaluate_all(db, customer, today, settings)
    return all_[0] if all_ else None


def _signature(f: dict) -> str:
    return f"{f['cat']}:" + ",".join(sorted(str(i) for i in f["visit_contact_ids"]))


def evaluate_blacklists(db: Session, today: date | None = None) -> dict:
    """Runs the rule engine for every customer, auto-raising or auto-withdrawing BlacklistEvent
    suggestions as the evidence changes. Safe to call more than once for the same day — raising
    and withdrawing are both idempotent (re-running with no change in evidence does nothing)."""
    today = today or date.today()
    settings = get_settings(db)
    raised = withdrawn = auto_cleared = 0

    for customer in db.scalars(select(Customer)):
        all_ = evaluate_all(db, customer, today, settings)
        f = all_[0] if all_ else None
        cur = customer.blacklist_cat.value if customer.blacklist_cat else None
        # the most recent event for this customer stands in for the prototype's single mutable
        # c.proposal — used below both to withdraw a stale pending suggestion and to recognise
        # evidence Top Management already rejected, so it isn't immediately re-raised.
        latest_event = db.scalar(
            select(BlacklistEvent).where(BlacklistEvent.customer_id == customer.id)
            .order_by(BlacklistEvent.created_at.desc()).limit(1)
        )
        pending = latest_event if latest_event and latest_event.status.value == "pending" else None

        # auto-clear an active category that no longer holds (unless a visit is currently on hold
        # for a bounce, in which case we can't yet tell if the rule still applies)
        if cur and not any(x["cat"] == cur for x in all_):
            any_on_hold = any(on_hold(db, vc.id) for vc in _visit_contacts_of(db, customer.id)
                               if db.get(Visit, vc.visit_id).date > (customer.whitelist_after or date.min))
            if not any_on_hold:
                why = ("No longer marked as only in touch with marketing" if cur == "B" and not customer.marketing_only
                       else "Customer responded — rule no longer applies")
                customer.blacklist_cat = None
                restored = restore_c_skipped_mails(db, customer)
                audit(db, user_id=None, action=f"Blacklist {cur} auto-cleared", entity_type="customer", entity_id=customer.id,
                      detail={"reason": why, "mails_restored": restored})
                notify_user(db, customer.owner_id, f"{customer.name} removed from Blacklist {cur} — {why}", f"/customer/{customer.id}")
                notify_managers(db, f"{customer.name} removed from Blacklist {cur}", f"/customer/{customer.id}")
                auto_cleared += 1
                cur = None

        if pending and f and pending.cat.value != f["cat"]:
            pending.status = "withdrawn"
            audit(db, user_id=None, action=f"Suggestion withdrawn (was {pending.cat.value})", entity_type="blacklist_event",
                  entity_id=pending.id, detail={"reason": "Rule no longer applies"})
            withdrawn += 1
            pending = None
            latest_event = None

        if not f:
            if pending:
                pending.status = "withdrawn"
                audit(db, user_id=None, action=f"Suggestion withdrawn (was {pending.cat.value})", entity_type="blacklist_event",
                      entity_id=pending.id, detail={"reason": "Customer responded — rule no longer applies"})
                for top_id in current_top_user_ids(db):
                    notify_user(db, top_id, f"Blacklist suggestion for {customer.name} withdrawn — the customer responded", f"/customer/{customer.id}")
                withdrawn += 1
            continue

        if cur == f["cat"]:
            continue  # already blacklisted at this category — nothing to suggest

        sig = _signature(f)
        if latest_event and (latest_event.status.value == "pending" or latest_event.sig == sig):
            continue  # already waiting, or Top Management already said no to this same evidence

        event = BlacklistEvent(customer_id=customer.id, cat=f["cat"], reason=f["reason"], status="pending", sig=sig, auto_raised=True)
        db.add(event)
        db.flush()
        audit(db, user_id=None, action=f"Suggested Blacklist {f['cat']}", entity_type="blacklist_event", entity_id=event.id,
              detail={"customer": customer.name, "reason": f["reason"]})
        for top_id in current_top_user_ids(db):
            notify_user(db, top_id, f"{customer.name}: Blacklist {f['cat']} suggested — your approval is needed", "/blacklist")
        notify_user(db, customer.owner_id, f"{customer.name} suggested for Blacklist {f['cat']} — waiting for Top Management", f"/customer/{customer.id}")
        raised += 1

    return {"raised": raised, "withdrawn": withdrawn, "auto_cleared": auto_cleared}
