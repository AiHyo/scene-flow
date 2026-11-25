# Implementation Plan: FastAPI Backend Decoupling

## Phase A: Infrastructure & Backend Skeleton
- [ ] A1. Create `docker-compose.yml` (`postgres`, `minio`, `minio-init`) and update `.env.example` (`VITE_API_BASE_URL`, backend DB/MinIO/JWT/AI env vars).
- [ ] A2. Initialize `backend/` (`pyproject.toml`, `app/core/config.py`, `app/core/database.py`, `app/core/security.py`, `app/main.py`).
- [ ] A3. Define SQLAlchemy ORM models (`profile`, `anon_credential_map`, `project`, `plaza_post`, `plaza_like`, `plaza_comment`) using `create_time` / `update_time` and initial Alembic migration.
- [ ] A4. Implement `app/storage/s3.py` (MinIO upload/delete/public URL) and `POST /api/v1/media/upload`.
- [ ] **Gate A**: `docker compose up -d postgres minio`, `alembic upgrade head`, and `GET /health` return 200.

## Phase B: Core Business APIs (Auth, Project, Plaza)
- [ ] B1. Implement `auth` router & service (`anon`, `register`, `login`, `me`, `migrate-project`).
- [ ] B2. Implement `project` router & service (CRUD + owner check, camelCase JSON schema).
- [ ] B3. Implement `plaza` router & service (`plaza-post`, like toggle, `plaza-comment`, author-only delete + MinIO cleanup).
- [ ] **Gate B**: Verify Auth, Project, Plaza, and Media endpoints via FastAPI `/docs` or `pytest` integration tests.

## Phase C: AI Gateway Providers
- [ ] C1. Implement `providers/llm.py` + `POST /api/v1/ai/chat` (OpenAI-compatible SSE pass-through).
- [ ] C2. Implement `providers/vision.py` + `/api/v1/ai/vision/{request,result}`.
- [ ] C3. Implement `providers/img_gen.py` + `/api/v1/ai/scene/{submit,query}` (with MinIO persistence on `succeed`).
- [ ] **Gate C**: Verify SSE streaming format and error propagation (400/402/429/502) match frontend expectations.

## Phase D: Frontend Decoupling & Cleanup
- [ ] D1. Add Vite `/api` proxy in `vite.config.ts` and create `src/lib/apiClient.ts`.
- [ ] D2. Update `src/types/types.ts` and plaza types to camelCase (`createTime`, `updateTime`, `coverUrl`, `imgList`, `likeCount`, `likedByMe`).
- [ ] D3. Refactor `src/contexts/AuthContext.tsx` to use JWT + `/api/v1/auth/*`.
- [ ] D4. Refactor `src/services/api.ts`, `src/services/plazaApi.ts`, `src/services/ai.ts`, `src/services/sceneGen.ts`, `src/components/workbench/SceneModule.tsx`, and upload hook (`useMediaUpload.ts`).
- [ ] D5. Remove `src/lib/supabase.ts`, `src/db/supabase.ts`, and `@supabase/supabase-js` from `package.json`.
- [ ] **Gate D**: Run `npm run lint` and `npm run build`; verify end-to-end flows in browser against local FastAPI + Postgres + MinIO.

## Phase E: Production Compose & Verification
- [ ] E1. Add `backend/Dockerfile` and `frontend` Nginx service to `docker-compose.yml`.
- [ ] E2. Run full-stack smoke test and update `README.md` with local dev & Docker quickstart.
