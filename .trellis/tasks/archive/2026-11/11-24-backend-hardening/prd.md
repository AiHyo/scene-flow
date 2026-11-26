# 后端安全与工程基座

## Goal

修掉公开仓库中会被资深读者一眼指出的安全问题，并为后续 AI 编排改造打好工程地基：可测试、可观测、可多实例部署。技术方案见 `design.md`，执行步骤见 `implement.md`。

## Requirements

### 安全
- **S1 SSRF**：`backend/app/providers/vision.py` 的 `_to_data_url` 与 `backend/app/providers/img_gen.py` 的 `_run_openai_edit_task` 会抓取用户提交的任意 URL。改为仅接受本桶对象与已登记样例，通过存储客户端读取，服务端不再按用户提供的 URL 发起请求。
- **S1b 样例场地生图失效（现存 bug，与 S1 同源）**：样例底图是前端静态相对路径 `/images/layout-reference/0X-*-before.png`（`src/data/venueSamples.ts:13/35/48`），而 `src/services/sceneGen.ts:87` 要求 `http(s)://`，所以选用样例场地后生成必然报「缺少有效的场地原图」；即便改成绝对地址，容器内的后端也访问不到前端静态资源。修复：后端启动时把 3 张样例底图幂等预置到对象存储 `samples/`，并把这 3 个相对路径登记为可解析引用；前端放行这 3 个路径。
- **S2 CORS**：`backend/app/main.py:29` 的 `allow_origins=["*"]` + `allow_credentials=True` 改为配置化白名单。
- **S3 上传**：`backend/app/routers/media.py` 的 `folder` 改为白名单 `avatar | plaza | venue`（前端实际取值：`ProfileDialog.tsx:61`、`ComposeDialog.tsx:60`、`usePendingImage('venue')`；`generated` / `samples` 仅供后端内部写入）。先检查 Content-Length、限量读取，再判断大小；扩展名由 content-type 推导，并校验文件头魔数与声明类型一致，不信任文件名。
- **S4 JWT**：`backend/app/core/config.py` 的默认 secret 只允许在 `APP_ENV=dev` 下使用；prod 环境缺失或过弱时启动失败。
- **S5 限流**：AI 端点按用户限流，访客更严格，超限返回 429。
- **S6 访客项目迁移越权**（repo-hygiene 实施中发现）：`POST /api/v1/auth/migrate-project`（`backend/app/routers/auth.py:58`）只凭请求体中的 `from_user_id` 迁移项目，`auth_service.migrate_anon_projects` 只校验来源是访客，不校验请求者是否持有该访客身份；任何正式用户只要知道某个访客的 UUID，就能转走其全部项目。广场写接口要求正式账号，访客 ID 不会经 `author_id` 公开，利用前提是拿到 UUID v4，风险中等偏低。修复：改为接收访客 `credentialId`（前端已持久化在 localStorage `anon_credential_id`，`src/contexts/AuthContext.tsx:4`，登录后不清除），后端经 `AnonCredentialMap` 反查访客账号，以「持有凭证」证明所有权。

### 工程
- **E1 AI 异步任务落库**：用 `ai_task` 表替换进程内的 `_VISION_TASKS` / `_SCENE_TASKS`（`vision.py:14`、`img_gen.py:16`）；查询时校验归属；后台任务持有引用，在 lifespan 中优雅关闭；重启后未完成的任务标记为失败。前端轮询契约（`retCode` / `task_status`）保持不变。
- **E2 共享 HTTP 客户端**：由 lifespan 管理一个 `httpx.AsyncClient`，替换每个请求新建客户端的做法。
- **E3 领域异常**：引入 `AppError` 层级与全局异常处理器，service / provider 层不再直接抛 `HTTPException`；错误体保留前端依赖的 `detail` 键。
- **E4 日志与 request id**：`X-Request-ID` 贯穿请求与后台任务日志。
- **E5 测试与工具**：pytest + pytest-asyncio + ASGI 客户端 + respx，测试使用真实 Postgres；ruff 检查与格式化；CI 新增后端 job。
- **E6 乐观锁**：`project` 增加 `version` 列；PATCH 接受可选的 `expectedVersion`，版本冲突返回 409 与 `currentVersion`。
  - **冲突交互（用户确认：方案 A）**：工作台保存遇到 409 时停止保存队列，弹窗提示「这个活动已在其他窗口更新」，提供两个选项：「加载最新版本」（当前改动另存为本地冲突备份，不丢失）和「用我的版本覆盖」（以服务端当前版本号重新提交）。
  - 本地草稿须记录其基于的版本号；加载时自动恢复草稿并重发保存的路径（`src/pages/Workbench.tsx:297-305`）同样受版本校验，不得绕过冲突检测。

## Acceptance Criteria

- [ ] 把 `http://169.254.169.254/...`、任意非本桶 URL 或 `data:` URL 提交到识图 / 生图接口返回 400，且服务端不发起外部请求（respx 严格模式断言）。
- [ ] 选用 3 组样例场地之一后提交布置生图，后端能读取底图并进入任务流程，不再报「缺少有效的场地原图」。
- [ ] 上传的 `folder` 不在白名单、或文件头与声明类型不符时返回 400；超过大小上限返回 413。
- [ ] prod 环境使用默认或过短的 JWT secret 时后端拒绝启动。
- [ ] 后端重启后，此前 `running` 的 AI 任务查询结果为失败而不是永远处理中；用他人任务 ID 查询返回 404。
- [ ] 超出限流阈值返回 429 并带 `Retry-After`。
- [ ] 不持有访客凭证时调用迁移接口被拒绝，项目归属不变。
- [ ] 同一项目的两个 PATCH，携带过期版本者得到 409；不携带版本时无条件更新。
- [ ] 两个浏览器窗口打开同一活动并先后修改：后保存的窗口出现冲突弹窗；选「加载最新版本」后显示另一窗口的内容，本地改动保留在冲突备份中；选「用我的版本覆盖」后服务端为本窗口内容（Playwright 双上下文脚本验证）。
- [ ] `ruff check`、`ruff format --check` 与 `pytest` 在 CI 中通过，覆盖 auth、project、media、AI 任务的核心路径；`pnpm lint` 通过。
- [ ] `alembic downgrade` / `upgrade` 往返成功。

## Out of Scope

- 提示词与模式编排迁移、Mock Provider、结构化输出（属于 ai-orchestration）。
- 引入 Redis、Celery 等新基础设施（取舍见 design.md §6、§7）。
- 字段级三方合并（取舍见 design.md §9）。
- 前端性能与 UI 改动（属于 frontend-perf-ux）。
