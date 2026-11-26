"""Request-scoped logging: every log line carries the request id.

The id comes from the incoming `X-Request-ID` header (or is generated), is echoed
back on the response, and is captured by background tasks so their logs can be
tied to the request that started them.
"""

from __future__ import annotations

import json
import logging
import logging.config
import re
import uuid
from contextvars import ContextVar

from starlette.types import ASGIApp, Message, Receive, Scope, Send

REQUEST_ID_HEADER = "X-Request-ID"
_request_id: ContextVar[str] = ContextVar("request_id", default="-")
_VALID_ID = re.compile(r"^[A-Za-z0-9._-]{1,64}$")


def get_request_id() -> str:
    return _request_id.get()


def set_request_id(value: str) -> None:
    _request_id.set(value)


class RequestIdFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        record.request_id = get_request_id()
        return True


def configure_logging(level: str = "INFO") -> None:
    logging.config.dictConfig(
        {
            "version": 1,
            "disable_existing_loggers": False,
            "filters": {"request_id": {"()": RequestIdFilter}},
            "formatters": {"default": {"format": "%(asctime)s %(levelname)s [%(request_id)s] %(name)s: %(message)s"}},
            "handlers": {
                "console": {"class": "logging.StreamHandler", "formatter": "default", "filters": ["request_id"]}
            },
            "root": {"handlers": ["console"], "level": level},
            "loggers": {"uvicorn.access": {"level": "WARNING"}},
        }
    )


class RequestIdMiddleware:
    """Pure ASGI middleware, so it also works for streaming (SSE) responses."""

    def __init__(self, app: ASGIApp):
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        incoming = ""
        for name, value in scope.get("headers", []):
            if name.decode("latin-1").lower() == REQUEST_ID_HEADER.lower():
                incoming = value.decode("latin-1")
                break
        request_id = incoming if _VALID_ID.match(incoming) else uuid.uuid4().hex
        token = _request_id.set(request_id)

        response_started = False

        async def send_with_id(message: Message) -> None:
            nonlocal response_started
            if message["type"] == "http.response.start":
                response_started = True
                headers = list(message.get("headers", []))
                headers.append((REQUEST_ID_HEADER.encode("latin-1"), request_id.encode("latin-1")))
                message["headers"] = headers
            await send(message)

        try:
            await self.app(scope, receive, send_with_id)
        except Exception:
            # Handled here rather than by an app-level Exception handler: Starlette runs
            # those outside user middleware, where the request id is already gone.
            logging.getLogger("app").exception("unhandled error")
            if response_started:
                raise
            body = json.dumps(
                {"detail": "服务器内部错误", "code": "internal_error", "requestId": request_id},
                ensure_ascii=False,
            ).encode("utf-8")
            await send_with_id(
                {
                    "type": "http.response.start",
                    "status": 500,
                    "headers": [(b"content-type", b"application/json; charset=utf-8")],
                }
            )
            await send({"type": "http.response.body", "body": body})
        finally:
            _request_id.reset(token)
