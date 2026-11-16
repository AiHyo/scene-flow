# Technical Design: FastAPI Backend Decoupling

## 1. Architecture Overview

```
Browser (React + Vite)
   │  REST + SSE (/api/v1/*) + Bearer JWT (camelCase JSON)
   ▼
FastAPI Backend (backend/app/)
   ├── routers/      # HTTP validation, auth dependencies, SSE streaming
   ├── services/     # Ownership checks (replacing RLS) & business logic
   ├── models/       # SQLAlchemy 2.0 async ORM models (snake_case, singular tables)
   ├── providers/    # Pluggable AI adapters (llm.py, vision.py, img_gen.py)
   └── storage/      # S3-compatible storage client (MinIO)
   │
   ├──► PostgreSQL 16 (6 singular tables, JSONB for project data)
   └──► MinIO (S3-compatible object storage for media bucket)
```

### Why Modular Layered (Not Heavy DDD)
- The domain has 6 tables (`profile`, `anon_credential_map`, `project`, `plaza_post`, `plaza_like`, `plaza_comment`) and primarily performs CRUD + AI proxying.
- A thin 3-layer structure (`routers` → `services` → `models`) plus adapter interfaces for `providers/` and `storage/` avoids boilerplate while keeping third-party AI/storage vendors swappable.

---

## 2. Candidate Naming & Conventions (Aligned with Developer Preferences)

- **Backend Layout (`backend/app/`)**:
  - `routers/`: `auth.py`, `project.py`, `plaza.py`, `media.py`, `ai.py`
  - `services/`: `auth_service.py`, `project_service.py`, `plaza_service.py`
  - `models/`: `profile.py`, `project.py`, `plaza.py`
  - `schemas/`: `common.py` (camelCase alias base), `auth.py`, `project.py`, `plaza.py`, `ai.py`
  - `providers/`: `llm.py`, `vision.py`, `img_gen.py` (`img` + `gen`)
  - `storage/`: `s3.py`
- **Database Tables (Singular, lowercase snake_case, `create_time` / `update_time`)**:
  - `profile` (`id` UUID PK, `email`, `password_hash`, `nickname`, `avatar_url`, `role`, `is_anon`, `create_time`, `update_time`)
  - `anon_credential_map` (`credential_id` PK, `user_id` FK → `profile.id`, `create_time`)
  - `project` (`id` UUID PK, `owner_id` FK → `profile.id`, `title`, `cover_url`, `data` JSONB, `create_time`, `update_time`)
  - `plaza_post` (`id` UUID PK, `author_id` FK → `profile.id`, `title`, `content`, `img_list` JSONB, `author_nickname`, `author_avatar_url`, `like_count`, `create_time`, `update_time`)
  - `plaza_like` (`post_id`, `user_id` composite PK, `create_time`)
  - `plaza_comment` (`id` UUID PK, `post_id` FK CASCADE, `author_id` FK, `author_nickname`, `author_avatar_url`, `content`, `create_time`)
- **JSON Field Convention**:
  - Pydantic schemas serialize to **camelCase** (`createTime`, `updateTime`, `coverUrl`, `ownerId`, `avatarUrl`, `imgList`, `likeCount`, `likedByMe`, `isAnon`).

---

## 3. Ownership & Access Control (Replacing Supabase RLS)

- `project`: `owner_id == current_user.id` checked in `project_service.py`; raise 403/404 on mismatch.
- `plaza_post` / `plaza_comment`: public `GET`; authenticated `POST`; `DELETE` requires `author_id == current_user.id`.

---

## 4. API Contract (`/api/v1`, Singular Resource Paths)

| Domain | Method & Path | Notes |
|---|---|---|
| Auth | `POST /api/v1/auth/anon` | `{ credentialId }` → `{ accessToken, user }` |
| Auth | `POST /api/v1/auth/register` | `{ email, password, nickname? }` → `{ accessToken, user }` |
| Auth | `POST /api/v1/auth/login` | `{ email, password }` → `{ accessToken, user }` |
| Auth | `GET /api/v1/auth/me` | Current user profile |
| Auth | `PATCH /api/v1/auth/me` | Update `nickname` / `avatarUrl` |
| Auth | `POST /api/v1/auth/migrate-project` | `{ fromUserId }` → `{ migratedCount }` |
| Project | `GET /api/v1/project` | Paginated list (`limit`, `offset`) for `current_user` |
| Project | `POST /api/v1/project` | Create project → `{ id }` |
| Project | `GET /api/v1/project/{id}` | Get project detail (owner only) |
| Project | `PATCH /api/v1/project/{id}` | Update `title`, `coverUrl`, `data` |
| Project | `DELETE /api/v1/project/{id}` | Delete project |
| Plaza | `GET /api/v1/plaza-post` | Public feed, newest first, includes `likedByMe` if auth header present |
| Plaza | `POST /api/v1/plaza-post` | Create post |
| Plaza | `GET /api/v1/plaza-post/{id}` | Post detail + `commentList` |
| Plaza | `DELETE /api/v1/plaza-post/{id}` | Author only; cleans up MinIO images |
| Plaza | `POST /api/v1/plaza-post/{id}/like` | Toggle like → `{ liked, likeCount }` |
| Plaza | `POST /api/v1/plaza-post/{id}/comment` | Add comment |
| Plaza | `DELETE /api/v1/plaza-comment/{id}` | Author only |
| Media | `POST /api/v1/media/upload` | Multipart file upload (`folder`), 1MB default limit → `{ url, objectKey }` |
| AI | `POST /api/v1/ai/chat` | SSE stream (`text/event-stream`) matching OpenAI delta format expected by `src/services/ai.ts` |
| AI | `POST /api/v1/ai/vision/request` | Submit image understanding task |
| AI | `POST /api/v1/ai/vision/result` | Poll image understanding result |
| AI | `POST /api/v1/ai/scene/submit` | Submit scene image generation task |
| AI | `POST /api/v1/ai/scene/query` | Poll scene generation; persists succeed image to MinIO |

---

## 5. Frontend Decoupling Plan (`src/`)

1. Create `src/lib/apiClient.ts` (base URL `import.meta.env.VITE_API_BASE_URL || ''`, automatic `Authorization: Bearer <token>` header from `localStorage`, explicit error propagation).
2. Update `src/types/types.ts` (and plaza types) to align with the new camelCase API fields (`createTime`, `updateTime`, `coverUrl`, `imgList`, `likeCount`, `likedByMe`).
3. Update `src/contexts/AuthContext.tsx` to use `/api/v1/auth/*` and JWT token storage instead of `supabase.auth`.
4. Update `src/services/api.ts`, `src/services/plazaApi.ts`, `src/services/ai.ts`, `src/services/sceneGen.ts`, `src/components/workbench/SceneModule.tsx`, and `src/hooks/use-supabase-upload.ts` (rename to `useMediaUpload.ts`) to call `/api/v1/*`.
5. Remove `src/lib/supabase.ts`, `src/db/supabase.ts`, and `@supabase/supabase-js` from `package.json`.
6. Configure Vite dev proxy (`/api` → `http://127.0.0.1:8000`) in `vite.config.ts`.

---

## 6. Docker Compose Topology

`docker-compose.yml` at repo root:
- `postgres`: `postgres:16-alpine` with persistent volume & healthcheck
- `minio`: `minio/minio` + `minio-init` (auto-creates public-read `media` bucket)
- `backend`: FastAPI (`uvicorn app.main:app --host 0.0.0.0 --port 8000`)
- `frontend`: Multi-stage Vite build served by `nginx:alpine` with `/api/` reverse-proxied to `backend:8000`
