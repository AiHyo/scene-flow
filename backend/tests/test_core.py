from __future__ import annotations

import uuid

import httpx
import pytest
import respx
from fastapi import FastAPI
from pydantic import ValidationError

from app.core.config import DEV_JWT_SECRET, Settings, settings
from app.core.logging import RequestIdMiddleware


async def test_domain_error_shape_and_request_id(client, make_guest):
    guest = await make_guest()
    resp = await client.get(f"/api/v1/project/{uuid.uuid4()}", headers=guest.headers)

    assert resp.status_code == 404
    assert resp.json() == {"detail": "项目不存在", "code": "not_found"}
    assert resp.headers["X-Request-ID"]


async def test_incoming_request_id_is_echoed(client):
    resp = await client.get("/health", headers={"X-Request-ID": "trace-abc-123"})
    assert resp.headers["X-Request-ID"] == "trace-abc-123"


async def test_malformed_request_id_is_replaced(client):
    resp = await client.get("/health", headers={"X-Request-ID": "bad id with spaces\r\n"})
    assert resp.headers["X-Request-ID"] != "bad id with spaces\r\n"
    assert len(resp.headers["X-Request-ID"]) == 32


async def test_unhandled_exception_becomes_json_500_with_request_id():
    mini = FastAPI()

    @mini.get("/boom")
    async def boom():
        raise RuntimeError("secret internals")

    mini.add_middleware(RequestIdMiddleware)
    transport = httpx.ASGITransport(app=mini, raise_app_exceptions=False)
    async with httpx.AsyncClient(transport=transport, base_url="http://t") as c:
        resp = await c.get("/boom", headers={"X-Request-ID": "req-42"})

    assert resp.status_code == 500
    assert resp.json() == {"detail": "服务器内部错误", "code": "internal_error", "requestId": "req-42"}
    assert "secret internals" not in resp.text
    assert resp.headers["X-Request-ID"] == "req-42"


@pytest.mark.parametrize("secret", [DEV_JWT_SECRET, "change-me-in-production", "too-short"])
def test_prod_rejects_weak_jwt_secret(secret):
    with pytest.raises(ValidationError, match="JWT_SECRET"):
        Settings(app_env="prod", jwt_secret=secret)


def test_prod_accepts_strong_secret_and_dev_allows_default():
    Settings(app_env="prod", jwt_secret="x" * 48)
    Settings(app_env="dev", jwt_secret=DEV_JWT_SECRET)


async def test_cors_allows_only_configured_origins(client):
    allowed = settings.cors_origin_list[0]
    ok = await client.options(
        "/api/v1/project",
        headers={"Origin": allowed, "Access-Control-Request-Method": "GET"},
    )
    assert ok.headers.get("access-control-allow-origin") == allowed

    evil = await client.options(
        "/api/v1/project",
        headers={"Origin": "https://evil.example", "Access-Control-Request-Method": "GET"},
    )
    assert "access-control-allow-origin" not in evil.headers


async def test_chat_upstream_401_is_reported_as_502(client, make_guest, monkeypatch):
    """A provider's 401 must not look like the user's session expired."""
    monkeypatch.setattr(settings, "llm_api_key", "sk-test")
    monkeypatch.setattr(settings, "llm_base_url", "https://llm.test/v1")
    guest = await make_guest()

    with respx.mock(assert_all_called=True) as mock:
        mock.post("https://llm.test/v1/chat/completions").respond(401, json={"error": "invalid key"})
        resp = await client.post(
            "/api/v1/ai/chat", json={"messages": [{"role": "user", "content": "hi"}]}, headers=guest.headers
        )

    assert resp.status_code == 502
    assert resp.json()["code"] == "upstream_error"


async def test_chat_without_key_is_service_misconfigured(client, make_guest, monkeypatch):
    monkeypatch.setattr(settings, "llm_api_key", "")
    guest = await make_guest()
    resp = await client.post(
        "/api/v1/ai/chat", json={"messages": [{"role": "user", "content": "hi"}]}, headers=guest.headers
    )
    assert resp.status_code == 503
    assert resp.json()["code"] == "service_misconfigured"
