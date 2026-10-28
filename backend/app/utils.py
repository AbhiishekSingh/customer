import re

EMAIL_RE = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]{2,}$")  # matches the prototype's EMAIL_RE


def is_valid_email(s: str | None) -> bool:
    return bool(s) and bool(EMAIL_RE.match(s.strip()))


def is_valid_email_list(s: str | None) -> bool:
    if not s:
        return True
    parts = [p.strip() for p in re.split(r"[;,]", s) if p.strip()]
    return all(is_valid_email(p) for p in parts)
