# SceneFlow AI

面向个人、团队与活动组织者的中文 AI 活动策划与场景呈现工作台（React + Vite + FastAPI + PostgreSQL + MinIO）。

## 核心功能

- **四幕式动态首页**：活动主题叙事、筹备痛点梳理、AI 共策过程演示与场地布置前后拖拽对比。
- **AI 协同策划工作台**：流式多轮对话策划、活动方案/流程/预算/物料/文案结构化生成、场地照片识别与结构一致性布置效果图生成、全景预览与 PDF 导出。
- **独立场景布置 & 案例探索**：提供草坪、多功能大厅、中式庭院等场地参考对比与一键复用。
- **活动广场 & 资源库**：社区动态发布、图片上传、点赞与单级评论，以及活动灵感与物料资源参考。

## 技术栈

- **前端**：React 18、TypeScript、Vite、Tailwind CSS、Radix UI
- **后端**：Python、FastAPI、SQLAlchemy 2.0 (async)、Alembic
- **基础设施**：PostgreSQL 17、MinIO (S3 兼容对象存储)、Docker Compose

## 目录结构

```
├── backend/              # FastAPI 独立后端服务与 Alembic 数据库迁移
├── docker/               # Nginx 反向代理配置
├── docs/                 # 需求文档
├── public/               # 静态资源
├── src/                  # 前端源码
├── docker-compose.yml    # 全栈编排（postgres / minio / backend / frontend）
└── .env.example          # 环境变量模板
```

## 快速开始

### 1. 配置环境变量

```bash
cp .env.example .env
```

按需修改 `.env` 中的配置项：
- `LLM_BASE_URL` / `LLM_API_KEY` / `LLM_MODEL` / `LLM_VISION_MODEL`：OpenAI 兼容协议对话与识图模型配置。
- `IMG_GEN_PROVIDER` / `IMG_GEN_MODEL`：场景生图配置（默认 `openai` 走 `/v1/images/edits`，未单独设置 `IMG_GEN_BASE_URL` / `IMG_GEN_API_KEY` 时自动复用 `LLM_*`；如需可灵协议可设为 `kling` 并填写对应端点与密钥）。
- `JWT_SECRET`：生产环境务必替换为 32 位以上的随机密钥。

### 2. 本地开发（推荐）

先通过 Docker 启动 PostgreSQL 与 MinIO：

```bash
docker compose up -d postgres minio
```

启动后端（首次需创建虚拟环境并执行数据库迁移）：

```bash
cd backend
python3 -m venv .venv
.venv/bin/pip install -e .
.venv/bin/alembic upgrade head
.venv/bin/uvicorn app.main:app --reload --port 8000
```

启动前端（仓库根目录下执行）：

```bash
npm install
npm run dev -- --host 127.0.0.1
```

- 前端访问地址：`http://127.0.0.1:5173`（`/api/*` 自动代理至 `127.0.0.1:8000`）
- 后端 OpenAPI 文档：`http://127.0.0.1:8000/docs`

### 3. Docker Compose 一键部署

```bash
docker compose up -d --build
```

部署后访问 `http://127.0.0.1:8080`。
