# FastAPI Backend Decoupling

## Goal

Decouple the SceneFlow AI frontend from Supabase and Miaoda-hosted gateways by introducing a standalone, self-hostable FastAPI backend backed by PostgreSQL and MinIO, packaged with Docker Compose.

## Scope & Constraints

- **Scope (Phase 1 Decoupling Only)**:
  - Build a standalone `backend/` service using Python + FastAPI.
  - Replace all Supabase Auth, PostgREST database queries, Storage (`media` bucket), and 7 Deno Edge Functions (`anon-auth`, `migrate-projects`, `ai-planning-chat`, `image-understanding-request`, `image-understanding-result`, `kling-omni-image-submit`, `kling-omni-image-query`) with FastAPI `/api/v1/*` endpoints.
  - Use **PostgreSQL** as the primary database (migrating the 6 tables from `supabase/schema.sql`) and **MinIO** (S3-compatible) for media storage.
  - Provide `docker-compose.yml` for one-command startup (`postgres`, `minio`, `backend`, `frontend`).
  - Remove `@supabase/supabase-js` and all `supabase/` runtime dependencies from `src/`.
- **Non-Goals**:
  - Do not redesign UI pages or add new product features in this task.
  - Do not adopt heavy DDD layers (no ValueObjects/Aggregates/DomainEvents); use a clean modular layered structure (`routers` → `services` → `models` + `providers`/`storage` adapters).

## Functional Requirements

1. **Authentication & Guest Session Continuity**:
   - Support anonymous guest login via `credential_id` (preserving the zero-friction trial flow).
   - Support email/password registration, login, logout, and profile read/update (`nickname`, `avatar_url`).
   - Support migrating projects from a guest `user_id` to a logged-in account (`POST /api/v1/auth/migrate-projects`).
   - Enforce ownership checks in backend services (replacing Supabase RLS).
2. **Project Management**:
   - Full CRUD for `projects` (`GET /api/v1/projects`, `POST`, `GET /{id}`, `PATCH /{id}`, `DELETE /{id}`), scoped to the authenticated user/guest.
3. **Activity Plaza (Community)**:
   - Public read for `plaza_posts` (paginated, newest first) and comments.
   - Authenticated create/delete for posts (including deleting associated media objects), toggle like (`plaza_likes`), and create/delete comments (`plaza_comments`), with strict author-only delete enforcement.
4. **Media Storage (MinIO)**:
   - Upload images (`POST /api/v1/media/upload`) with size/type validation, storing in MinIO and returning accessible URLs.
   - Re-upload/persist AI-generated images into MinIO so URLs do not expire.
5. **AI Gateway Adapters**:
   - **Planning Chat (SSE)**: `POST /api/v1/ai/chat` streaming OpenAI-compatible SSE chunks, supporting both text and multimodal (`image_url`) messages, configured via env vars (`LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL`, `LLM_VISION_MODEL`).
   - **Image Understanding**: `POST /api/v1/ai/vision/request` and `POST /api/v1/ai/vision/result` (or unified adapter) configurable via env vars.
   - **Scene Image Generation**: `POST /api/v1/ai/scene/submit` and `POST /api/v1/ai/scene/query` preserving reference-image (`beforeUrl`) fidelity and persisting generated images to MinIO.

## Acceptance Criteria

- [ ] `backend/` runs independently with FastAPI + PostgreSQL + MinIO via `docker compose up` and exposes `/docs` OpenAPI schema.
- [ ] Database migrations (Alembic) cleanly create all 6 tables (`profiles`, `anon_credential_map`, `projects`, `plaza_posts`, `plaza_likes`, `plaza_comments`) in PostgreSQL.
- [ ] Frontend `src/` contains zero imports of `@supabase/supabase-js` or references to `VITE_SUPABASE_*` / `miaoda`.
- [ ] Guest session, email login/signup, guest-to-account project migration, project CRUD, plaza post/like/comment, and image upload all work end-to-end against FastAPI + PostgreSQL + MinIO.
- [ ] AI chat streaming, image understanding, and scene generation work through FastAPI using `.env` configured keys (with clear 4xx/5xx error propagation when keys are missing or upstream fails).
- [ ] `npm run lint` and `vite build` pass with zero errors.
