import uuid

from pydantic import BaseModel, field_validator, model_validator

from app.models.enums import StatusEnum


class FabricCreate(BaseModel):
    code: str
    # No longer collected directly on the Item Master form (the client's sheet has no "name"
    # column) — if left blank, `derive_name` below fills it from development_no, falling back to
    # code, so every other screen that shows a fabric by name still has something sensible. Still
    # accepted explicitly (e.g. from an older CSV import row) so nothing that already sends it breaks.
    name: str | None = None
    # Legacy D&D swatch category — optional now; never a column in the client's sheet, so new
    # items from the Item Master form don't set it. Existing rows are unaffected.
    quality_category: str | None = None
    composition: str | None = None
    gsm: float | None = None
    description: str | None = None
    colour_variants: str | None = None
    supplier: str | None = None  # categories(type='supplier').name
    photo_url: str | None = None

    # --- Item Master fields (client's AW 27-28 Commercial sheet) ---
    development_no: str | None = None
    gender: list[str] | None = None  # categories(type='gender').name, multi
    season: str | None = None  # categories(type='season').name
    story: str | None = None  # categories(type='story').name
    fabric_category: str | None = None  # categories(type='fabric_category').name — Woven/Knit
    fabric_type: str | None = None  # categories(type='fabric_type').name
    print_type: str | None = None  # categories(type='print_type').name
    lapf_domestic: list[str] | None = None  # categories(type='supplier').name, multi
    lapf_export: list[str] | None = None  # categories(type='supplier').name, multi
    warp: str | None = None
    weft: str | None = None
    fin_const: str | None = None
    width_cm: str | None = None
    width_inch: str | None = None
    price_meter: str | None = None
    moq: str | None = None
    remark: str | None = None
    sort_no_sticker: str | None = None
    dia_inch: str | None = None
    structure_gauge: str | None = None
    fibre: str | None = None
    yarn_details: str | None = None

    @field_validator("code")
    @classmethod
    def normalize_code(cls, v: str) -> str:
        v = v.strip().upper()
        if not v:
            raise ValueError("Code is required")
        return v

    @field_validator("name", "quality_category", "supplier", "development_no", "season", "story",
                      "fabric_category", "fabric_type", "print_type")
    @classmethod
    def blank_to_none(cls, v: str | None) -> str | None:
        """Every one of these is optional, but an empty string from a form field (vs. the field
        being omitted entirely) should mean "not set", not a stored empty string — keeps
        FabricOut/the frontend from having to distinguish "" from None."""
        if v is None:
            return None
        v = v.strip()
        return v or None

    @field_validator("gender", "lapf_domestic", "lapf_export")
    @classmethod
    def drop_blank_list_items(cls, v: list[str] | None) -> list[str] | None:
        if v is None:
            return None
        cleaned = [x.strip() for x in v if x and x.strip()]
        return cleaned or None

    @model_validator(mode="after")
    def derive_name(self) -> "FabricCreate":
        if not self.name:
            self.name = self.development_no or self.code
        return self


class FabricUpdate(BaseModel):
    name: str | None = None
    quality_category: str | None = None
    composition: str | None = None
    gsm: float | None = None
    status: StatusEnum | None = None
    description: str | None = None
    colour_variants: str | None = None
    supplier: str | None = None
    photo_url: str | None = None

    development_no: str | None = None
    gender: list[str] | None = None
    season: str | None = None
    story: str | None = None
    fabric_category: str | None = None
    fabric_type: str | None = None
    print_type: str | None = None
    lapf_domestic: list[str] | None = None
    lapf_export: list[str] | None = None
    warp: str | None = None
    weft: str | None = None
    fin_const: str | None = None
    width_cm: str | None = None
    width_inch: str | None = None
    price_meter: str | None = None
    moq: str | None = None
    remark: str | None = None
    sort_no_sticker: str | None = None
    dia_inch: str | None = None
    structure_gauge: str | None = None
    fibre: str | None = None
    yarn_details: str | None = None

    @field_validator("name", "quality_category", "supplier", "development_no", "season", "story",
                      "fabric_category", "fabric_type", "print_type")
    @classmethod
    def blank_to_none(cls, v: str | None) -> str | None:
        if v is None:
            return None
        v = v.strip()
        return v or None

    @field_validator("gender", "lapf_domestic", "lapf_export")
    @classmethod
    def drop_blank_list_items(cls, v: list[str] | None) -> list[str] | None:
        if v is None:
            return None
        cleaned = [x.strip() for x in v if x and x.strip()]
        return cleaned or None

    @model_validator(mode="after")
    def no_blank_name(self) -> "FabricUpdate":
        """Unlike create, update can't fall back to development_no/code implicitly (it may not be
        in this partial payload, and `exclude_unset` means we must not silently invent a value for
        a field the caller didn't touch) — just refuse to blank out an existing name."""
        if "name" in self.model_fields_set and not self.name:
            raise ValueError("Name cannot be blanked out")
        return self


class FabricOut(BaseModel):
    id: uuid.UUID
    code: str
    name: str
    quality_category: str | None
    composition: str | None
    gsm: float | None
    status: StatusEnum
    description: str | None
    colour_variants: str | None
    supplier: str | None
    photo_url: str | None
    used_count: int = 0

    development_no: str | None = None
    gender: list[str] | None = None
    season: str | None = None
    story: str | None = None
    fabric_category: str | None = None
    fabric_type: str | None = None
    print_type: str | None = None
    lapf_domestic: list[str] | None = None
    lapf_export: list[str] | None = None
    warp: str | None = None
    weft: str | None = None
    fin_const: str | None = None
    width_cm: str | None = None
    width_inch: str | None = None
    price_meter: str | None = None
    moq: str | None = None
    remark: str | None = None
    sort_no_sticker: str | None = None
    dia_inch: str | None = None
    structure_gauge: str | None = None
    fibre: str | None = None
    yarn_details: str | None = None

    model_config = {"from_attributes": True}


class FabricImportRow(BaseModel):
    """CSV bulk-import row. Kept backward compatible with the original 5-column CSV (code, name,
    quality_category, composition, gsm) — every Item Master field below is optional so an old-style
    CSV still imports unchanged, while a CSV exported from the client's sheet (or from this app's
    own Items > Export) can carry the full field set."""
    code: str
    name: str | None = None
    quality_category: str | None = None
    composition: str | None = None
    gsm: float | None = None
    supplier: str | None = None

    development_no: str | None = None
    gender: list[str] | None = None
    season: str | None = None
    story: str | None = None
    fabric_category: str | None = None
    fabric_type: str | None = None
    print_type: str | None = None
    lapf_domestic: list[str] | None = None
    lapf_export: list[str] | None = None
    warp: str | None = None
    weft: str | None = None
    fin_const: str | None = None
    width_cm: str | None = None
    width_inch: str | None = None
    price_meter: str | None = None
    moq: str | None = None
    remark: str | None = None
    sort_no_sticker: str | None = None
    dia_inch: str | None = None
    structure_gauge: str | None = None
    fibre: str | None = None
    yarn_details: str | None = None

    @model_validator(mode="after")
    def derive_name(self) -> "FabricImportRow":
        if not (self.name or "").strip():
            self.name = (self.development_no or self.code or "").strip() or None
        return self


class FabricImportResult(BaseModel):
    created: int
    updated: int
