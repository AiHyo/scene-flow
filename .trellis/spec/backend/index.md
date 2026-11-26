# Backend Development Guidelines

> Conventions for `backend/` (FastAPI + SQLAlchemy async + PostgreSQL + MinIO). Established in task `11-24-backend-hardening`; design rationale lives in that task's `design.md`.

## Layout

```
routers/    HTTP only: parse input, call a service, shape the response
services/   business rules (project, plaza, auth)
ai/         AI orchestration: image_refs (SSRF guard), tasks (ai_task + runner), quota, service
providers/  upstream API calls only (LLM, vision, image generation); no task state, no URL fetching
storage/    ObjectStorage protocol; S3Storage (MinIO) and MemoryStorage (tests)
core/       config, database, errors, logging (request id), http (shared client), deps
```

## Guidelines Index

| Guide | Description |
|---|---|
| [Conventions](./conventions.md) | Errors, storage, image references, AI tasks, quota, optimistic locking |
| [Testing](./testing.md) | Test database, fixtures, mocking outbound HTTP, what to assert |

## Pre-commit Checklist

```bash
cd backend
uv run ruff check . && uv run ruff format --check .
TEST_DATABASE_URL=postgresql+asyncpg://sceneflow:sceneflow_test@127.0.0.1:55432/sceneflow_test uv run pytest -q
```

- [ ] No `HTTPException` in `services/`, `providers/`, `ai/` (`grep -rn "HTTPException(" backend/app` must be empty).
- [ ] Schema change → new Alembic revision with a working `downgrade`; run `alembic downgrade -1 && alembic upgrade head`.
- [ ] New outbound HTTP goes through `core.http.get_http_client()` with an explicit timeout.
- [ ] Any image a user references is resolved via `ai.image_refs`, never fetched by URL.
