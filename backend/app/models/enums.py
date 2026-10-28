import enum


def sv(x) -> str:
    """'status value' helper: returns the plain string value whether x is already an Enum member
    (the normal case for anything loaded from the DB) or a bare string assigned moments earlier in
    the same request, before a flush round-trips it back through the Enum type. Needed because a
    freshly-assigned `model.status = "sent"` stays a plain str in memory until SQLAlchemy flushes
    and reloads it — reading `.value` on it directly would crash."""
    return x.value if isinstance(x, enum.Enum) else x


class RoleEnum(str, enum.Enum):
    design = "design"
    manager = "manager"
    admin = "admin"
    top = "top"


class StatusEnum(str, enum.Enum):
    """Generic active/inactive status used by every 'master' record that must
    never be hard-deleted (categories, countries, states, fabrics, contacts, users)."""
    active = "active"
    inactive = "inactive"


class SwatchTypeEnum(str, enum.Enum):
    hanger = "Hanger"
    swatch = "Swatch"
    yardage = "Yardage"


class MailStatusEnum(str, enum.Enum):
    scheduled = "scheduled"
    sent = "sent"
    bounced = "bounced"
    send_failed = "send_failed"
    skipped = "skipped"


class ResponseSourceEnum(str, enum.Enum):
    portal = "portal"
    manual = "manual"


class BlacklistCatEnum(str, enum.Enum):
    A = "A"
    B = "B"
    C = "C"


class ApprovalStatusEnum(str, enum.Enum):
    pending = "pending"
    approved = "approved"
    rejected = "rejected"
    withdrawn = "withdrawn"  # auto-withdrawn by the system because the underlying rule stopped holding (never a Top Management decision)


class ApprovalParentEnum(str, enum.Enum):
    blacklist_event = "blacklist_event"
    exception = "exception"
