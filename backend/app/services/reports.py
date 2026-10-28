"""Reports — a port of the prototype's reportData()/engagement()/stageOf() (core.js). §9 of the
workflow doc.

The prototype's "visit" object is one attendee's own follow-up thread; this schema calls that a
VisitContact (one Visit can have several attendees, hence several VisitContact rows — see the
comment on VisitContact in app/models/visit.py). Every count here is per-VisitContact to match the
prototype's funnel and reply-rate numbers exactly.
"""
from datetime import date, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.customer import Customer
from app.models.mail import Mail, MailResponse
from app.models.user import User
from app.models.visit import Visit, VisitContact


def season_of(d: date) -> dict:
    aw = d.month >= 7
    key = f"{'AW' if aw else 'SS'} {d.year}"
    idx = d.year * 2 + (1 if aw else 0)
    return {"key": key, "idx": idx}


def _vc_mails(db: Session, vc_id) -> list[Mail]:
    return sorted(db.scalars(select(Mail).where(Mail.visit_contact_id == vc_id)), key=lambda m: m.mail_number)


def _mail_responses(db: Session, mail_id) -> list[MailResponse]:
    return db.scalars(select(MailResponse).where(MailResponse.mail_id == mail_id)).all()


def stage_of(db: Session, vc: VisitContact) -> dict:
    mails = _vc_mails(db, vc.id)
    if len(mails) < 5:
        return {"visits": True, "receipt": False, "proto": False, "order": False}
    order = bool(vc.order_placed)
    m3_responses = [r.raw_data for r in _mail_responses(db, mails[2].id)]
    proto = order or any(d.get("proto") == "yes" for d in m3_responses)
    m1_responses = [r.raw_data for r in _mail_responses(db, mails[0].id)]
    any_later_response = any(_mail_responses(db, m.id) for m in mails[1:])
    receipt = proto or any(d.get("received") in ("all", "partial") for d in m1_responses) or any_later_response
    return {"visits": True, "receipt": receipt, "proto": proto, "order": order}


def engagement(db: Session, customer: Customer, today: date) -> dict:
    """Customer engagement tag — Hot/Warm/Cold/Non-responsive/New — and season-over-season trend."""
    vcs = db.scalars(
        select(VisitContact).join(Visit).where(Visit.customer_id == customer.id)
    ).all()
    sent = resp = orders = 0
    last_order: date | None = None
    by_season: dict[int, dict] = {}
    for vc in vcs:
        for m in _vc_mails(db, vc.id):
            if m.status.value == "sent":
                sent += 1
                has_resp = bool(_mail_responses(db, m.id))
                if has_resp:
                    resp += 1
                if m.sent_at:
                    k = season_of(m.sent_at)["idx"]
                    b = by_season.setdefault(k, {"s": 0, "r": 0})
                    b["s"] += 1
                    if has_resp:
                        b["r"] += 1
        if vc.order_placed:
            orders += 1
            if not last_order or (vc.order_date and vc.order_date > last_order):
                last_order = vc.order_date

    rate = resp / sent if sent else 0.0
    tag = "New"
    if sent >= 2:
        if rate >= 0.6 or (last_order and (today - last_order).days <= 365):
            tag = "Hot"
        elif rate >= 0.3:
            tag = "Warm"
        elif rate > 0:
            tag = "Cold"
        else:
            tag = "Non-responsive"

    trend = ""
    ks = sorted(by_season.keys(), reverse=True)
    if len(ks) >= 2:
        a, b = by_season[ks[0]], by_season[ks[1]]
        d = (a["r"] / a["s"] if a["s"] else 0) - (b["r"] / b["s"] if b["s"] else 0)
        trend = "up" if d > 0.1 else "down" if d < -0.1 else "flat"

    return {"sent": sent, "resp": resp, "rate": rate, "orders": orders, "tag": tag, "repeat": orders >= 2, "trend": trend}


def filtered_visit_contacts(db: Session, *, date_from: date | None, date_to: date | None,
                             owner_id=None, customer_category: str | None = None, season: str | None = None) -> list[VisitContact]:
    q = select(VisitContact).join(Visit)
    if date_from:
        q = q.where(Visit.date >= date_from)
    if date_to:
        q = q.where(Visit.date <= date_to)
    if owner_id:
        q = q.where(Visit.owner_id == owner_id)
    vcs = db.scalars(q).all()
    if customer_category or season:
        out = []
        for vc in vcs:
            visit = db.get(Visit, vc.visit_id)
            if customer_category:
                customer = db.get(Customer, visit.customer_id)
                if customer.category != customer_category:
                    continue
            if season and season_of(visit.date)["key"] != season:
                continue
            out.append(vc)
        return out
    return vcs


def report_data(db: Session, vcs: list[VisitContact], today: date, scope_all_customers: bool) -> dict:
    reached = {"visits": len(vcs), "receipt": 0, "proto": 0, "order": 0}
    for vc in vcs:
        s = stage_of(db, vc)
        if s["receipt"]:
            reached["receipt"] += 1
        if s["proto"]:
            reached["proto"] += 1
        if s["order"]:
            reached["order"] += 1

    stages = []
    for n in range(1, 6):
        sent = resp = 0
        for vc in vcs:
            mails = _vc_mails(db, vc.id)
            if len(mails) < n:
                continue
            m = mails[n - 1]
            if m.status.value == "sent":
                sent += 1
                if _mail_responses(db, m.id):
                    resp += 1
        stages.append({"n": n, "sent": sent, "resp": resp, "rate": (resp / sent if sent else 0.0)})

    cycles = []
    for vc in vcs:
        if vc.order_placed and vc.order_date:
            visit = db.get(Visit, vc.visit_id)
            cycles.append((vc.order_date - visit.date).days)
    avg_cycle = round(sum(cycles) / len(cycles)) if cycles else None

    team = []
    for u in db.scalars(select(User).where(User.role == "design")):
        u_vcs = [vc for vc in vcs if db.get(Visit, vc.visit_id).owner_id == u.id]
        sent = resp = 0
        for vc in u_vcs:
            for m in _vc_mails(db, vc.id):
                if m.status.value == "sent":
                    sent += 1
                    if _mail_responses(db, m.id):
                        resp += 1
        orders = [vc for vc in u_vcs if vc.order_placed and vc.order_date]
        cyc = [(vc.order_date - db.get(Visit, vc.visit_id).date).days for vc in orders]
        team.append({
            "user_id": str(u.id), "name": u.name, "visits": len(u_vcs), "sent": sent, "resp": resp,
            "rate": (resp / sent if sent else 0.0), "orders": len(orders),
            "cycle": round(sum(cyc) / len(cyc)) if cyc else None,
        })

    if scope_all_customers:
        in_scope = db.scalars(select(Customer)).all()
    else:
        customer_ids = {db.get(Visit, vc.visit_id).customer_id for vc in vcs}
        in_scope = [db.get(Customer, cid) for cid in customer_ids]

    tags: dict[str, int] = {}
    bl = {"A": 0, "B": 0, "C": 0}
    for c in in_scope:
        tag = engagement(db, c, today)["tag"]
        tags[tag] = tags.get(tag, 0) + 1
        if c.blacklist_cat:
            bl[c.blacklist_cat.value] += 1

    return {
        "reached": reached, "stages": stages, "avg_cycle": avg_cycle, "team": team,
        "tags": tags, "blacklist": bl, "customers": len(in_scope),
    }
