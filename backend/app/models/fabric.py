from sqlalchemy import Enum, Numeric, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.models.base import Timestamped, UUIDPk
from app.models.enums import StatusEnum


class Fabric(Base, UUIDPk, Timestamped):
    __tablename__ = "fabrics"

    code: Mapped[str] = mapped_column(String(40), nullable=False, unique=True, index=True)  # stored upper-case
    # Display name. No longer a column the Item Master form collects directly (the client's Item
    # Master sheet has no "name" column) — the API layer (schemas/fabric.py FabricCreate validator)
    # derives it from development_no, falling back to code, so this column is never blank and every
    # other screen that shows a fabric by name keeps working unchanged.
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    # Legacy D&D swatch category (Linen/Cotton/Viscose/... — categories(type='fabric').name). Made
    # nullable per the Item Master rebuild: this was never a column in the client's Excel sheet, so
    # it is no longer collected on new items, but existing rows and any code reading it elsewhere
    # (filters, reports) are unaffected — see scripts/migrate_item_master_fields.py.
    quality_category: Mapped[str | None] = mapped_column(String(100), nullable=True)
    composition: Mapped[str | None] = mapped_column(String(200), nullable=True)
    gsm: Mapped[float | None] = mapped_column(Numeric(8, 2), nullable=True)
    status: Mapped[StatusEnum] = mapped_column(Enum(StatusEnum, name="status_enum"), default=StatusEnum.active, nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    colour_variants: Mapped[str | None] = mapped_column(String(300), nullable=True)
    # References categories(type='supplier').name — master-backed as of the Item Master rebuild
    # (used to be free text). Kept as a plain string column (not a FK) to match every other
    # category reference in this codebase (quality_category, customer.category, VisitItem.color),
    # which are all soft references by name, never hard FKs, so deactivating/renaming a master
    # value never cascades or orphans existing rows.
    supplier: Mapped[str | None] = mapped_column(String(200), nullable=True)
    photo_url: Mapped[str | None] = mapped_column(String(500), nullable=True)

    # --- Item Master fields added to match the client's real AW 27-28 Commercial sheet ---
    # (see scripts/migrate_item_master_fields.py for the ALTER TABLE statements, and
    # scripts/import_item_master_excel.py for the one-off load of the 141 real rows)

    # Development No. — the sheet's own item reference, independent of our internal `code`
    # (Sort No.). Both exist on the sheet; `code` stays the unique lookup key used everywhere
    # else in this codebase (visit items, imports), `development_no` is shown alongside it.
    development_no: Mapped[str | None] = mapped_column(String(100), nullable=True)

    # Classification masters — all soft references by name (see `supplier` above for why).
    # gender/lapf_domestic/lapf_export are multi-select (e.g. an item tagged both Men's and
    # Women's, or sourced from several LAPF suppliers), stored as a JSON list of strings so no
    # join table is needed, consistent with Visit.presented_by elsewhere in this schema.
    gender: Mapped[list | None] = mapped_column(JSONB, nullable=True)  # categories(type='gender').name, multi
    season: Mapped[str | None] = mapped_column(String(100), nullable=True)  # categories(type='season').name
    story: Mapped[str | None] = mapped_column(String(100), nullable=True)  # categories(type='story').name
    fabric_category: Mapped[str | None] = mapped_column(String(100), nullable=True)  # categories(type='fabric_category').name — Woven/Knit
    fabric_type: Mapped[str | None] = mapped_column(String(100), nullable=True)  # categories(type='fabric_type').name
    print_type: Mapped[str | None] = mapped_column(String(100), nullable=True)  # categories(type='print_type').name
    lapf_domestic: Mapped[list | None] = mapped_column(JSONB, nullable=True)  # categories(type='supplier').name, multi
    lapf_export: Mapped[list | None] = mapped_column(JSONB, nullable=True)  # categories(type='supplier').name, multi

    # Manual (non-master) sheet columns — free text, no validation beyond length, same as
    # composition/remark elsewhere. Warp/Weft/Fin. Construction are woven-only on the sheet;
    # Fibre/Yarn Details/Structure-Gauge/Dia in inch/Sort no. for Sticker Printing are knit-only —
    # both sets are always present on the model (no separate knit/woven subclass) since a plain
    # nullable column that's simply left blank for the other kind matches every other optional
    # field on this model, and avoids a schema split the client's sheet itself doesn't make either.
    warp: Mapped[str | None] = mapped_column(String(200), nullable=True)
    weft: Mapped[str | None] = mapped_column(String(200), nullable=True)
    fin_const: Mapped[str | None] = mapped_column(String(100), nullable=True)
    width_cm: Mapped[str | None] = mapped_column(String(50), nullable=True)
    width_inch: Mapped[str | None] = mapped_column(String(50), nullable=True)
    price_meter: Mapped[str | None] = mapped_column(String(50), nullable=True)
    moq: Mapped[str | None] = mapped_column(String(50), nullable=True)
    remark: Mapped[str | None] = mapped_column(Text, nullable=True)
    sort_no_sticker: Mapped[str | None] = mapped_column(String(100), nullable=True)
    dia_inch: Mapped[str | None] = mapped_column(String(50), nullable=True)
    structure_gauge: Mapped[str | None] = mapped_column(String(100), nullable=True)
    fibre: Mapped[str | None] = mapped_column(String(100), nullable=True)
    yarn_details: Mapped[str | None] = mapped_column(Text, nullable=True)
