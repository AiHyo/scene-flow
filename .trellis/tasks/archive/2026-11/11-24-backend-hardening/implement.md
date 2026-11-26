# backend-hardening 实施计划

每一步完成后都运行「验证」中的命令，通过后单独提交；任何一步失败就回退该步提交，不带着失败进入下一步。

## 通用验证命令

```bash
# 后端（backend/ 目录下）
docker compose up -d postgres            # 仓库根目录执行一次
uv run --extra dev ruff check . && uv run --extra dev ruff format --check .
TEST_DATABASE_URL=postgresql+asyncpg://sceneflow:sceneflow_dev@127.0.0.1:5432/sceneflow_test \
  uv run --extra dev pytest -q

# 前端（仓库根目录）
pnpm lint
```

## 步骤

### 1. 测试与工具基座（E5）
- [ ] `pyproject.toml`：`requires-python >= 3.11`，新增 `dev` 可选依赖（pytest、pytest-asyncio、respx、ruff）与 `[tool.ruff]`、`[tool.pytest.ini_options]` 配置。
- [ ] `backend/tests/conftest.py`：测试库创建与 `alembic upgrade head`、每例 TRUNCATE、ASGI 客户端、访客 / 正式用户登录夹具。
- [ ] 为**现有行为**补基线测试：访客登录、注册登录、项目 CRUD 与归属校验、广场发帖权限。
- [ ] 对现有代码执行 `ruff format`（仅格式，单独提交，便于审阅）。
- [ ] CI 新增 backend job（postgres service → ruff → pytest）。
- 验证：通用命令全部通过。回滚点：提交 1a（格式化）、1b（测试与 CI）。

### 2. 核心基础设施（E2、E3、E4、S2、S4）
- [ ] `core/errors.py` 与全局处理器；把 services / providers 中的 `HTTPException` 全部替换为 `AppError` 子类。
- [ ] `core/logging.py`：request id 中间件与日志配置。
- [ ] `core/http.py`：lifespan 管理的共享 `AsyncClient`；providers 改为使用它。
- [ ] `Settings`：`app_env`、`cors_origins`、prod 环境下的 JWT 校验；`main.py` 中 CORS 改为白名单。
- [ ] 测试：错误响应格式与 `X-Request-ID` 回传；prod 环境使用默认 secret 时启动失败；跨域白名单。
- 验证：通用命令；手动 `uvicorn` 启动后调用 `/health`。

### 3. 存储抽象、SSRF 与上传加固（S1、S1b、S3）
- [ ] `storage/base.py`、`S3Storage`、`MemoryStorage`、`get_storage()` 依赖；现有调用点迁移。
- [ ] `ai/image_refs.py` 解析器与样例登记表；lifespan 中幂等预置样例；`docker-compose.yml` 增加只读挂载。
- [ ] 识图与 OpenAI 生图改为通过解析器读取字节；可灵生图先校验归属再传 public_url。
- [ ] `media.py`：folder 白名单、Content-Length 预检、限量读取、魔数校验。
- [ ] 前端 `sceneGen.ts:87` 放行已登记的样例路径。
- [ ] 测试：元数据地址、外部 URL 与 `data:` URL 均返回 400，且 respx 断言无外部请求；本桶 URL 与样例路径可解析；上传非法 folder、类型伪造、超大文件分别返回 400 / 400 / 413。
- 验证：通用命令。

### 4. AI 任务持久化与限流（E1、S5）
- [ ] 迁移 `0002`（只建 `ai_task` 表；`project.version` 在步骤 6）。说明：拆成两个迁移 `0002_ai_task`、`0003_project_version`，便于单独回退。
- [ ] `ai/tasks.py`：模型、`TaskRunner`、启动恢复；识图 / 生图改为写库执行，查询校验归属；router 层映射回原有契约。
- [ ] `ai/quota.py`：窗口计数与 429 + Retry-After；对话请求写入 `kind=chat` 账本行。
- [ ] 测试：任务提交 → 轮询成功 / 失败（respx 模拟上游）；他人任务 ID 返回 404；模拟重启后 `running` 行被标记为失败；超出阈值返回 429 且带 `Retry-After`。
- 验证：通用命令；`alembic downgrade -1 && alembic upgrade head` 往返一次。

### 5. 访客迁移越权修复（S6）
- [ ] `MigrateProjectIn` 改为 `credentialId`；service 经 `AnonCredentialMap` 校验所有权。
- [ ] 前端 `AuthContext` / `AuthDialog` 改为提交访客凭证。
- [ ] 测试：持有凭证可迁移；只知道 UUID、不持有凭证时返回 422 / 403 且项目归属不变；对非访客账号的凭证返回 403。
- 验证：通用命令。

### 6. 乐观锁与冲突交互（E6，方案 A）
- [ ] 迁移 `0003_project_version`；PATCH 支持 `expectedVersion`，响应改为 `{version}`；输出模型增加 `version`。
- [ ] 前端：`api.ts`（`updateProject` 签名与草稿 `baseVersion`）、`Workbench.tsx`（`versionRef`、409 处理）、新增 `VersionConflictDialog` 组件。
- [ ] 测试（后端）：匹配版本时成功并递增；过期版本返回 409 与 `currentVersion`；不传版本时无条件更新。
- [ ] 端到端验证：Docker Compose 启动整套服务，用 Playwright 双浏览器上下文脚本跑通 PRD 中的两种冲突选择。
- 验证：通用命令 + 端到端脚本。

### 7. 文档与规范
- [ ] README 路线图勾选「后端安全加固」，补充测试命令。
- [ ] 新建 `.trellis/spec/backend/`（index、错误处理、测试约定），记录本任务确立的约定。
- 验证：`pnpm lint`。

## 风险与关注点

| 风险 | 应对 |
|---|---|
| 测试依赖本地 Docker Postgres | conftest 在 `TEST_DATABASE_URL` 未设置时跳过并给出明确提示；CI 使用 service 容器 |
| 步骤 2 大面积替换异常类型，可能遗漏 | 用 `grep -rn HTTPException backend/app/services backend/app/providers` 确认清零 |
| Workbench 保存队列逻辑复杂（`Workbench.tsx:337-380`） | 只在现有 `persist` 内增加版本参数与 409 分支，不重构队列；用端到端脚本覆盖 |
| 样例预置依赖挂载路径 | 预置失败只记录警告、不阻塞启动；样例生图时由解析器返回明确错误 |

## 开始前检查
- [ ] PRD、design、implement 经用户确认。
- [ ] `implement.jsonl` / `check.jsonl` 已登记规范条目。
