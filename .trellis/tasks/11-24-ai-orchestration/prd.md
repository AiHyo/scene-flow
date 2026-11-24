# AI 编排后端化与 Provider 抽象（含 Mock 演示模式）

> 状态：需求草稿。开始前需补 design.md / implement.md 并经用户确认。本子任务是作品集的核心亮点。

## Goal

把「AI 怎么被调用」从前端搬到后端，变成可测试、可评测、可替换模型、无 key 可演示的 AI 编排服务。

## Background

- 现状：约 400 行系统提示词 + 5 种模式指令（`chat/directions/theme/scheme/copies`）在 `src/services/ai.ts:18` 起；前端拼好 messages 后由后端透传（`backend/app/routers/ai.py:19`），客户端可指定任意 `model`。
- 结构化结果靠 `JSON.parse(cleaned.slice(start, end+1))`（`src/services/ai.ts:201`）从自由文本中截取；调整建议块靠正则提取（`ai.ts:442`）。
- 提示词编号混乱（21、22 重复，18 位于末尾），无版本、无测试。
- 前端契约：聊天为 OpenAI 格式 SSE（`src/lib/sse.ts`）；识图轮询 `retCode`（0 成功 / 1 处理中 / 其他失败，`src/services/api.ts:146`）；生图轮询 `task_status`（`src/services/sceneGen.ts:109`）。

## Requirements

- A1 后端模式化端点：例如 `POST /api/v1/projects/{id}/ai/chat`（SSE）与 `POST /api/v1/projects/{id}/ai/{mode}`（结构化），后端从数据库读取项目状态自行组装提示词；客户端不再能传入 system prompt 或任意 model。
- A2 提示词模板化：拆为版本化模板文件（system + 各模式），整理编号与重复条款，内容语义不丢失。
- A3 结构化输出：各结构化模式定义 Pydantic schema，优先使用 provider 的 JSON Schema / tool calling；不支持时回退到「解析 + 校验 + 一次修复重试」。前端删除自由文本截取 JSON 的逻辑。
- A4 Provider 抽象：`LLMProvider` / `VisionProvider` / `ImageGenProvider` 协议，实现 OpenAI 兼容、Kling（生图）与 Mock；通过配置选择，`AI_PROVIDER=auto` 时无 key 自动使用 Mock。
- A5 Mock 演示模式：按模式返回贴合场景的固定样例（流式逐字输出、可配置延迟），识图/生图返回内置样例图；前端显示「演示模式」标识。
- A6 离线评测：一组固定输入（≥15 条，覆盖各模式与边界条件：预算超支、只改配色、零新增采购等），断言 schema 合法与关键业务规则（如不编造人名、超支方向正确）；Mock 下在 CI 中运行，真实 Provider 下可手动运行并输出报告。

## Acceptance Criteria

- [ ] 前端源码中不再包含系统提示词与模式指令；`/api/v1/ai/chat` 旧透传端点移除或仅限内部。
- [ ] 无任何 key 时，完整共策流程（对话 → 方向 → 主题 → 方案 → 文案 → 调整建议确认）在 UI 中可走通，界面显示演示模式标识。
- [ ] 每个结构化模式有 schema 与单元测试；非法模型输出触发一次修复重试，仍失败时返回可读错误而非前端崩溃。
- [ ] 评测脚本在 Mock 下于 CI 通过，并能输出 Markdown 报告。
- [ ] README「工程亮点」章节描述该架构并附架构图。
