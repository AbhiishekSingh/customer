"""Simple in-process rate limiter for the login endpoint's per-IP throttle (§1 of the validation
doc: per-email lockout lives in the DB on the User row; per-IP is tracked separately here so one
IP can't lock out an arbitrary account by spraying attempts, and one user's forgotten password
can't IP-ban everyone behind the same NAT).

In-process is fine for a single-instance deployment; a multi-instance production deployment
should swap this for a shared store (Redis) — noted here rather than silently left as a gap.
"""
import time
from collections import defaultdict

_WINDOW_SECONDS = 15 * 60
_MAX_ATTEMPTS = 20  # looser than the per-account limit — this just stops IP-wide abuse

_ip_attempts: dict[str, list[float]] = defaultdict(list)


def ip_is_rate_limited(ip: str) -> bool:
    now = time.time()
    _ip_attempts[ip] = [t for t in _ip_attempts[ip] if now - t < _WINDOW_SECONDS]
    return len(_ip_attempts[ip]) >= _MAX_ATTEMPTS


def record_ip_attempt(ip: str) -> None:
    _ip_attempts[ip].append(time.time())
