"""One-off data import: the new "Genimode" company, its 6 contacts, and 3 historical visits
(157 sort-no. lines total), sourced from the client's Genimode_Selection.xlsx and confirmed with
Urvish turn-by-turn in chat on 2026-11-26:

  - Company: Genimode (new) — owner = the admin user named below.
  - Contacts (new, no email on file yet — add later under Customers > Genimode if/when known):
    Sarabjeet, Ankita Shukla, Abhishek Kumar, Abhishek Garg, Shubham, Neeru Vasisth.
  - 3 visits, all "AW 27-28 preview", all Hanger / qty 1:
      26/11/2026 — Sarabjeet (29 items), Ankita Shukla (26 items)
      20/11/2026 — Abhishek Kumar (22 items), Abhishek Garg (31 items) + Shubham (attendee only,
                   no items of his own — he and Abhishek Garg were shown the SAME combined list in
                   the source sheet; only Abhishek Garg gets the 5-mail follow-up for these, same
                   as the live New Visit Entry form would do for a line with one representative)
      15/11/2026 — Neeru Vasisth (49 items)

Deliberately uses the SAME code path as a live New Visit Entry save (Visit/VisitContact/VisitItem
+ create_mails for every attendee who actually received items) rather than the bulk CSV importer,
specifically so the real 5-mail follow-up schedule gets created — the CSV importer is for
backfilling purely historical visits and intentionally skips that.

Idempotent in the two ways that matter for a script you might need to re-run after fixing a typo:
  - the Genimode customer and each of the 6 contacts are get-or-create by name, never duplicated;
  - a visit is skipped (not duplicated) if one already exists for this customer on the same date
    with the same collections text.
It is NOT idempotent against partial success for an individual visit's items — if you need to
re-run after a crash partway through one visit, delete that one visit first (cascades to its
contacts/items/mails) rather than re-running as-is.

All fabric codes are validated as existing + active BEFORE anything is written. Per Urvish's
explicit decision on 2026-11-26 ("Skip these lines, import the rest now"), a missing/inactive
code is NOT fatal: that one line is skipped for its person and everything else is still created.
The script prints the full list of skipped codes and each attendee's before/after item count so
you can see exactly what went in and add/activate the skipped codes in Item Master later if the
client wants them added as a correction.

Run once, against the real database:
    cd /var/www/abg-customer/backend
    source venv/bin/activate
    python3 -m scripts.import_genimode_visits
"""
from datetime import date

from sqlalchemy import select

from app.core.database import SessionLocal
from app.models.customer import Contact, Customer
from app.models.fabric import Fabric
from app.models.user import User
from app.models.visit import Visit, VisitContact, VisitItem
from app.services.mail_engine import create_mails
from app.services.settings_service import get_settings

OWNER_NAME_ILIKE = "%abhishek%"  # the admin account Urvish confirmed as owner

SORT_NOS = {
    "Sarabjeet": ["KD1376", "KD1388", "KD1390", "KD1385", "OS4104", "OSK1243B", "KD1391", "KD1374",
                  "OS4099", "DM1015", "OS4113", "OS4076", "OS4067", "SH1234", "OS4097", "ST988",
                  "OS4085", "OS4121", "OS3947", "OS4024", "OS4109", "DM1004", "OS4068", "OS4018",
                  "SH1243", "OS4106", "OS4107", "OS4111", "SH1233"],
    "Ankita Shukla": ["SH1243", "OS4108", "OSK1228", "OS4018", "OS4068", "SH1233", "OS4111",
                       "OS4090", "OSK1232", "OS4107", "OS4106", "DM1004", "OSK1251", "K2514DM983",
                       "OS4066", "OS4099", "OS4096", "OS4109", "KD1385", "KD1390", "KD1391",
                       "OS4099", "OS4076", "OS4085", "OS4121", "OS3947"],
    "Abhishek Kumar": ["OS4100", "ST991", "DM1016", "KD1381", "OSK1238", "OS4094", "KD1210",
                        "ST984", "OS4092", "OS4026", "K2515", "OS4091", "OSK1228", "OS4108",
                        "OSK1232", "OS4090", "ST986", "KD1377", "KD1375", "SH1233", "OS4111",
                        "DM1004"],
    "Abhishek Garg": ["OS4105", "OS4095", "OS4102", "ST992", "OS3678", "OS4026MW", "SH1080",
                       "OSK1243A", "OS4063", "SH1230", "SH1229", "DM1014", "OS3545", "OSK1240",
                       "OSK1239", "OSK1241", "OS4062MW", "OS4062", "OS4093", "OSK1235", "K2516",
                       "OSK1237", "SH1234", "OS4067", "OS4113", "OSK1243B", "KD1319", "OS4092",
                       "OS4108", "OSK1238", "OS4107"],
    "Neeru Vasisth": ["DM1017", "KD1383", "OS4075", "OS4062", "OS4086", "OS4098", "OSK1237",
                       "OS4067", "OS4092", "OS4108", "OS4106", "OS4017", "K2515", "ST984", "SH1233",
                       "KD1375", "DM1016", "ST991", "OS4100", "OSK1229", "OS4105", "ST992", "ST989",
                       "OS4023", "OS4022", "OS4020", "OS4021", "DM1015", "ST988", "OS4097", "DM1013",
                       "SH1235", "OSK1240", "OSK1241", "SH1242", "SH1241", "OS4016", "OS4093",
                       "OSK1235", "DM983", "K2514", "OS4066", "OS4096", "SH1232", "OS4087",
                       "KD1392", "OS4076", "OS4099", "KD1374"],
}

COLLECTIONS = "AW 27-28 preview"
SWATCH_TYPE = "Hanger"
QTY = 1

# (visit_date, [(attendee_name, has_own_items), ...])
VISITS = [
    (date(2026, 11, 26), [("Sarabjeet", True), ("Ankita Shukla", True)]),
    (date(2026, 11, 20), [("Abhishek Kumar", True), ("Abhishek Garg", True), ("Shubham", False)]),
    (date(2026, 11, 15), [("Neeru Vasisth", True)]),
]


def get_or_create_customer(db, owner: User) -> Customer:
    c = db.scalar(select(Customer).where(Customer.name.ilike("Genimode")))
    if c:
        print(f"Using existing customer: {c.name} ({c.id})")
        return c
    c = Customer(name="Genimode", owner_id=owner.id)
    db.add(c)
    db.flush()
    print(f"Created customer: {c.name} ({c.id})")
    return c


def get_or_create_contact(db, customer: Customer, name: str) -> Contact:
    existing = next((x for x in customer.contacts if x.name.strip().lower() == name.strip().lower()), None)
    if existing:
        print(f"  Using existing contact: {name}")
        return existing
    ct = Contact(customer_id=customer.id, name=name)
    db.add(ct)
    db.flush()
    customer.contacts.append(ct)
    print(f"  Created contact: {name}")
    return ct


def main():
    db = SessionLocal()
    try:
        matches = db.scalars(select(User).where(User.name.ilike(OWNER_NAME_ILIKE))).all()
        if len(matches) != 1:
            if not matches:
                print(f"ABORTED: no user matching name ILIKE '{OWNER_NAME_ILIKE}'.")
            else:
                print(f"ABORTED: {len(matches)} users match '{OWNER_NAME_ILIKE}', ambiguous:")
                for m in matches:
                    print(f"  - {m.name} <{m.email}> ({m.id})")
            print("Edit OWNER_NAME_ILIKE at the top of this script to match exactly one user "
                  "(their full name or email works too), then re-run.")
            return
        owner = matches[0]
        print(f"Owner: {owner.name} <{owner.email}> ({owner.id})")

        # Validate every fabric code up front. Per Urvish's explicit choice on 2026-11-26 ("Skip
        # these lines, import the rest now"), a missing/inactive code is SKIPPED — that one line
        # is left out of its person's visit — rather than aborting the whole import. Collected here
        # so SORT_NOS can be filtered down before anything is written.
        all_codes = sorted({code for codes in SORT_NOS.values() for code in codes})
        fabrics_by_code = {}
        missing = []
        for code in all_codes:
            f = db.scalar(select(Fabric).where(Fabric.code == code))
            if not f:
                missing.append(code)
            elif str(f.status).split(".")[-1].lower() != "active":
                missing.append(f"{code} (inactive)")
            else:
                fabrics_by_code[code] = f
        if missing:
            print(f"{len(missing)} of {len(all_codes)} sort no.'s are missing or inactive in the "
                  f"Item Master — these lines are SKIPPED (not imported), everything else proceeds:")
            for m in missing:
                print(f"  - {m}")
        for name in SORT_NOS:
            kept = [c for c in SORT_NOS[name] if c in fabrics_by_code]
            if len(kept) != len(SORT_NOS[name]):
                print(f"  {name}: {len(SORT_NOS[name])} -> {len(kept)} items after skipping missing codes")
            SORT_NOS[name] = kept
        print(f"{len(fabrics_by_code)} of {len(all_codes)} distinct sort no.'s found and active — proceeding with those.")

        customer = get_or_create_customer(db, owner)
        settings = get_settings(db)

        created_visits = 0
        for visit_date, attendees in VISITS:
            dup = db.scalar(
                select(Visit).where(Visit.customer_id == customer.id, Visit.date == visit_date,
                                     Visit.collections == COLLECTIONS)
            )
            if dup:
                print(f"Skipping {visit_date} — a visit with this date+collections already exists ({dup.visit_code}).")
                continue

            visit = Visit(customer_id=customer.id, owner_id=owner.id, date=visit_date, collections=COLLECTIONS)
            db.add(visit)
            db.flush()
            print(f"Created visit {visit.visit_code} on {visit_date}")

            vc_by_name = {}
            for name, _ in attendees:
                contact = get_or_create_contact(db, customer, name)
                vc = VisitContact(visit_id=visit.id, contact_id=contact.id)
                db.add(vc)
                db.flush()
                vc_by_name[name] = vc

            for name, has_items in attendees:
                if not has_items:
                    continue
                vc = vc_by_name[name]
                for code in SORT_NOS[name]:
                    db.add(VisitItem(visit_contact_id=vc.id, fabric_id=fabrics_by_code[code].id,
                                      swatch_type=SWATCH_TYPE, qty=QTY))
                db.flush()
                create_mails(db, vc, settings)
                print(f"  {name}: {len(SORT_NOS[name])} items, 5-mail schedule created")

            created_visits += 1

        db.commit()
        print(f"\nDone. {created_visits} visit(s) created under Genimode ({customer.id}).")
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    main()
