# Backend Testing

## Database

- Tests run against a **real PostgreSQL** (models use JSONB, UUID and advisory locks; SQLite is not equivalent). `TEST_DATABASE_URL` must point at a disposable database; `conftest.py` exits with instructions if it is missing.
- The session fixture drops and recreates the `public` schema, then runs the real `alembic upgrade head` in a subprocess, so every run also tests the migrations.
- After each test: `runner.wait_idle()` (background AI tasks write to the DB), then `TRUNCATE` every table.

## Fixtures

| Fixture | Gives you |
|---|---|
| `client` | `httpx.AsyncClient` on the ASGI app (lifespan does not run) |
| `make_guest(credential_id=None)` | a logged-in guest `Session` (`.headers`, `.id`, `.credential_id`) |
| `make_account(email=None)` | a registered account `Session` |
| `storage` (autouse) | a fresh `MemoryStorage` installed via `set_storage` |

## Outbound HTTP

- Mock with `respx.mock(assert_all_mocked=True)`: any undeclared request fails.
- To prove that **no** request was made (SSRF tests), register a catch-all route and assert `anything.call_count == 0`. Pass `assert_all_called=False`, since the catch-all is meant to stay unused.
- Note: in the installed respx version the router-level `mock.calls` stays empty. Assert on route objects (`route.call_count`, `route.calls.last.request`).
- A guard test is only meaningful if it fails when the guard is removed. For security checks, run a temporary mutation (reintroduce the vulnerable behaviour) once to confirm the test catches it, then delete the mutation.

## Background tasks and concurrency

- After triggering AI work, call `await runner.wait_idle()` inside the respx context, so mocked upstream calls are still active when the task runs.
- Concurrency tests use `asyncio.gather` over real requests (each gets its own DB session), e.g. 8 parallel quota checks or 5 parallel conflicting PATCHes.

## Never hang

- `pytest-timeout` fails any test after 60 seconds; `TaskRunner.wait_idle` has a 30-second timeout; the engine has `pool_timeout=10`; quota lock waits are bounded by `lock_timeout`.
- During development the suite hung twice and the cause was not found in about 250 targeted reruns. These limits make a recurrence show up as a failure with a stack trace instead of a stuck CI job.
