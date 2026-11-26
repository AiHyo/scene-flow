# AI 编排后端化与 Provider 抽象（含 Mock 演示模式）

## Goal

把「AI 怎么被调用」从前端搬到后端，变成可测试、可评测、可替换模型、无 key 可演示的 AI 编排服务。这是作品集的核心亮点。技术方案见 `design.md`，执行步骤见 `implement.md`。

## Background（2026-11-26 核实）

- 约 400 行系统提示词 + 5 种模式指令在 `src/services/ai.ts:18` 起；前端拼好 messages 后由后端透传（`backend/app/routers/ai.py` 的 `/api/v1/ai/chat`），客户端可指定任意 `model`。
- 结构化结果靠 `JSON.parse(cleaned.slice(start, end+1))`（`src/services/ai.ts:201`）截取；调整建议块靠正则提取（`ai.ts:439`）。
- 提示词编号混乱（19、20b、21、22、22、20、21、18），无版本、无测试。
- 4 个结构化模式的调用方不使用流式进度（`PlanModule.tsx:166/236/334/626` 的 `onChunk` 为空函数）；chat 模式流式渲染并在前端解析协议行（`AiAssistant.tsx:483/508/523`）。
- 真实模型来源：用户自建 CPA 网关 `https://cpa.ahyo.cc/v1`（经被忽略的 `.env` 配置；对话 / 识图 `gpt-6.2-sol`，生图 `gpt-image-2.6`）。实测 CPA 支持 `response_format: json_schema` strict（8.9 s，纯 JSON 且符合 schema）与工具调用（6.2 s）。

## Requirements

- **A1 后端模式化接口**：`POST /api/v1/ai/plan/chat`（SSE）与 `POST /api/v1/ai/plan/{mode}`（directions / theme / scheme / copies）。前端发送项目快照、用户话语、识图文本、选项与合作资源 / 灵感命中条目；请求体不含 `messages` / `system` / `model`。旧 `/api/v1/ai/chat` 删除。
- **A2 提示词模板化**：拆为版本化模板文件，整理编号，语义无损（关键短语测试保证）；`PROMPT_VERSION` 随响应返回。
- **A3 结构化输出**：4 个模式各有 Pydantic schema；优先 json_schema strict，失败时一次修复重试，仍失败返回可读的 502；前端删除自由文本截取 JSON 的逻辑。
- **A4 Provider 抽象**：LLM / Vision / ImageGen 协议，实现 OpenAI 兼容、Kling（生图）与 Mock；`AI_PROVIDER=auto` 时无 key 自动使用 Mock。
- **A5 演示模式**：Mock 按模式返回贴合场景的预置内容（chat 逐字流式、含协议行），识图固定描述，样例场地生图返回预置效果图，自传照片明确拒绝；前端工作台显示「演示模式」标识。
- **A6 离线评测**：≥ 15 条用例覆盖各模式与边界条件（预算超支方向、只改配色、零新增采购、用户指定主题逐字保留、不编造人名、未执行不声称已完成）；Mock 下在 CI 中运行；真实模型下手动运行并输出 Markdown 报告。
- **A7 组装逻辑等价**：移植到后端的 `summarize` 等函数与原 TS 实现逐字一致（golden 测试）。

## Acceptance Criteria

- [ ] `src/` 中不再包含系统提示词与模式指令（`grep -rn "你是「SceneFlow AI」" src` 无结果）；`/api/v1/ai/chat` 返回 404；新接口拒绝携带 `messages` / `model` 的请求。
- [ ] 不配置任何 key 的 Docker 全栈中，Playwright 走通：AI 共策输入 → 工作台对话 → 生成方向 → 主题 → 完整方案 → 文案 → 调整建议确认 → 样例场地生图；工作台显示演示模式标识。
- [ ] 配置 CPA 时同一流程使用真实模型可走通。
- [ ] 每个结构化模式有 schema 与单元测试；非法输出触发一次修复重试，仍失败返回可读错误而非前端崩溃。
- [ ] 提示词无损测试与组装逻辑 golden 测试通过。
- [ ] 评测在 Mock 下于 CI 通过；真实模型评测报告提交到 `docs/evals/`。
- [ ] README「AI 编排」工程要点（问题 / 做法 / 验证）与架构图更新。

## Out of Scope

- chat 协议行改为结构化事件流（需大改 `AiAssistant.tsx`）。
- 合作资源 / 灵感目录迁为前后端共享 JSON。
- 前端性能与 UI 改动（属于 frontend-perf-ux）。

## Open Questions（阻塞规划）

1. 真实模型评测是否进入 CI（需把 CPA key 放入 GitHub Secrets，每次推送消耗额度）。
