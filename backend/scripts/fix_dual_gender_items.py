"""One-off data fix for the Gender field's change from multi-select to single-select (Urvish,
2026-11-26 — reverses the earlier "an item can be tagged both Men's and Women's" decision).

Finds every Fabric whose `gender` list currently has more than one value and collapses it down to
just one, defaulting to "Men's" when that's one of the tagged values, otherwise keeping whichever
single value was there. Prints every affected Sort No. so Urvish can flip any that should actually
be Women's-only by editing that item in the normal Item Master form.

Idempotent / safe to re-run: items already down to 0 or 1 gender values are left untouched and
don't print anything.

Run once, against the real database:
    cd /var/www/abg-customer/backend
    source venv/bin/activate
    python3 -m scripts.fix_dual_gender_items
"""
from sqlalchemy import select

from app.core.database import SessionLocal
from app.models.fabric import Fabric

PREFERRED_DEFAULT = "Men's"


def main():
    db = SessionLocal()
    try:
        fabrics = db.scalars(select(Fabric).where(Fabric.gender.isnot(None))).all()
        affected = [f for f in fabrics if f.gender and len(f.gender) > 1]
        if not affected:
            print("Nothing to fix — no items are currently tagged with more than one gender.")
            return

        print(f"{len(affected)} item(s) tagged with more than one gender — collapsing to one each:")
        for f in affected:
            before = list(f.gender)
            keep = PREFERRED_DEFAULT if PREFERRED_DEFAULT in before else before[0]
            f.gender = [keep]
            print(f"  {f.code}: {before} -> [{keep}]")

        db.commit()
        print(f"\nDone. {len(affected)} item(s) updated. Review the list above — if any should be "
              f"Women's instead of Men's, edit that item in the Item Master form and change it there.")
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    main()
