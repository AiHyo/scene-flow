"""Test harness: real Postgres, migrations applied once, tables truncated per test.

Set TEST_DATABASE_URL to an empty, disposable database, e.g.
    postgresql+asyncpg://sceneflow:sceneflow_test@127.0.0.1:55432/sceneflow_test
"""

from __future__ import annotations

import asyncio
import os
import subprocess
import sys
import uuid
from collections.abc import AsyncIterator
from pathlib import Path

import pytest

TEST_DATABASE_URL = os.environ.get("TEST_DATABASE_URL")
if not TEST_DATABASE_URL:
    pytest.exit(
        "TEST_DATABASE_URL is not set. Point it at a disposable Postgres database, "
        "for example postgresql+asyncpg://sceneflow:sceneflow_test@127.0.0.1:55432/sceneflow_test",
        returncode=2,
    )

# Must happen before any `app` import: the engine is created at import time.
os.environ["DATABASE_URL"] = TEST_DATABASE_URL
os.environ.setdefault("APP_ENV", "dev")

import httpx  # noqa: E402
from sqlalchemy import text  # noqa: E402

from app.core.database import Base, engine  # noqa: E402
from app.main import app  # noqa: E402

BACKEND_DIR = Path(__file__).resolve().parents[1]


async def _reset_schema() -> None:
    async with engine.begin() as conn:
        await conn.execute(text("DROP SCHEMA public CASCADE"))
        await conn.execute(text("CREATE SCHEMA public"))


@pytest.fixture(scope="session", autouse=True)
async def migrated_db() -> AsyncIterator[None]:
    """Start from an empty schema and run the real Alembic migrations once."""
    await _reset_schema()
    await engine.dispose()
    await asyncio.to_thread(
        subprocess.run,
        [sys.executable, "-m", "alembic", "upgrade", "head"],
        cwd=BACKEND_DIR,
        env={**os.environ, "DATABASE_URL": TEST_DATABASE_URL},
        check=True,
        capture_output=True,
    )
    yield
    await engine.dispose()


@pytest.fixture(autouse=True)
async def clean_tables(migrated_db: None) -> AsyncIterator[None]:
    yield
    tables = ", ".join(f'"{t.name}"' for t in Base.metadata.sorted_tables)
    async with engine.begin() as conn:
        await conn.execute(text(f"TRUNCATE {tables} RESTART IDENTITY CASCADE"))


@pytest.fixture
async def client() -> AsyncIterator[httpx.AsyncClient]:
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as c:
        yield c


class Session:
    """A logged-in caller: token plus the user payload the API returned."""

    def __init__(self, token: str, user: dict, credential_id: str | None = None):
        self.token = token
        self.user = user
        self.credential_id = credential_id

    @property
    def headers(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {self.token}"}

    @property
    def id(self) -> str:
        return self.user["id"]


@pytest.fixture
def make_guest(client: httpx.AsyncClient):
    async def _make(credential_id: str | None = None) -> Session:
        cred = credential_id or f"cred-{uuid.uuid4().hex}"
        resp = await client.post("/api/v1/auth/anon", json={"credentialId": cred})
        assert resp.status_code == 200, resp.text
        body = resp.json()
        return Session(body["accessToken"], body["user"], cred)

    return _make


@pytest.fixture
def make_account(client: httpx.AsyncClient):
    async def _make(email: str | None = None, password: str = "secret123") -> Session:
        addr = email or f"u{uuid.uuid4().hex[:10]}@example.com"
        resp = await client.post(
            "/api/v1/auth/register", json={"email": addr, "password": password, "nickname": "tester"}
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        return Session(body["accessToken"], body["user"])

    return _make
