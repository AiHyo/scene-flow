# 后端安全与工程基座

> 状态：需求草稿。开始前需补 design.md / implement.md 并经用户确认。

## Goal

修掉公开仓库中会被资深读者一眼指出的安全问题，并为后续 AI 编排改造打好工程地基（可测试、可观测、可多实例部署）。

## Requirements

### 安全
- S1 SSRF：`backend/app/providers/vision.py` `_to_data_url` 与 `backend/app/providers/img_gen.py` `_run_openai_edit_task` 会抓取用户提交的任意 URL。改为仅接受本桶对象（复用 `backend/app/storage/s3.py` `extract_object_key`），并通过 S3 客户端读取；外部 URL 一律拒绝。
- S1b 样例场地生图（现存 bug，与 S1 同源）：样例场地底图为前端静态相对路径 `/images/layout-reference/0X-*-before.png`（`src/data/venueSamples.ts:13/35/48`），而 `src/services/sceneGen.ts:87` 要求 `http(s)://` → 选用样例场地后生成必然报「缺少有效的场地原图」；即便转为绝对地址，容器内后端也访问不到前端静态资源。修复：后端启动时把 3 张样例底图幂等预置到对象存储 `samples/`，并将这 3 个相对路径登记为可解析的样例引用；前端放行这 3 个样例路径。
- S2 CORS：`backend/app/main.py:29` `allow_origins=["*"]` + `allow_credentials=True` 改为配置化白名单。
- S3 上传：`backend/app/routers/media.py` 的 `folder` 改为枚举白名单 `avatar | plaza | venue`（前端实际取值，见 `ProfileDialog.tsx:61`、`ComposeDialog.tsx:60`、`usePendingImage('venue')`；`generated` / `samples` 仅后端内部写入）；先校验 Content-Length、限量读取再判断大小；扩展名由 content-type 推导，并校验文件头魔数与声明类型一致，不信任文件名。
- S4 JWT：`backend/app/core/config.py` 默认 secret 仅在 `APP_ENV=dev` 允许，生产环境缺失时启动失败。
- S5 限流与配额：AI 端点按用户限流（匿名用户更严格），超限返回 429。
- S6 访客项目迁移越权（2026-11-24 repo-hygiene 实施中发现）：`POST /api/v1/auth/migrate-project`（`backend/app/routers/auth.py:58`）只凭请求体中的 `from_user_id` 迁移项目，`auth_service.migrate_anon_projects` 仅校验来源是访客，不校验请求者持有该访客身份。任何正式用户只要知道某访客的 UUID 即可转走其全部项目。广场写接口均要求正式账号，访客 ID 不经 `author_id` 公开，因此利用前提是获得 UUID v4，风险中等偏低。修复：迁移接口改为接收访客 `credentialId`（前端已持久化于 localStorage `anon_credential_id`，`src/contexts/AuthContext.tsx:4`），后端经 `AnonCredentialMap` 反查访客账号，以「持有凭证」证明所有权；不再接受裸 `from_user_id`。

### 工程
- E1 AI 异步任务落库：替换进程内 `_VISION_TASKS` / `_SCENE_TASKS`（`vision.py:14`、`img_gen.py:16`）为 `ai_task` 表（owner、type、status、result、error、时间戳），查询校验归属；后台任务持有引用并在 lifespan 中优雅关闭。
- E2 共享 `httpx.AsyncClient`（lifespan 管理），替换每请求新建客户端。
- E3 领域异常 + 全局异常处理器，service/provider 层不再直接抛 `HTTPException`。
- E4 结构化日志与 request id。
- E5 `pytest` + `pytest-asyncio` + `httpx.ASGITransport` 测试骨架（测试库用 Postgres 容器或 SQLite 兼容层，design 中定）；`ruff` 配置；CI 增加后端 job。
- E6 `Project` 增加 `version` 列做乐观锁，PATCH 版本冲突返回 409。

## Acceptance Criteria

- [ ] 提交 `http://169.254.169.254/...` 或任意非本桶 URL 到识图/生图接口返回 400，且服务端不发起外部请求（测试断言）。
- [ ] 选用 3 组样例场地之一后提交布置生图，后端能读取底图并进入任务流程（不再报「缺少有效的场地原图」）。
- [ ] 上传 `folder` 不在白名单、或文件头与声明类型不符时返回 400。
- [ ] 后端重启后，未完成/已完成的 AI 任务状态可查询；他人任务 ID 查询返回 404。
- [ ] 超出限流阈值返回 429（测试覆盖）。
- [ ] 不持有访客凭证时调用迁移接口返回 403，项目归属不变（测试覆盖）。
- [ ] `ruff check` 与 `pytest` 在 CI 中通过，覆盖 auth、project、media、ai 任务的核心路径。
- [ ] 同一项目两个并发 PATCH，后到且版本过期者得到 409。
