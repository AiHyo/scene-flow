# backend-hardening 技术设计

> 每节末尾的「取舍」记录为什么这样做、放弃了什么（父任务决策 D2），可直接作为讲解材料。

## 0. 总览

```
routers ──► services ──► models (SQLAlchemy)
   │            │
   │            ├──► core/errors      领域异常（AppError 层级）
   │            ├──► storage/         ObjectStorage 协议：S3 实现 / 内存实现（测试）
   │            ├──► ai/image_refs    图片引用解析（SSRF 白名单的唯一入口）
   │            ├──► ai/tasks         ai_task 表 + 进程内 TaskRunner
   │            └──► ai/quota         基于 ai_task 用量账本的限流
   └──► core/http (共享 httpx.AsyncClient)、core/logging (request id)
```

新增模块放在 `backend/app/core/` 与 `backend/app/ai/`；`providers/` 只负责「怎么调上游」，不再自己抓图、不再维护任务字典。

## 1. 错误体系（E3）

- `app/core/errors.py`：`AppError(status, code, message)`，子类 `BadRequest(400)`、`Unauthorized(401)`、`Forbidden(403)`、`NotFound(404)`、`Conflict(409, extra)`、`RateLimited(429, retry_after)`、`UpstreamError(502)`。
- 全局处理器：`AppError` → `{"detail": message, "code": code, ...extra}`；未捕获异常 → 500 `{"detail": "服务器内部错误", "code": "internal_error", "requestId": ...}`，堆栈只进日志。
- **兼容性**：前端 `parseErrorMessage` 读取 `detail`（`src/lib/apiClient.ts:31`），保持该键即可，无需改前端错误展示。
- 现有 service / provider 中的 `HTTPException` 全部替换为 `AppError` 子类；routers 内的参数校验仍交给 FastAPI。

取舍：没有引入 RFC 7807 `application/problem+json`，因为前端已依赖 `detail` 键，换格式只增加改动面。

## 2. 请求 ID 与日志（E4）

- 中间件读取或生成 `X-Request-ID`，写入 `contextvars`，并在响应头回传。
- `logging.dictConfig` 统一格式：`%(asctime)s %(levelname)s [%(request_id)s] %(name)s: %(message)s`，由 logging Filter 注入 request id。
- 后台任务（TaskRunner）沿用提交时的 request id，便于把「提交 → 执行 → 失败」串成一条线。

取舍：不上 JSON 结构化日志和 OpenTelemetry，本地 Compose 部署下纯文本足够，后续需要时只换 formatter。

## 3. 配置与安全默认值（S2、S4）

- `Settings` 新增：`app_env: Literal["dev", "prod"] = "dev"`、`cors_origins: list[str]`（默认 `http://localhost:5173`、`http://127.0.0.1:5173`、`http://127.0.0.1:8080`）、`sample_assets_dir`、各类限流阈值。
- `app_env == "prod"` 时，`jwt_secret` 为空、等于内置默认值或短于 32 字符 → 启动即失败（`model_validator`）。
- CORS 改为白名单，并设置 `allow_credentials=False`：前端用 `Authorization: Bearer` 头而非 Cookie，不需要凭证模式。Docker 部署经 Nginx 同源访问，CORS 只影响本地开发。

取舍：dev 环境保留默认 secret，保证「clone 即跑」；安全要求在 prod 环境强制执行。

## 4. 共享 HTTP 客户端（E2）

- `app/core/http.py`：lifespan 中创建一个 `httpx.AsyncClient`（连接池），关闭时 `aclose()`；通过 `get_http_client()` 获取，各调用按需传 `timeout=`。
- 流式对话仍用 `client.stream(...)`，响应关闭不再关闭整个客户端。

## 5. 对象存储抽象与图片引用解析（S1、S1b、S3）

### 5.1 ObjectStorage
- `app/storage/base.py` 定义协议：`put(key, data, content_type)`、`get(key) -> (bytes, content_type)`、`exists(key)`、`delete_many(keys)`、`public_url(key)`、`key_from_url(url) -> str | None`。
- `S3Storage`（现有 boto3 逻辑迁入，阻塞调用经 `asyncio.to_thread`）与 `MemoryStorage`（测试用）。通过 `get_storage()` 依赖获取，测试中替换。

### 5.2 图片引用解析：SSRF 白名单的唯一入口
`app/ai/image_refs.py`：`resolve_image_ref(ref: str) -> ResolvedImage(key, data, content_type, public_url)`

| 输入 | 处理 |
|---|---|
| 本桶公开 URL（`key_from_url` 命中） | `storage.get(key)` 读取，不发 HTTP 请求 |
| 已登记的样例路径（如 `/images/layout-reference/01-lawn-before.png`） | 映射到 `samples/01-lawn-before.png` 后从存储读取 |
| `data:` URL | 拒绝（避免任意大小的内联数据） |
| 其他任何 URL / 路径 | `BadRequest("仅支持本站上传的图片")` |

- 识图与 OpenAI 生图都改为调用 resolver 取字节，**服务端不再按用户提供的 URL 发起任何请求**。
- 可灵生图（上游自行拉取图片 URL）：先经 resolver 校验归属，再把本桶 `public_url` 交给上游；我方服务器不发起抓取，因此不构成 SSRF。

### 5.3 样例场地预置（修复 S1b）
- 样例登记表 `SAMPLE_VENUES = {"/images/layout-reference/01-lawn-before.png": "samples/01-lawn-before.png", ...}`，共 3 项，与 `src/data/venueSamples.ts` 一一对应。
- lifespan 启动时，若 `samples/<file>` 不存在，则从 `settings.sample_assets_dir` 读取并上传（幂等）。本地开发时该目录默认为仓库内的 `public/images/layout-reference`；Docker 中通过 Compose 只读挂载 `./public/images/layout-reference:/app/seed/samples:ro`。
- 前端 `src/services/sceneGen.ts:87` 改为：允许 `http(s)://` 或已登记的样例相对路径，最终由后端判定。

取舍：考虑过「前端选中样例时先上传到 MinIO」，但组件注释明确为了秒开而去掉了转存（`SceneModule.tsx:183`），并且每次选择都会产生重复对象；服务端预置一次、按登记路径映射，零重复、对前端零延迟。

### 5.4 上传加固（S3）
- `folder: Literal["avatar", "plaza", "venue"]`。
- 先检查 `Content-Length`，超过上限直接返回 413；再以 `read(MAX + 1)` 限量读取，防止伪造长度。
- 魔数校验：JPEG `FF D8 FF`、PNG `89 50 4E 47`、GIF `GIF8`、WebP `RIFF....WEBP`，必须与声明的 content-type 一致；扩展名由类型推导。

## 6. AI 任务持久化（E1）

### 6.1 表结构（迁移 `0002`）
`ai_task`：`id uuid pk`、`owner_id fk profile`、`kind enum(chat, vision, scene)`、`status enum(queued, running, succeeded, failed)`、`provider text`、`provider_task_id text null`、`input jsonb`、`result jsonb null`、`error text null`、`request_id text null`、`created_at`、`updated_at`；索引 `(owner_id, kind, created_at)`。

### 6.2 执行模型
- `TaskRunner`（进程内单例）：`submit(coro)` 创建 asyncio 任务并保存在集合中（防止被 GC），完成后移除；lifespan 关闭时取消并等待。
- 任务函数开头将状态置为 `running`，结束时写入 `succeeded/result` 或 `failed/error`，每次状态变更使用独立的短事务。
- 启动恢复：把仍处于 `queued/running` 的行标记为 `failed`（错误信息「服务重启，任务已中断，请重试」），避免前端无限轮询。
- 查询接口按 `id + owner_id` 查找，他人任务一律 404（不泄露存在性）。
- 前端契约不变：识图依旧返回 `retCode`（0 成功 / 1 处理中 / -1 失败），生图依旧返回 `task_status`（submitted / processing / succeed / failed），由 router 层把 DB 状态映射过去。

取舍：没有引入 Celery / arq + Redis。现有基础设施只有 Postgres 与 MinIO，任务量是「单用户偶发、单次数十秒」级别；进程内执行 + 状态落库已经解决了原方案的三个实际问题（重启丢失、多 worker 查不到、不校验归属）。代价是进程崩溃时执行中的任务会失败（已用启动恢复兜底），需要时可把 `TaskRunner` 换成队列消费者而不动表结构和接口。

## 7. 限流：以 ai_task 作为用量账本（S5）

- 每次 AI 调用（对话也写入一行 `kind=chat`）都在 `ai_task` 留痕，限流即统计窗口内的行数：`count(*) where owner_id=? and kind=? and created_at > now() - window`，走 6.1 的复合索引。
- 默认阈值（每小时，可配置）：

| kind | 访客 | 正式账号 |
|---|---|---|
| chat | 30 | 120 |
| vision | 10 | 40 |
| scene | 5 | 20 |

- 超限返回 429 `RateLimited`，并带 `Retry-After`（窗口内最早一条记录过期所需的秒数）。

- 实现时直接加了 `pg_advisory_xact_lock(hashtext('ai-quota:<user>:<kind>'))`，让「计数 + 写入」在同一事务内原子完成，并发突发也不会超额（测试：8 个并发请求、阈值 3，恰好 3 个成功）。锁等待用 `SET LOCAL lock_timeout = 5s` 限时，超时返回 429，绝不无限挂起。

取舍：不引入 Redis 令牌桶；多实例下天然一致，代价是每次多一条索引计数查询和一次按用户粒度的短锁（不同用户互不阻塞）。

> 实施记录：开发中观察到两次测试套件挂起，约 250 次定向重复未能复现、未找到根因。因此统一加了「不可无限等待」的护栏：咨询锁 `lock_timeout`、连接池 `pool_timeout=10`、`TaskRunner.wait_idle` 30 秒超时、`pytest-timeout` 单例 60 秒。之后再出现会以失败 + 调用栈的形式暴露，而不是挂住 CI。

## 8. 访客项目迁移越权修复（S6）

- `MigrateProjectIn`：`credentialId: str`（替换 `fromUserId`）。
- service：经 `AnonCredentialMap` 查到访客账号，不存在或已非访客 → 403；与当前用户相同 → 返回 0；随后执行原有的批量 `UPDATE`。
- 前端：`AuthDialog.merge` 改为提交 `localStorage['anon_credential_id']`（登录后不会被清除，已核实 `AuthContext.tsx:10-16`）；`prev_anon_uid` 仅用于判断「是否需要询问合并」。

## 9. 乐观锁与冲突交互（E6，交互方案 A）

### 9.1 后端
- `project.version int not null default 1`（迁移 `0002`）。
- `PATCH /api/v1/project/{id}` 请求体新增可选 `expectedVersion`：
  - 提供时执行 `UPDATE ... SET ..., version = version + 1 WHERE id = :id AND owner_id = :uid AND version = :expected RETURNING version`；0 行 → 先区分 404 / 403，否则返回 409 `{"detail": "活动已在其他窗口更新", "code": "version_conflict", "currentVersion": n}`。
  - 不提供时（如「我的活动」页改名）无条件更新并递增版本。
- 响应由 204 改为 200 `{"version": n}`；详情与列表输出均包含 `version`。

### 9.2 前端（`src/pages/Workbench.tsx`）
- `versionRef` 在加载时由服务端 `version` 初始化；`persist` 每次提交携带 `expectedVersion`，成功后更新为返回的 `version`。
- 草稿结构增加 `baseVersion`；加载时恢复草稿后重发保存，携带的是 `draft.baseVersion`，因此同样受冲突检测。
- 收到 409：停止队列，保留草稿，打开 `VersionConflictDialog`：
  - 「加载最新版本」：把当前草稿移到 `sf-draft-conflict:<user>:<project>`（不会被自动恢复），清除常规草稿，重新拉取服务端数据并覆盖本地状态，提示「你的改动已备份在本机」。
  - 「用我的版本覆盖」：以 409 返回的 `currentVersion` 作为 `expectedVersion` 重新提交当前数据。
- `src/services/api.ts` 的 `updateProject` 返回 `{ version }`，新增可选参数 `expectedVersion`。

取舍：没有做字段级三方合并。方案数据是一整块 JSONB，合并语义复杂且容易出错；冲突在「同一人多窗口」场景下才会出现，把选择权交给用户最安全。

## 10. 测试与工具（E5）

- 依赖：`pyproject.toml` 新增 `[project.optional-dependencies] dev = [pytest, pytest-asyncio, respx, ruff]`；`requires-python >= 3.11`（Dockerfile 已是 3.12，CI 用 3.12）。
- 数据库：使用真实 Postgres（模型用到 JSONB / UUID / enum，SQLite 不等价）。`TEST_DATABASE_URL` 指向独立测试库；会话开始时执行 `alembic upgrade head`（顺带验证迁移），每个用例结束后 `TRUNCATE ... CASCADE`。
- 存储：依赖覆盖为 `MemoryStorage`。上游 HTTP：`respx` 严格模式，**任何未声明的外部请求都会让测试失败**，SSRF 用例借此断言「没有发出请求」。
- 客户端：`httpx.AsyncClient(transport=ASGITransport(app))`。
- `ruff check` + `ruff format --check`；CI 新增 backend job：`services: postgres:17` → 安装依赖 → `ruff` → `pytest`。

## 11. 兼容性与回滚

- 数据库：`0002` 迁移只新增表和带默认值的列，`downgrade` 删除 `ai_task` 表与 `project.version` 列；旧前端在新后端下仍可工作（不传 `expectedVersion` 即无条件更新；204 → 200 对 `apiRequest` 透明）。
- 接口契约变化仅两处：迁移接口入参（前后端同一提交内一起改）与 PATCH 响应体（前端同步）。
- 每个实施步骤独立提交，可按提交逐个回退。
