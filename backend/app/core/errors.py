"""Domain errors.

Services and providers raise these instead of FastAPI's HTTPException, so business
code does not depend on the web layer. A single handler in `main.py` turns them into
`{"detail": ..., "code": ...}` responses; the frontend reads `detail`
(see src/lib/apiClient.ts).
"""

from __future__ import annotations

from typing import Any


class AppError(Exception):
    status_code: int = 500
    code: str = "internal_error"

    def __init__(self, message: str, *, code: str | None = None, extra: dict[str, Any] | None = None):
        super().__init__(message)
        self.message = message
        if code is not None:
            self.code = code
        self.extra = extra or {}
        self.headers: dict[str, str] = {}

    def to_body(self) -> dict[str, Any]:
        return {"detail": self.message, "code": self.code, **self.extra}


class BadRequest(AppError):
    status_code = 400
    code = "bad_request"


class Unauthorized(AppError):
    status_code = 401
    code = "unauthorized"


class Forbidden(AppError):
    status_code = 403
    code = "forbidden"


class NotFound(AppError):
    status_code = 404
    code = "not_found"


class Conflict(AppError):
    status_code = 409
    code = "conflict"


class PayloadTooLarge(AppError):
    status_code = 413
    code = "payload_too_large"


class RateLimited(AppError):
    status_code = 429
    code = "rate_limited"

    def __init__(self, message: str, *, retry_after: int):
        super().__init__(message, extra={"retryAfter": retry_after})
        self.headers = {"Retry-After": str(retry_after)}


class UpstreamError(AppError):
    """An AI / storage provider failed. Never forwards the upstream status code,
    so a provider's 401 cannot be mistaken for the user's session expiring."""

    status_code = 502
    code = "upstream_error"


class ServiceMisconfigured(AppError):
    status_code = 503
    code = "service_misconfigured"
