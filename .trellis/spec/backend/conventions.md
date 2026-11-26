# Backend Conventions

## Errors

- Raise subclasses of `app.core.errors.AppError` (`BadRequest`, `Unauthorized`, `Forbidden`, `NotFound`, `Conflict`, `PayloadTooLarge`, `RateLimited`, `UpstreamError`, `ServiceMisconfigured`). One handler in `main.py` renders `{"detail": message, "code": code, ...extra}`.
- Keep the `detail` key: the frontend displays it (`src/lib/apiClient.ts`), and `ApiError.body` exposes the rest (e.g. `currentVersion` on 409).
- **Never forward an upstream status code.** Provider failures become `UpstreamError` (502). A provider's 401 must not look like the user's session expiring.
- Missing server configuration (no API key) is `ServiceMisconfigured` (503), checked before any work starts.
- Unhandled exceptions are caught by `RequestIdMiddleware` and become a 500 with `requestId`; internals are only logged.

## Request IDs and logging

- `X-Request-ID` is read (if well-formed) or generated, stored in a contextvar, echoed on the response, and added to every log line.
- Background work started by `TaskRunner` inherits the submitting request's id.

## Outbound HTTP

- Use the shared client from `core.http.get_http_client()` and pass a per-call `timeout=`. Do not create `httpx.AsyncClient` per request.
- Catch `httpx.RequestError` and raise `UpstreamError` with a short, non-sensitive message.

## Storage

- Business code depends on `app.storage.base.ObjectStorage` via `app.storage.get_storage()`, never on boto3 directly.
- Helpers: `upload(storage, data, folder, ext, content_type)`, `public_url(storage, key)`, `key_from_url(storage, url)`, `delete_by_urls(storage, urls)`.
- `key_from_url` requires scheme, host **and** bucket prefix to match the configured public URL; look-alike hosts and `..` segments return `None`.
- User uploads may only go to `avatar | plaza | venue`; `generated/` and `samples/` are written by the backend only. Uploads are size-limited by reading at most `MAX + 1` bytes and must pass a magic-byte check that matches the declared type.

## Image references (SSRF guard)

- **The server never fetches a URL the client supplied.** Every user-referenced image goes through `app.ai.image_refs`:
  - `validate_image_ref(ref)` → object key, or `BadRequest`. Call it at submit time, before creating any task.
  - `resolve_image_ref(ref)` → bytes read through the storage client.
- Accepted references: public URLs of objects in our bucket, and the paths in `SAMPLE_VENUES` (kept in sync with `src/data/venueSamples.ts`), which are seeded into `samples/` at startup.
- Providers that fetch images themselves (Kling) receive only `public_url(storage, key)` of validated keys.
- Result URLs returned *by a provider* may be downloaded; that is not user input.

## AI tasks and quota

- Every AI call writes an `ai_task` row (`kind`: chat | vision | scene). The row is both the async task state and the usage ledger for rate limiting.
- Order inside a request: config check → validate refs → `enforce_quota` → create row → `commit` → `runner.submit`. Commit before submitting: background work uses its own session and must see the row.
- `enforce_quota` takes a per-(user, kind) advisory lock with `SET LOCAL lock_timeout`, so count + insert is atomic and a waiting request gives up with 429 instead of hanging.
- If a provider call that happens inside the request fails (Kling submit), let the transaction roll back: no row, no quota consumed.
- Query endpoints look tasks up by `id + owner_id + kind`; anything else is a uniform 404.
- Keep frontend contracts stable: vision `retCode` (0 / 1 / -1), scene `task_status` (`succeed` / `failed` / other = keep polling).

## Optimistic locking (projects)

- `project.version` increments on every update. When the client sends `expectedVersion`, the check and the write happen in one statement: `UPDATE ... WHERE id = ? AND owner_id = ? AND version = ? RETURNING version`. No row → 409 `version_conflict` with `currentVersion`.
- Determine 404 / 403 before the conditional update so a conflict is never confused with a permission error.
- Omitting `expectedVersion` means an unconditional write that still bumps the version (used by simple renames).

## Configuration

- `APP_ENV=dev` (default) allows the built-in JWT secret so the project runs right after cloning. `APP_ENV=prod` refuses to start with a missing, known-example or shorter-than-32-character `JWT_SECRET`.
- CORS is an explicit allow-list (`CORS_ORIGINS`) with `allow_credentials=False`; the frontend uses bearer tokens, not cookies.
