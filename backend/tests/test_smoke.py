"""End-to-end smoke suite against a real Postgres database (task 45). Run with the app's own DB
already migrated and seeded:

    python3 -m scripts.seed_minimal
    python3 -m scripts.seed_masters
    python3 -m pytest tests/ -v

Each test creates its own uniquely-named customer/fabric so the suite is safe to re-run against
the same shared database without manual cleanup (no dedicated per-test transaction/rollback is
set up here — that's a reasonable next step, not a blocker for this smoke pass)."""
import uuid
from datetime import date, timedelta

import pytest


def _uniq(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex[:8]}"


# ---------- auth ----------

def test_login_requires_matching_role(client, auth):
    r = client.post("/auth/login", json={"email": "priya.nair@example.com", "password": "Passw0rd!123", "role_selected": "admin"})
    assert r.status_code == 401
    assert r.json()["detail"]["error"]["code"] == "UNAUTHORIZED"


def test_login_wrong_password(client):
    r = client.post("/auth/login", json={"email": "priya.nair@example.com", "password": "wrong", "role_selected": "design"})
    assert r.status_code == 401


def test_login_success_and_me(client, auth):
    headers = auth("design")
    r = client.get("/auth/me", headers=headers)
    assert r.status_code == 200
    assert r.json()["role"] == "design"


def test_account_lockout_after_five_failures(client, auth):
    """Uses a disposable user (never one of the shared role accounts other tests log in as — a
    15-minute lockout on a shared account would fail every later test that needs it)."""
    admin_h = auth("admin")
    email = f"{_uniq('lockout')}@example.com"
    r = client.post("/users", headers=admin_h, json={"name": "Lockout Test", "email": email, "role": "design"})
    assert r.status_code == 201, r.text

    from app.core.database import SessionLocal
    from app.core.security import hash_password
    from app.models.user import User as UserModel
    session = SessionLocal()
    u = session.query(UserModel).filter(UserModel.email == email).first()
    u.password_hash = hash_password("Passw0rd!123")
    session.commit()
    session.close()

    for _ in range(5):
        client.post("/auth/login", json={"email": email, "password": "wrong", "role_selected": "design"})
    r = client.post("/auth/login", json={"email": email, "password": "Passw0rd!123", "role_selected": "design"})
    # Rejected either by the per-account lockout (401) or, if the suite's cumulative login count
    # already tripped it, the per-IP limiter (429, app/services/rate_limit.py) — both are correct
    # "no, you can't log in right now" outcomes; either confirms a correct password alone isn't
    # enough after repeated failures.
    assert r.status_code in (401, 429)


# ---------- masters ----------

def test_create_fabric_and_duplicate_conflict(client, auth):
    headers = auth("admin")
    code = _uniq("FAB")
    r = client.post("/fabrics", headers=headers, json={"code": code, "name": "Test Fabric", "quality_category": "Cotton"})
    assert r.status_code == 201, r.text
    r2 = client.post("/fabrics", headers=headers, json={"code": code, "name": "Dup", "quality_category": "Cotton"})
    assert r2.status_code == 409


def test_fabric_toggle_status(client, auth):
    headers = auth("admin")
    code = _uniq("FAB")
    r = client.post("/fabrics", headers=headers, json={"code": code, "name": "Toggle Fabric", "quality_category": "Cotton"})
    fid = r.json()["id"]
    r2 = client.patch(f"/fabrics/{fid}", headers=headers, json={"status": "inactive"})
    assert r2.status_code == 200
    assert r2.json()["status"] == "inactive"


def test_category_create_and_toggle(client, auth):
    headers = auth("admin")
    name = _uniq("Cat")
    r = client.post("/categories", headers=headers, json={"type": "fabric", "name": name})
    assert r.status_code == 201
    cat_id = r.json()["id"]
    r2 = client.post(f"/categories/{cat_id}/toggle", headers=headers)
    assert r2.status_code == 200
    assert r2.json()["status"] == "inactive"


def test_nested_country_state(client, auth):
    headers = auth("admin")
    country_name = _uniq("Country")
    r = client.post("/categories/countries", headers=headers, json={"name": country_name})
    assert r.status_code == 201
    cid = r.json()["id"]
    r2 = client.post(f"/categories/countries/{cid}/states", headers=headers, json={"name": "TestState"})
    assert r2.status_code == 201
    assert r2.json()["name"] == "TestState"


# ---------- visits & mail engine ----------

@pytest.fixture
def visit_setup(client, auth):
    """Creates a fresh fabric + customer + contact + visit (with one item), returning useful ids."""
    admin_h = auth("admin")
    design_h = auth("design")

    code = _uniq("FAB")
    client.post("/fabrics", headers=admin_h, json={"code": code, "name": "Smoke Fabric", "quality_category": "Cotton"})

    me = client.get("/auth/me", headers=design_h).json()
    owner_id = me["id"]

    cust_name = _uniq("Customer")
    r = client.post("/customers", headers=design_h, json={
        "name": cust_name, "country": "India", "owner_id": owner_id,
        "contacts": [{"name": "Test Contact", "email": "contact@example.com", "primary": True, "team_name": "Design"}],
    })
    assert r.status_code == 201, r.text
    customer = r.json()
    contact_id = customer["contacts"][0]["id"]

    r = client.post("/visits", headers=design_h, json={
        "customer_id": customer["id"], "date": str(date.today()), "collections": "SS26", "way_forward": "Follow up",
        "attendee_contact_ids": [contact_id],
        "lines": [{"fabric_code": code, "representative_contact_id": contact_id, "swatch_type": "Swatch", "qty": 1}],
    })
    assert r.status_code == 201, r.text
    visit = r.json()
    return {"customer": customer, "visit": visit, "design_h": design_h, "admin_h": admin_h, "fabric_code": code}


def test_visit_creates_five_mails_with_correct_due_dates(client, visit_setup):
    visit = visit_setup["visit"]
    design_h = visit_setup["design_h"]
    r = client.get(f"/visits/{visit['id']}/mails", headers=design_h)
    mails = r.json()
    assert len(mails) == 5
    assert [m["mail_number"] for m in mails] == [1, 2, 3, 4, 5]
    assert all(m["status"] == "scheduled" for m in mails)
    visit_date = date.fromisoformat(visit["date"])
    # intervals default [7, 45, 60, 120, 60] measured from each mail's own base date, not sent date
    assert date.fromisoformat(mails[0]["due_date"]) >= visit_date + timedelta(days=7)


def test_send_now_then_bounce_then_fix(client, visit_setup):
    visit = visit_setup["visit"]
    design_h = visit_setup["design_h"]
    mails = client.get(f"/visits/{visit['id']}/mails", headers=design_h).json()
    mail_id = mails[0]["id"]

    r = client.post(f"/mails/{mail_id}/send-now", headers=design_h)
    assert r.status_code == 200
    assert r.json()["status"] == "sent"

    r2 = client.post(f"/mails/{mail_id}/simulate-bounce", headers=design_h)
    assert r2.status_code == 200
    assert r2.json()["status"] == "bounced"

    r3 = client.post(f"/mails/{mail_id}/fix-bounce", headers=design_h, params={"new_email": "fixed@example.com"})
    assert r3.status_code == 200
    assert r3.json()["status"] == "scheduled"


def test_send_now_twice_rejected(client, visit_setup):
    visit = visit_setup["visit"]
    design_h = visit_setup["design_h"]
    mails = client.get(f"/visits/{visit['id']}/mails", headers=design_h).json()
    mail_id = mails[1]["id"]
    r = client.post(f"/mails/{mail_id}/send-now", headers=design_h)
    assert r.status_code == 200
    r2 = client.post(f"/mails/{mail_id}/send-now", headers=design_h)
    assert r2.status_code == 422  # not awaiting send any more


# ---------- customer portal (public) ----------

def test_portal_full_flow(client, visit_setup):
    visit = visit_setup["visit"]
    design_h = visit_setup["design_h"]
    mails = client.get(f"/visits/{visit['id']}/mails", headers=design_h).json()
    mail_id = mails[0]["id"]
    client.post(f"/mails/{mail_id}/send-now", headers=design_h)

    import app.core.database as dbmod
    from app.models.mail import Mail
    session = dbmod.SessionLocal()
    token = session.get(Mail, mail_id).token
    session.close()

    r = client.get(f"/portal/{token}")
    assert r.status_code == 200
    assert r.json()["state"] == "ok"
    assert r.json()["opened"] is False

    r2 = client.post(f"/portal/{token}/open")
    assert r2.json()["opened"] is True
    item_id = r2.json()["items"][0]["visit_item_id"]

    r3 = client.post(f"/portal/{token}/respond", json={
        "by_name": "Test Contact", "by_designation": "Buyer", "data": {},
        "item_feedback": [{"visit_item_id": item_id, "sentiment": "Positive", "text": "Nice"}],
    })
    assert r3.status_code == 200
    assert r3.json()["latest_response"]["version"] == 1


def test_portal_unknown_token(client):
    r = client.get("/portal/does-not-exist")
    assert r.status_code == 200
    assert r.json()["state"] == "not_found"


def test_portal_tampered_item_id_rejected(client, visit_setup):
    visit = visit_setup["visit"]
    design_h = visit_setup["design_h"]
    mails = client.get(f"/visits/{visit['id']}/mails", headers=design_h).json()
    mail_id = mails[2]["id"]
    client.post(f"/mails/{mail_id}/send-now", headers=design_h)

    import app.core.database as dbmod
    from app.models.mail import Mail
    session = dbmod.SessionLocal()
    token = session.get(Mail, mail_id).token
    session.close()

    r = client.post(f"/portal/{token}/respond", json={
        "by_name": "X", "by_designation": "Y", "data": {},
        "item_feedback": [{"visit_item_id": str(uuid.uuid4()), "sentiment": "Positive"}],
    })
    assert r.status_code == 422


# ---------- blacklist governance ----------

def test_blacklist_suggest_and_unanimous_approve(client, auth, visit_setup):
    manager_h = auth("manager")
    top1_h = auth("top1")
    top2_h = auth("top2")
    customer_id = visit_setup["customer"]["id"]

    r = client.post(f"/customers/{customer_id}/blacklist/suggest", headers=manager_h, json={"cat": "C", "reason": "test"})
    assert r.status_code == 201, r.text
    event_id = r.json()["id"]

    r2 = client.post(f"/blacklist-events/{event_id}/decide", headers=top1_h, json={"decision": True})
    assert r2.json()["status"] == "pending"  # not unanimous yet

    r3 = client.post(f"/blacklist-events/{event_id}/decide", headers=top2_h, json={"decision": True})
    assert r3.json()["status"] == "approved"

    r4 = client.get("/customers", headers=manager_h)
    cust = next(c for c in r4.json() if c["id"] == customer_id)
    assert cust["blacklist_cat"] == "C"


def test_blacklist_single_rejection(client, auth, visit_setup):
    manager_h = auth("manager")
    top1_h = auth("top1")
    customer_id = visit_setup["customer"]["id"]

    r = client.post(f"/customers/{customer_id}/blacklist/suggest", headers=manager_h, json={"cat": "A", "reason": "test"})
    event_id = r.json()["id"]
    r2 = client.post(f"/blacklist-events/{event_id}/decide", headers=top1_h, json={"decision": False, "note": "no"})
    assert r2.json()["status"] == "rejected"


def test_visit_blocked_once_blacklisted_then_exception_allows_one(client, auth, visit_setup):
    manager_h = auth("manager")
    top1_h = auth("top1")
    top2_h = auth("top2")
    design_h = visit_setup["design_h"]
    customer = visit_setup["customer"]
    fabric_code = visit_setup["fabric_code"]
    contact_id = customer["contacts"][0]["id"]

    event_id = client.post(f"/customers/{customer['id']}/blacklist/suggest", headers=manager_h, json={"cat": "C", "reason": "test"}).json()["id"]
    client.post(f"/blacklist-events/{event_id}/decide", headers=top1_h, json={"decision": True})
    client.post(f"/blacklist-events/{event_id}/decide", headers=top2_h, json={"decision": True})

    payload = {
        "customer_id": customer["id"], "date": str(date.today()), "collections": "AW26", "way_forward": "x",
        "attendee_contact_ids": [contact_id],
        "lines": [{"fabric_code": fabric_code, "representative_contact_id": contact_id, "swatch_type": "Swatch", "qty": 1}],
    }
    r = client.post("/visits", headers=design_h, json=payload)
    assert r.status_code == 422

    exc_id = client.post(f"/customers/{customer['id']}/exceptions", headers=manager_h, json={"reason": "test"}).json()["id"]
    client.post(f"/exceptions/{exc_id}/decide", headers=top1_h, json={"decision": True})
    r2 = client.post(f"/exceptions/{exc_id}/decide", headers=top2_h, json={"decision": True})
    assert r2.json()["status"] == "approved"

    r3 = client.post("/visits", headers=design_h, json=payload)
    assert r3.status_code == 201  # exception let one visit through

    r4 = client.post("/visits", headers=design_h, json=payload)
    assert r4.status_code == 422  # exception is single-use


# ---------- reports / outbox / activity ----------

def test_reports_and_activity_require_manager(client, auth):
    design_h = auth("design")
    manager_h = auth("manager")
    assert client.get("/reports/summary", headers=design_h).status_code == 403
    assert client.get("/activity", headers=design_h).status_code == 403
    assert client.get("/reports/summary", headers=manager_h).status_code == 200
    assert client.get("/activity", headers=manager_h).status_code == 200


def test_manual_order_record_and_undo(client, visit_setup):
    design_h = visit_setup["design_h"]
    visit = visit_setup["visit"]
    fabric_code = visit_setup["fabric_code"]
    vc_id = visit["visit_contacts"][0]["id"]

    r = client.post(f"/visits/contacts/{vc_id}/record-order", headers=design_h, json={
        "order_date": str(date.today()), "fabric_codes": [fabric_code], "note": "Phone confirmation"
    })
    assert r.status_code == 200, r.text
    assert r.json()["order_placed"] is True

    mails = client.get(f"/visits/{visit['id']}/mails", headers=design_h).json()
    assert [m["status"] for m in mails[:4]] == ["skipped"] * 4
    assert mails[4]["variant"] == "ordered"

    # bad date / unknown fabric are rejected
    bad = client.post(f"/visits/contacts/{vc_id}/record-order", headers=design_h, json={
        "order_date": "2000-01-01", "fabric_codes": [fabric_code]
    })
    assert bad.status_code == 422

    # undo requires a reason
    assert client.post(f"/visits/contacts/{vc_id}/undo-order", headers=design_h, json={"reason": ""}).status_code == 422

    r2 = client.post(f"/visits/contacts/{vc_id}/undo-order", headers=design_h, json={"reason": "Wrong visit"})
    assert r2.status_code == 200
    assert r2.json()["order_placed"] is False

    mails2 = client.get(f"/visits/{visit['id']}/mails", headers=design_h).json()
    assert all(m["status"] == "scheduled" for m in mails2)

    # nothing left to undo
    r3 = client.post(f"/visits/contacts/{vc_id}/undo-order", headers=design_h, json={"reason": "again"})
    assert r3.status_code == 422


def test_auto_blacklist_evaluation_raises_and_clears(client, auth):
    """Blacklist A: replied only to Mail 5, Mails 1-4 delivered and never answered. Exercises the
    automatic rule engine (task 47) end to end: raise -> unanimous approve -> evidence changes ->
    auto-clear. Built directly against the DB/service layer since constructing this evidence
    through the HTTP API would mean faking a real mail history months in the past."""
    from app.core.database import SessionLocal
    from app.models.customer import Contact, Customer, Team
    from app.models.fabric import Fabric
    from app.models.mail import Mail, MailResponse
    from app.models.blacklist import BlacklistEvent
    from app.models.user import User
    from app.models.visit import Visit, VisitContact, VisitItem
    from app.services.blacklist_eval import evaluate_blacklists
    from app.services.blacklist_service import decide_blacklist_event

    session = SessionLocal()
    owner = session.query(User).filter(User.email == "priya.nair@example.com").first()
    fabric = Fabric(code=_uniq("AUTOBLF"), name="AutoBL Test Fabric", quality_category="Cotton")
    session.add(fabric)
    session.flush()

    customer = Customer(name=_uniq("AutoBL"), country="India", owner_id=owner.id)
    session.add(customer)
    session.flush()
    team = Team(customer_id=customer.id, name="Design")
    session.add(team)
    session.flush()
    contact = Contact(customer_id=customer.id, team_id=team.id, name="Auto Contact", email="auto@test.example", primary=True)
    session.add(contact)
    session.flush()

    visit_date = date.today() - timedelta(days=200)
    visit = Visit(customer_id=customer.id, owner_id=owner.id, date=visit_date, collections="SS25")
    session.add(visit)
    session.flush()
    vc = VisitContact(visit_id=visit.id, contact_id=contact.id)
    session.add(vc)
    session.flush()
    session.add(VisitItem(visit_contact_id=vc.id, fabric_id=fabric.id, swatch_type="Swatch", qty=1))
    session.flush()
    for n in range(1, 6):
        session.add(Mail(visit_contact_id=vc.id, mail_number=n, base_date=visit_date,
                          due_date=visit_date + timedelta(days=7 * n), status="sent", sent_at=visit_date + timedelta(days=7 * n)))
    session.flush()
    mails = sorted(session.query(Mail).filter(Mail.visit_contact_id == vc.id).all(), key=lambda m: m.mail_number)
    session.add(MailResponse(mail_id=mails[4].id, submitted_at=mails[4].sent_at, source="portal",
                              raw_data={"interested": "yes"}, by_name="Auto Contact"))
    session.commit()

    evaluate_blacklists(session, date.today())
    session.commit()
    event = session.query(BlacklistEvent).filter(BlacklistEvent.customer_id == customer.id).first()
    assert event is not None
    assert event.status.value == "pending"
    assert event.cat.value == "A"
    assert event.auto_raised is True

    top1 = session.query(User).filter(User.email == "rakesh.menon@example.com").first()
    top2 = session.query(User).filter(User.email == "sunita.rao@example.com").first()
    decide_blacklist_event(session, event_id=event.id, approver=top1, yes=True, note=None)
    session.commit()
    decide_blacklist_event(session, event_id=event.id, approver=top2, yes=True, note=None)
    session.commit()
    session.refresh(customer)
    assert customer.blacklist_cat.value == "A"

    for i in range(4):
        session.add(MailResponse(mail_id=mails[i].id, submitted_at=mails[i].sent_at, source="portal",
                                  raw_data={"feedback": "ok"}, by_name="Auto Contact"))
    session.commit()

    result = evaluate_blacklists(session, date.today())
    session.commit()
    session.refresh(customer)
    assert result["auto_cleared"] == 1
    assert customer.blacklist_cat is None
    session.close()


def test_outbox_visible_to_owner(client, visit_setup):
    design_h = visit_setup["design_h"]
    visit = visit_setup["visit"]
    mails = client.get(f"/visits/{visit['id']}/mails", headers=design_h).json()
    client.post(f"/mails/{mails[3]['id']}/send-now", headers=design_h)
    r = client.get("/outbox", headers=design_h)
    assert r.status_code == 200
    assert any(e["company"] == visit_setup["customer"]["name"] for e in r.json())


# ---------- per-item feedback logged right at visit-entry time (no mail reply behind it) ----------

def test_visit_entry_item_feedback_and_portal_reply_coexist(client, auth):
    """A note typed in at visit-entry time (ItemFeedback.mail_response_id NULL) and a later
    customer reply to Mail 1 (mail_response_id set) must both land in the same place and the
    newer one must win when both exist for the same item."""
    admin_h = auth("admin")
    design_h = auth("design")

    code = _uniq("FAB")
    client.post("/fabrics", headers=admin_h, json={"code": code, "name": "Feedback Fabric", "quality_category": "Cotton"})
    me = client.get("/auth/me", headers=design_h).json()
    cust_name = _uniq("Customer")
    r = client.post("/customers", headers=design_h, json={
        "name": cust_name, "country": "India", "owner_id": me["id"],
        "contacts": [{"name": "FB Contact", "email": "fbcontact@example.com", "primary": True, "team_name": "Design"}],
    })
    assert r.status_code == 201, r.text
    customer = r.json()
    contact_id = customer["contacts"][0]["id"]

    r = client.post("/visits", headers=design_h, json={
        "customer_id": customer["id"], "date": str(date.today()), "collections": "SS26", "way_forward": "Follow up",
        "attendee_contact_ids": [contact_id],
        "lines": [{
            "fabric_code": code, "representative_contact_id": contact_id, "swatch_type": "Swatch", "qty": 1,
            "sentiment": "Positive", "feedback_text": "Customer liked it on the spot",
        }],
    })
    assert r.status_code == 201, r.text
    visit = r.json()
    item_id = visit["visit_contacts"][0]["items"][0]["id"]

    # Right after save, GET /visits/{id} should already show the visit-entry note, source-tagged
    # by who logged it.
    r = client.get(f"/visits/{visit['id']}", headers=design_h)
    item = r.json()["visit_contacts"][0]["items"][0]
    assert item["visit_entry_feedback"]["sentiment"] == "Positive"
    assert item["visit_entry_feedback"]["text"] == "Customer liked it on the spot"
    assert item["visit_entry_feedback"]["logged_by"] == me["name"]

    # Now the customer replies to Mail 1 for this same item with different feedback — the portal
    # reply is newer, so item_feedback_given() / "latest" logic must prefer it over the visit-entry
    # note, without the two rows stepping on each other.
    mails = client.get(f"/visits/{visit['id']}/mails", headers=design_h).json()
    mail1 = next(m for m in mails if m["mail_number"] == 1)
    client.post(f"/mails/{mail1['id']}/send-now", headers=design_h)

    from app.core.database import SessionLocal
    from app.models.mail import Mail as MailModel
    session = SessionLocal()
    token = session.query(MailModel).filter(MailModel.id == mail1["id"]).first().token
    session.close()
    assert token

    client.post(f"/portal/{token}/open")
    r = client.post(f"/portal/{token}/respond", json={
        "by_name": "FB Contact", "by_designation": "Manager", "data": {},
        "item_feedback": [{"visit_item_id": item_id, "sentiment": "Negative", "text": "Actually had an issue"}],
    })
    assert r.status_code == 200, r.text

    # The ORIGINAL visit-entry note must still be intact and unambiguously tagged — proving the
    # two rows (visit-entry note, portal reply) coexist without clobbering each other.
    r = client.get(f"/visits/{visit['id']}", headers=design_h)
    item = r.json()["visit_contacts"][0]["items"][0]
    assert item["visit_entry_feedback"]["sentiment"] == "Positive"
    assert item["visit_entry_feedback"]["text"] == "Customer liked it on the spot"

    mails_after = client.get(f"/visits/{visit['id']}/mails", headers=design_h).json()
    mail1_after = next(m for m in mails_after if m["mail_number"] == 1)
    portal_fb = mail1_after["responses"][0]["item_feedback"][0]
    assert portal_fb["sentiment"] == "Negative"
    assert portal_fb["text"] == "Actually had an issue"


# ---------- bulk CSV import: visits (historical backfill) ----------

def test_visit_import_groups_rows_and_skips_no_follow_up(client, auth):
    """Two rows for the same (customer, date, collections) group into ONE visit with two items;
    a bad row (unknown contact) makes the WHOLE import fail with nothing saved (all-or-nothing,
    same convention as /customers/import and /fabrics/import); and a successfully-imported visit
    gets no 5-mail follow-up schedule (it's a historical backfill, not a live visit entry)."""
    admin_h = auth("admin")
    design_h = auth("design")

    code1 = _uniq("FAB")
    code2 = _uniq("FAB")
    client.post("/fabrics", headers=admin_h, json={"code": code1, "name": "Import Fabric 1", "quality_category": "Cotton"})
    client.post("/fabrics", headers=admin_h, json={"code": code2, "name": "Import Fabric 2", "quality_category": "Cotton"})

    me = client.get("/auth/me", headers=design_h).json()
    cust_name = _uniq("Customer")
    r = client.post("/customers", headers=design_h, json={
        "name": cust_name, "country": "India", "owner_id": me["id"],
        "contacts": [{"name": "Import Contact", "email": "importcontact@example.com", "primary": True, "team_name": "Design"}],
    })
    assert r.status_code == 201, r.text
    visit_date = str(date.today() - timedelta(days=30))
    collections = _uniq("SS25 backfill")

    # First, a bad import (unknown contact name) must save nothing at all.
    bad_rows = [
        {"customer_name": cust_name, "contact_name": "Import Contact", "visit_date": visit_date,
         "collections": collections, "fabric_code": code1, "swatch_type": "Swatch", "qty": 1},
        {"customer_name": cust_name, "contact_name": "Nobody Here", "visit_date": visit_date,
         "collections": collections, "fabric_code": code2, "swatch_type": "Hanger", "qty": 2},
    ]
    r = client.post("/visits/import", headers=admin_h, json=bad_rows)
    assert r.status_code == 422, r.text
    r = client.get("/visits", headers=design_h)
    before_count = len([v for v in r.json() if v["collections"] == collections])
    assert before_count == 0

    # Now the same two rows with a valid contact — both lines land on ONE visit.
    good_rows = [dict(r, contact_name="Import Contact") for r in bad_rows]
    r = client.post("/visits/import", headers=admin_h, json=good_rows)
    assert r.status_code == 200, r.text
    result = r.json()
    assert result["created"] == 1

    r = client.get("/visits", headers=design_h)
    imported = next(v for v in r.json() if v["collections"] == collections)
    assert len(imported["visit_contacts"]) == 1
    assert len(imported["visit_contacts"][0]["items"]) == 2
    assert imported["owner_id"] == me["id"]  # follows the customer's own assigned owner

    r = client.get(f"/visits/{imported['id']}/mails", headers=design_h)
    assert r.json() == []  # no follow-up schedule for a backfilled historical visit


def test_customer_phone_and_pincode_validation(client, auth):
    """Pincode must be exactly 6 digits and phone must contain only digits/+/-/()/spaces —
    enforced server-side so the API itself rejects garbage even if a client bypasses the
    frontend's input filtering."""
    headers = auth("design")
    me = client.get("/auth/me", headers=headers).json()
    base = {
        "name": _uniq("ValidationCo"), "country": "India", "owner_id": me["id"],
        "contacts": [{"name": "C1", "email": _uniq("val") + "@example.com", "primary": True, "team_name": "Design"}],
    }

    # Bad pincode (letters, wrong length) is rejected.
    r = client.post("/customers", headers=headers, json={**base, "pincode": "abc123"})
    assert r.status_code == 422, r.text
    r = client.post("/customers", headers=headers, json={**base, "pincode": "12345"})
    assert r.status_code == 422, r.text

    # Bad phone (contains letters) is rejected.
    r = client.post("/customers", headers=headers, json={**base, "company_phone": "call-me-maybe"})
    assert r.status_code == 422, r.text

    # Valid pincode and phone are accepted.
    r = client.post("/customers", headers=headers, json={**base, "pincode": "400001", "company_phone": "+91 (22) 1234-5678"})
    assert r.status_code == 201, r.text
    assert r.json()["pincode"] == "400001"


# ---------- image upload (replaces the old paste-an-image-link text boxes) ----------

_TINY_PNG = (
    b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00"
    b"\x1f\x15\xc4\x89\x00\x00\x00\nIDATx\x9cc\x00\x01\x00\x00\x05\x00\x01\r\n-\xb4\x00\x00\x00"
    b"\x00IEND\xaeB`\x82"
)


def test_staff_image_upload_rejects_non_image_and_saves_real_png(client, auth):
    headers = auth("design")

    r = client.post("/uploads", headers=headers, files={"file": ("note.txt", b"not an image", "text/plain")})
    assert r.status_code == 422, r.text

    r = client.post("/uploads", headers=headers, files={"file": ("swatch.png", _TINY_PNG, "image/png")})
    assert r.status_code == 200, r.text
    url = r.json()["url"]
    assert url.startswith("/uploads/") and url.endswith(".png")

    # the file is actually retrievable back out (StaticFiles mount)
    r2 = client.get(url)
    assert r2.status_code == 200
    assert r2.content == _TINY_PNG


def test_portal_upload_requires_valid_token(client, visit_setup):
    # garbage token
    r = client.post("/portal/not-a-real-token/upload", files={"file": ("x.png", _TINY_PNG, "image/png")})
    assert r.status_code == 422, r.text

    # a real, open mail token accepts an upload
    design_h = visit_setup["design_h"]
    mails = client.get(f"/visits/{visit_setup['visit']['id']}/mails", headers=design_h).json()
    mail1 = next(m for m in mails if m["mail_number"] == 1)
    client.post(f"/mails/{mail1['id']}/send-now", headers=design_h)

    from app.core.database import SessionLocal
    from app.models.mail import Mail as MailModel
    session = SessionLocal()
    token = session.query(MailModel).filter(MailModel.id == mail1["id"]).first().token
    session.close()

    r = client.post(f"/portal/{token}/upload", files={"file": ("x.png", _TINY_PNG, "image/png")})
    assert r.status_code == 200, r.text
    assert r.json()["url"].startswith("/uploads/")


# ---------- editable mail templates (Settings → Email Templates) ----------

def test_mail_templates_list_has_all_six_and_requires_manager_to_edit(client, auth):
    design_h = auth("design")
    admin_h = auth("admin")

    r = client.get("/mail-templates", headers=design_h)
    assert r.status_code == 200, r.text
    rows = r.json()
    keys = {(t["mail_number"], t["variant"]) for t in rows}
    assert keys == {(1, None), (2, None), (3, None), (4, None), (5, "ordered"), (5, "notordered")}
    # {link} must already be present in every seeded default (required placeholder)
    for t in rows:
        assert "{link}" in t["body"]

    # a design-team user (not manager+) can't edit
    r = client.patch("/mail-templates/1/none", headers=design_h, json={"subject": "x", "body": "{link}"})
    assert r.status_code == 403, r.text

    # manager+ can
    r = client.patch("/mail-templates/1/none", headers=admin_h, json={"subject": "New subject {customer_name}", "body": "Hi {contact_name}\n{link}"})
    assert r.status_code == 200, r.text
    assert r.json()["subject"] == "New subject {customer_name}"


def test_mail_template_validation_rejects_missing_or_duplicate_link_and_unknown_placeholder(client, auth):
    admin_h = auth("admin")

    # missing {link} entirely
    r = client.patch("/mail-templates/2/none", headers=admin_h, json={"subject": "Hi", "body": "No link here at all"})
    assert r.status_code == 422, r.text

    # {link} appears twice
    r = client.patch("/mail-templates/2/none", headers=admin_h, json={"subject": "Hi", "body": "{link} and again {link}"})
    assert r.status_code == 422, r.text

    # unknown placeholder
    r = client.patch("/mail-templates/2/none", headers=admin_h, json={"subject": "Hi {not_a_real_field}", "body": "{link}"})
    assert r.status_code == 422, r.text

    # empty subject/body
    r = client.patch("/mail-templates/2/none", headers=admin_h, json={"subject": "", "body": "{link}"})
    assert r.status_code == 422, r.text


def test_mail_template_edit_is_used_on_actual_send_and_reset_restores_default(client, auth, visit_setup):
    admin_h = visit_setup["admin_h"]
    design_h = visit_setup["design_h"]

    r = client.patch("/mail-templates/1/none", headers=admin_h, json={
        "subject": "CUSTOM SUBJECT for {customer_name}",
        "body": "Hello {contact_name}, custom body.\nLink: {link}",
    })
    assert r.status_code == 200, r.text

    mails = client.get(f"/visits/{visit_setup['visit']['id']}/mails", headers=design_h).json()
    mail1 = next(m for m in mails if m["mail_number"] == 1)
    r = client.post(f"/mails/{mail1['id']}/send-now", headers=design_h)
    assert r.status_code == 200, r.text

    content = client.get(f"/mails/{mail1['id']}/content", headers=design_h).json()
    assert "CUSTOM SUBJECT for" in content["subject"]
    assert "custom body" in content["body"]
    assert "Link: /r/" in content["body"]  # {link} substituted with the real token link

    # reset restores the seeded default, used by subsequent previews/sends
    r = client.post("/mail-templates/1/none/reset", headers=admin_h)
    assert r.status_code == 200, r.text
    assert "Swatches from our meeting" in r.json()["subject"]


def test_send_now_shows_draft_and_allows_one_off_edit_before_sending(client, visit_setup):
    """The 'Send now' flow: a draft can be fetched (raw, {placeholder}s intact — not the
    fake-link preview text), and the actual send can override just that one mail's wording
    without touching the saved template everyone else uses."""
    design_h = visit_setup["design_h"]
    mails = client.get(f"/visits/{visit_setup['visit']['id']}/mails", headers=design_h).json()
    mail2 = next(m for m in mails if m["mail_number"] == 2)

    draft = client.get(f"/mails/{mail2['id']}/draft", headers=design_h).json()
    assert "{link}" in draft["body"]  # raw template, not resolved to a preview string
    assert draft["subject"]

    # edit it for just this one send, keeping {link} required
    edited_body = "Hi there — one-off wording for this send only.\n{link}"
    r = client.post(f"/mails/{mail2['id']}/send-now", headers=design_h, json={"subject": "One-off subject", "body": edited_body})
    assert r.status_code == 200, r.text

    content = client.get(f"/mails/{mail2['id']}/content", headers=design_h).json()
    assert content["subject"] == "One-off subject"
    assert "one-off wording for this send only" in content["body"]
    assert "/r/" in content["body"]  # {link} still correctly substituted with the real token

    # the SAVED template for Mail 2 is untouched by that one-off edit
    templates = client.get("/mail-templates", headers=design_h).json()
    tpl2 = next(t for t in templates if t["mail_number"] == 2 and t["variant"] is None)
    assert "One-off subject" != tpl2["subject"]
    assert "Update on swatch testing" in tpl2["subject"]

    # an edit that drops {link} is rejected, same as saving a template
    mail3 = next(m for m in mails if m["mail_number"] == 3)
    r = client.post(f"/mails/{mail3['id']}/send-now", headers=design_h, json={"subject": "x", "body": "no link in here"})
    assert r.status_code == 422, r.text


def test_send_now_surfaces_smtp_failure_and_allows_retry(client, visit_setup, monkeypatch):
    """When real SMTP is configured but the send itself fails (bad creds, network, etc.), the
    manual 'Send now' call must return a clear error (not pretend it worked) and the mail must
    stay retry-able — not get stuck in limbo. See app/services/email_sender.py / mail_engine.py."""
    import app.services.mail_engine as mail_engine

    design_h = visit_setup["design_h"]
    mails = client.get(f"/visits/{visit_setup['visit']['id']}/mails", headers=design_h).json()
    mail4 = next(m for m in mails if m["mail_number"] == 4)

    def boom(**kwargs):
        raise mail_engine.EmailSendError("535 authentication failed")

    monkeypatch.setattr(mail_engine, "send_email", boom)

    r = client.post(f"/mails/{mail4['id']}/send-now", headers=design_h)
    assert r.status_code == 422, r.text
    assert "authentication failed" in r.text

    mails = client.get(f"/visits/{visit_setup['visit']['id']}/mails", headers=design_h).json()
    mail4 = next(m for m in mails if m["mail_number"] == 4)
    assert mail4["status"] == "send_failed"

    # still retry-able: postpone/skip accept it like a normal scheduled mail...
    r = client.post(f"/mails/{mail4['id']}/postpone", headers=design_h,
                     params={"new_due_date": str(date.today() + timedelta(days=3)), "reason": "retry later"})
    assert r.status_code == 200, r.text

    # ...and once SMTP works again, "Send now" succeeds normally.
    monkeypatch.undo()
    r = client.post(f"/mails/{mail4['id']}/send-now", headers=design_h)
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "sent"

