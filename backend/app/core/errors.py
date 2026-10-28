from fastapi import HTTPException


def api_error(status_code: int, code: str, message: str, fields: dict | None = None) -> HTTPException:
    """Consistent error shape across the whole API — §0 of the validation doc."""
    detail = {"error": {"code": code, "message": message}}
    if fields:
        detail["error"]["fields"] = fields
    return HTTPException(status_code=status_code, detail=detail)


def not_found(message: str = "Not found") -> HTTPException:
    return api_error(404, "NOT_FOUND", message)


def validation_error(message: str, fields: dict | None = None) -> HTTPException:
    return api_error(422, "VALIDATION_ERROR", message, fields)


def conflict(message: str) -> HTTPException:
    return api_error(409, "CONFLICT", message)


def forbidden(message: str = "Not allowed") -> HTTPException:
    return api_error(403, "FORBIDDEN", message)


def unauthorized(message: str = "Not authenticated") -> HTTPException:
    return api_error(401, "UNAUTHORIZED", message)


def rate_limited(message: str = "Too many attempts, try again later") -> HTTPException:
    return api_error(429, "RATE_LIMITED", message)
