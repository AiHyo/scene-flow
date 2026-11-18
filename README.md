# SceneFlow AI

中文 AI 活动策划与场景呈现工作台（React + Vite + FastAPI + PostgreSQL + MinIO）。

## 技术栈

- **前端**：React 18、TypeScript、Vite、Tailwind CSS、Radix UI
- **后端**：Python、FastAPI、SQLAlchemy 2.0 (async)、Alembic
- **基础设施**：PostgreSQL 17、MinIO (S3 兼容对象存储)、Docker Compose

## 目录结构

```
├── backend/              # FastAPI 独立后端服务与 Alembic 迁移
├── docker/               # Nginx 反向代理配置
├── docs/                 # 需求与设计文档
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

在 `.env` 中填入你的 `LLM_API_KEY`（OpenAI 兼容协议）以及可选的 `IMG_GEN_BASE_URL` / `IMG_GEN_API_KEY`；生产环境请替换 `JWT_SECRET`。

### 2. 本地开发（推荐）

先启动数据库与对象存储：

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

启动前端：

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
