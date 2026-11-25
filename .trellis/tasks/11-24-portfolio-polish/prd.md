# SceneFlow 作品集化优化（父任务）

## Goal

把 SceneFlow 打磨成可公开展示、面向「AI + 后端」求职方向的作品：面试官 clone 后无需任何 API key 即可一条命令跑起来体验完整流程，README 能在 5 分钟内讲清楚「解决了什么 AI 工程问题、怎么证明」。

## Background（2026-11-24 审查确认的事实）

- 作者定位：2026 届软件工程毕业生，方向 AI + 后端；本项目与 ChatPartner 组成作品组合（ChatPartner 因 API key 不可用暂缓）。
- 项目最初由「秒哒」AI 应用平台生成原型（15 个提交作者均为 `miaoda`），后续完成 FastAPI 后端解耦（`11-16-fastapi-decoupling`）。
- 当前无可用 LLM / 生图 API key → 所有验证必须能在无 key 下完成（Mock Provider 是前置能力）。
- 前端：`tsgo` 类型检查与 `biome lint` 通过；构建产物单 JS 1.22 MB（gzip 395 KB）、CSS 825 KB（6 个 fontsource 字重 → 1176 个字体文件）。
- 后端：`/api/v1/ai/chat` 透传前端任意 `messages` 与 `model`（`backend/app/routers/ai.py:19`），约 400 行系统提示词位于前端 `src/services/ai.ts:18`。
- 前后端均无测试文件；无 CI；无 LICENSE。

## Task Map

| 顺序 | 子任务 | 交付物 | 依赖 |
|---|---|---|---|
| 1 | `11-24-repo-hygiene` | 仓库门面与工程卫生 | 无 |
| 2 | `11-24-backend-hardening` | 安全修复 + 工程基座（pytest/ruff/CI 后端部分） | 1（CI 骨架） |
| 3 | `11-24-ai-orchestration` | AI 编排后端化 + Provider 抽象 + Mock 演示模式 + 离线评测 | 2（异常体系、共享 HTTP 客户端、任务表） |
| 4 | `11-24-frontend-perf-ux` | 前端性能与 UI 细节 | 3（ai.ts 改造后再拆 Workbench 更安全） |

每个子任务独立规划、独立实现与检查、独立提交；开始某个子任务前必须完成其 PRD（复杂子任务含 design.md / implement.md）并获得用户确认。

## Cross-Child Acceptance Criteria

- [ ] 全新环境 `cp .env.example .env && docker compose up -d --build` 在**不填任何 key** 的情况下可完整体验：AI 共策对话 → 生成方案 → 场地识别 → 布置效果图 → 预览导出。
- [ ] CI（GitHub Actions）在 PR 上运行：前端 lint + typecheck + build，后端 ruff + pytest，全部通过。
- [ ] README 包含：一句话定位、演示 GIF/截图、架构图、关键工程决策、「AI 协作开发方式」、本地与 Docker 运行方式、Mock 与真实 Provider 切换说明。
- [ ] 不引入功能回退：现有页面（首页、找灵感、案例、场景布置、广场、工作台、预览）在 Mock 模式下可正常使用。

## Decisions

- **D1 原型来源（2026-11-24 用户确认）**：秒哒与 Claude 同属开发工具，不单独说明也不刻意隐藏。不改写 git 历史；README 不专门提及秒哒，改设「AI 协作开发方式」章节，如实描述以 AI agent + Trellis（规格 → 任务 → 实现 → 检查）驱动开发；仓库中的秒哒脚手架残留（包名、`.rules` 中的 `miaoda-gg.com`、秒哒 CDN 外链图、旧任务）作为工程卫生项清理。
- **D2 可讲解性**：项目代码主要由 AI 生成，因此每个子任务的 design.md 必须写清关键取舍（为什么这样做、放弃了什么），作为作者的面试讲解依据。
- 不在本轮新增通用 Agent / RAG / 论坛类功能；亮点集中在「AI 编排后端化 + 结构化输出 + 评测 + 安全」。
- 不改写 git 历史以外的任何远程状态；推送与 PR 需用户确认。

## Out of Scope

- ChatPartner、page-pilot 等其他仓库。
- 新产品功能、新页面、暗色模式。
- 生产级部署（云主机、域名、HTTPS）；仅保证 Docker Compose 本地一键启动。

## Open Questions（阻塞规划）

1. AI 工具目录（`.agent/ .agents/ .claude/ .codex/ .cursor/`，共约 200 个 Trellis 生成文件）是否继续纳入版本控制。
