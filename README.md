# SceneFlow AI

[![CI](https://github.com/AiHyo/scene-flow/actions/workflows/ci.yml/badge.svg)](https://github.com/AiHyo/scene-flow/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)

> 和 AI 一起策划一场活动：多轮对话梳理需求，生成方案、流程、预算与文案；上传一张空场地照片，在**保留原有建筑结构**的前提下生成布置效果图。

![首页](docs/images/home.jpg)

| AI 共同策划 | 场地布置前后对比 |
|---|---|
| ![AI 共同策划](docs/images/plan.jpg) | ![场景布置](docs/images/scene.jpg) |

<p>
  <img src="docs/images/mobile-home.jpg" width="240" alt="移动端首页" />
  <img src="docs/images/mobile-plan.jpg" width="240" alt="移动端 AI 共策" />
</p>

## 核心功能

- **AI 协同策划工作台**：流式多轮对话；按需生成活动方向、主题、完整方案（流程 / 预算 / 物料 / 任务）与邀请函、主持词等文案；对话中提出的跨模块修改以「调整建议卡」呈现，确认后才写入方案。
- **场地识别与布置效果图**：上传场地照片，先由视觉模型读取画面内可见的空间结构，再以原图为编辑目标生成布置图，约束只新增可移动物件、不改墙体门窗与机位。
- **预算与事实约束**：预算结余 / 超支按有符号差值计算；提示词约束模型把未确认的人数、价格、负责人标注为「建议，待确认」，不编造人名与商家。
- **案例、灵感与资源库**：整套案例一键复制到工作台继续改；灵感布置参考与物料资源。
- **活动广场**：动态发布、多图上传、点赞与评论。
- **访客即用**：无需注册即可开始策划；登录后可选择把访客期间的项目归入账号。
- **无密钥演示**：不配置任何模型密钥也能走通完整流程，界面明确标注「演示模式」。

## 技术栈

| 层 | 技术 |
|---|---|
| 前端 | React 18、TypeScript、Vite、Tailwind CSS、Radix UI、GSAP |
| 后端 | Python、FastAPI、SQLAlchemy 2.0（async）、Alembic、Pydantic v2 |
| AI | OpenAI 兼容协议（对话 / 视觉）、`/v1/images/edits` 或可灵 Omni（生图） |
| 基础设施 | PostgreSQL 17、MinIO（S3 兼容）、Nginx、Docker Compose |
| 工程 | pnpm、tsgo 类型检查、Biome、ast-grep 自定义规则、GitHub Actions |

## 架构

```mermaid
flowchart LR
    B["浏览器 React SPA<br/>只发送数据：项目快照 / 用户话语 / 选项"] -->|/api| N[Nginx]
    N --> A[FastAPI]
    subgraph AI["AI 编排（backend/app/ai）"]
        T["版本化提示词模板<br/>+ 组装逻辑"] --> S["结构化输出<br/>json_schema → 校验 → 修复重试"]
        S --> PR{"Provider"}
    end
    A --> AI
    PR -->|有密钥| L["OpenAI 兼容模型<br/>对话 / 识图 / 生图"]
    PR -->|无密钥| D["演示模式 Mock"]
    A --> P[(PostgreSQL<br/>业务数据 + ai_task)]
    A --> M[(MinIO 对象存储)]
```

- **提示词归后端所有**：前端不再包含任何提示词，请求里不能携带 `messages` / `model`；后端按模式组装提示词并选择模型，密钥只存在于服务端。
- 生图与识图为异步任务：状态落库（`ai_task`），前端轮询，生成的图片转存到 MinIO，避免上游临时链接过期。

### AI 编排工程要点

| 问题 | 做法 | 验证 |
|---|---|---|
| **提示词在前端**：约 400 行系统提示词由浏览器拼装，后端透传任意 `messages` 与 `model` | 提示词与组装逻辑迁到后端（`app/ai/prompts`、`assemble.py`），接口只接收数据 | **golden 测试**：在 vitest 中运行原 TS 实现截获 45 种场景的完整请求，Python 移植逐字一致；携带 `messages` / `model` 的请求返回 422 |
| **结构化结果靠正则截取**：从自由文本里 `slice` 出 JSON | 4 个生成模式定义 Pydantic schema，以 `json_schema strict` 约束输出，校验失败带错误信息修复重试一次，仍失败返回可读的 502 | 修复成功、两次失败、枚举与数量越界均有测试；真实模型 19 个用例修复重试 0 次 |
| **提示词无版本、无测试**：规则编号重复乱序 | 模板版本化，`VERSION` 记录全部模板的内容哈希；规则按顺序重新编号，正文逐字保留 | 无损测试保证原有 25 条规则全部在；改模板不升版本即失败 |
| **改了提示词怎么知道变好还是变坏** | 19 条离线评测用例对应具体规则（超支说法、只改配色不越界、不编造人名、主题逐字采用、文案跨日……）；用真实模型运行时**录制原始输出与请求哈希** | **CI 不调用模型**：回放录制结果，任一用例的请求变了就精确指出需要重新实测；反例对照证明断言能失败。[最新报告](docs/evals/report.md)：19/19 |
| **没有密钥就无法体验** | Provider 抽象（OpenAI 兼容 / 可灵 / Mock），未配置密钥自动进入演示模式；预置回复使用与真实模型相同的协议行，界面标注「演示模式」，自传照片不冒充生成效果 | 无密钥 Docker 全栈中 Playwright 走通 对话 → 方向 → 方案 → 主题 → 文案 → 调整确认 → 样例场地生图（13 项检查） |

移植中还发现并修复了原实现的一个问题：流程结束时间跨过午夜（如 23:30 开始持续 90 分钟）未被标记为跨日，文案会写成「20:00 开始，01:00 结束」；修复后真实模型写出「活动跨夜至次日 01:00 结束」。

### 后端工程要点

| 问题 | 做法 | 验证 |
|---|---|---|
| **SSRF**：识图 / 生图要读取用户指定的图片 | 所有图片引用经唯一入口 `app/ai/image_refs.py` 解析，只接受本桶对象与登记过的样例场地，通过存储客户端读取，服务端从不按用户给的 URL 发请求 | 9 类恶意地址（云元数据、内网 MinIO、相似域名、`data:`、路径穿越等）全部 400；用两种故意植入的漏洞做变异测试，确认测试能抓到 |
| **任务丢失 / 无法多实例**：异步任务原先存在进程内存 | `ai_task` 表持久化状态，任意实例都能响应轮询；查询按归属过滤；重启时把中断的任务标记失败，前端不会无限轮询 | 他人任务 ID 返回 404；模拟重启后状态正确 |
| **AI 接口被刷** | 以 `ai_task` 作为用量账本按小时计数，访客更严格；Postgres 咨询锁让「计数 + 写入」原子化，锁等待限时 5 秒 | 8 个并发请求、阈值 3，恰好放行 3 个；超限返回 429 + `Retry-After` |
| **多窗口互相覆盖** | 项目乐观锁：版本校验与写入在同一条 `UPDATE ... WHERE version = ?` 中完成；冲突时前端弹窗让用户选择「加载最新」或「覆盖」，本地改动先备份 | 5 个并发写入者仅 1 个成功；Playwright 双窗口端到端验证两种选择 |
| **越权** | 访客项目迁移改为出示本机访客凭证，不再接受可能泄露的用户 ID | 只知道 UUID 的请求被拒，项目归属不变 |
| **可观测** | 统一错误体 `{detail, code}`；`X-Request-ID` 贯穿请求与后台任务日志；上游错误统一 502，不把服务商的 401 误报成会话过期 | 错误格式与请求 ID 回传均有测试 |

后端共 81 个测试，使用真实 PostgreSQL 与真实 Alembic 迁移（不用 SQLite 替身），外部 HTTP 由 respx 严格拦截。

## 快速开始

### 方式一：Docker Compose 一键启动

```bash
cp .env.example .env     # 按需填写 LLM_API_KEY 等配置
docker compose up -d --build
```

访问 <http://127.0.0.1:8080>，后端 API 文档在 <http://127.0.0.1:8000/docs>。

### 方式二：本地开发

需要 Node.js 24+、pnpm 12、Python 3.11+、Docker（用于数据库与对象存储）。

```bash
# 1. 启动 PostgreSQL 与 MinIO
docker compose up -d postgres minio

# 2. 启动后端
cd backend
python3 -m venv .venv
.venv/bin/pip install -e .
.venv/bin/alembic upgrade head
.venv/bin/uvicorn app.main:app --reload --port 8000

# 3. 启动前端（仓库根目录）
pnpm install
pnpm dev --host 127.0.0.1
```

前端地址 <http://127.0.0.1:5173>，`/api/*` 自动代理到 `127.0.0.1:8000`。

### 环境变量

| 变量 | 说明 |
|---|---|
| `LLM_BASE_URL` / `LLM_API_KEY` / `LLM_MODEL` / `LLM_VISION_MODEL` | OpenAI 兼容协议的对话与识图模型 |
| `IMG_GEN_PROVIDER` / `IMG_GEN_MODEL` | 生图配置，默认 `openai`（`/v1/images/edits`）；未单独设置 `IMG_GEN_BASE_URL` / `IMG_GEN_API_KEY` 时复用 `LLM_*`；设为 `kling` 时需填写可灵端点与密钥 |
| `JWT_SECRET` | 生产环境务必替换为 32 位以上随机字符串 |
| `AI_PROVIDER` | `auto`（默认）：配置了 `LLM_API_KEY` 用真实模型，否则进入演示模式；也可显式设为 `openai` / `mock` |
| `LLM_STRUCTURED_OUTPUT` | `json_schema`（默认，服务端强约束）；服务商不支持时设为 `prompt` |

完整列表见 [`.env.example`](./.env.example)。**不配置任何密钥也能运行**：后端自动进入演示模式，AI 回复与生成内容为预置示例（界面顶部会标注「演示模式」），效果图仅支持样例场地。

## 项目结构

```
├── backend/          # FastAPI 服务：routers → services → models；ai/ 为 AI 编排（提示词、Provider、任务、限流），storage 封装 MinIO
│   ├── evals/        # 提示词离线评测用例与运行器（结果见 docs/evals/）
│   └── alembic/      # 数据库迁移
├── src/
│   ├── pages/        # 路由页面（首页、共策、工作台、场景布置、案例、广场等）
│   ├── components/   # 业务组件与 ui/ 基础组件
│   ├── services/     # API 调用、预算计算、方案补丁、对话协议行解析等领域逻辑
│   └── data/         # 案例、灵感、合作资源等预置数据
├── e2e/              # Playwright 端到端脚本（在隔离的 Docker 全栈中运行）
├── docker/           # Nginx 配置
├── .rules/           # ast-grep 自定义 lint 规则
└── .trellis/         # AI 协作开发的规格、任务与开发日志（见下文）
```

## 常用命令

```bash
pnpm lint     # tsgo 类型检查 + Biome + ast-grep 规则 + Tailwind 校验 + 构建冒烟测试
pnpm build    # 生产构建
```

后端测试需要一个可随意清空的 PostgreSQL 数据库：

```bash
docker run -d --name sceneflow-test-pg -e POSTGRES_USER=sceneflow -e POSTGRES_PASSWORD=sceneflow_test \
  -e POSTGRES_DB=sceneflow_test -p 127.0.0.1:55432:5432 postgres:17

cd backend
uv venv && uv pip install -e ".[dev]"
uv run ruff check . && uv run ruff format --check .
TEST_DATABASE_URL=postgresql+asyncpg://sceneflow:sceneflow_test@127.0.0.1:55432/sceneflow_test uv run pytest
```

多窗口冲突的端到端测试在隔离的全栈环境中运行（独立容器名与端口，不影响本地环境）：

```bash
docker compose -p sf-e2e -f docker-compose.yml -f e2e/compose.e2e.yml up -d --build
pnpm e2e:conflict        # 使用本机 Chrome：E2E_CHANNEL=chrome pnpm e2e:conflict
docker compose -p sf-e2e -f docker-compose.yml -f e2e/compose.e2e.yml down -v --rmi local
```

无密钥演示模式的完整流程（即使本机 `.env` 配置了密钥，`compose.demo.yml` 也会强制演示模式）：

```bash
docker compose -p sf-e2e -f docker-compose.yml -f e2e/compose.e2e.yml -f e2e/compose.demo.yml up -d --build
pnpm e2e:demo
docker compose -p sf-e2e -f docker-compose.yml -f e2e/compose.e2e.yml -f e2e/compose.demo.yml down -v --rmi local
```

### 修改提示词

改动 `backend/app/ai/prompts/`、组装逻辑或评测用例后：

```bash
cd backend
# 1. 升级 prompts/VERSION（测试失败信息会给出新的内容哈希）
# 2. 用 .env 中的真实模型跑评测，结果写入 docs/evals/
uv run python -m evals.run --live          # 只重跑部分用例：--only chat-overspent theme-verbatim
# 3. 连同 docs/evals/ 一起提交；CI 回放录制结果，不调用模型
```

## 路线图

- [x] **AI 编排后端化**：提示词与模式编排迁到后端，结构化输出 + Pydantic 校验，Provider 抽象（见「AI 编排工程要点」）
- [x] **无密钥演示模式**：clone 后无需任何 API key 即可体验完整流程
- [x] **离线评测**：19 条规则用例，真实模型录制 + CI 回放（[报告](docs/evals/report.md)）
- [x] **后端安全加固**：SSRF 白名单、AI 任务持久化与归属校验、按用户限流、乐观锁、后端测试（见「后端工程要点」）
- [ ] **前端性能与体验**：路由懒加载、字体与图片瘦身、拆分巨型组件
- [ ] **对话协议结构化**：把对话中的「建议方向 / 调整建议」等协议行改为结构化事件流

## AI 协作开发方式

本项目以 AI 编程助手为主要开发工具，按「规格 → 任务 → 实现 → 检查」的流程推进：

- 每项改动先在 [`.trellis/tasks/`](./.trellis/tasks) 中建立任务，写明需求（`prd.md`）、技术设计（`design.md`）与实施计划（`implement.md`），评审通过后才进入实现。
- 实现后统一经过 `pnpm lint` 等检查，再按任务提交；已完成的任务归档在 `.trellis/tasks/archive/`。
- `.claude/`、`.cursor/`、`.codex/` 等目录是同一套工作流在不同 AI 工具中的配置。

## License

[MIT](./LICENSE)。第三方素材来源见 [CREDITS.md](./CREDITS.md)。
