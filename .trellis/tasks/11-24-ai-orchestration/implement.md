# ai-orchestration 实施计划

每步完成后运行验证命令并单独提交；失败即回退该步。

## 通用验证

```bash
# 后端（需测试库，见 README「常用命令」）
cd backend && uv run ruff check . && uv run ruff format --check . && TEST_DATABASE_URL=... uv run pytest -q
# 前端
pnpm lint
```

## 步骤

### 1. Provider 抽象与演示模式基座
- [ ] `app/ai/providers/`：`LLMProvider` / `VisionProvider` / `ImageGenProvider` 协议；把现有 `providers/llm.py`、`vision.py`、`img_gen.py` 迁入 OpenAI 兼容与 Kling 实现。
- [ ] `AI_PROVIDER=auto|openai|mock` 与 `LLM_STRUCTURED_OUTPUT` 配置；`get_providers()` 依赖。
- [ ] Mock 实现：识图固定描述；生图仅样例场地返回预置「布置后」图（预置 `samples/*-after.png`），自传照片明确拒绝。
- [ ] `GET /api/v1/ai/status`。
- [ ] 测试：auto 在无 key 时选 mock、有 key 时选 openai；mock 识图 / 生图经现有接口跑通；backend-hardening 的 81 个测试保持通过。

### 2. 提示词模板化与组装逻辑移植
- [ ] `app/ai/prompts/*.md` + 加载器 + `PROMPT_VERSION`；规则重新编号。
- [ ] 无损测试：从现有 `SYSTEM_PROMPT` 每条规则提取关键短语，断言新模板全部包含。
- [ ] `app/ai/assemble.py`：移植 `summarize`、`chatHistoryMessages`、`cleanTypeName`、`knownTotal` / `unpricedItems`、`deriveTimeRange`。
- [ ] Golden 测试：vitest 脚本对 fixture 快照运行 TS 原函数导出 JSON → `backend/tests/golden/`；Python 输出逐字比对。

### 3. 新接口与结构化输出
- [ ] Pydantic 快照模型（宽松）与 4 个输出模型。
- [ ] `POST /api/v1/ai/plan/chat`（SSE）与 `POST /api/v1/ai/plan/{mode}`；json_schema → 校验 → 一次修复重试 → 502。
- [ ] 计入 `kind=chat` 限流。
- [ ] 测试（respx）：结构化成功、首次非法后修复成功、两次非法返回 502、请求体中携带 `messages` / `model` 被拒（422）、限流生效。

### 4. 前端切换
- [ ] `aiChat` 改调新接口，发送快照、选项与合作资源 / 灵感命中条目（结构化）；签名不变。
- [ ] 删除前端 `SYSTEM_PROMPT`、`JSON_INSTRUCTIONS`、`summarize` 等已迁移代码；删除后端旧 `/api/v1/ai/chat`。
- [ ] 工作台顶栏「演示模式」标识（`/ai/status`）。
- [ ] 验证：`grep -rn "你是「SceneFlow AI」" src` 无结果；`pnpm lint`。

### 5. 演示模式完整流程
- [ ] Mock chat 预置回复（含协议行）与 4 个结构化模式 fixture。
- [ ] 端到端：隔离 Docker 全栈**不带 key**，Playwright 走通「AI 共策输入 → 进入工作台 → 对话 → 生成方向 → 主题 → 完整方案 → 文案 → 调整建议确认 → 样例场地生图」，界面显示演示模式标识（脚本放 `e2e/`）。

### 6. 离线评测
- [ ] `backend/evals/` 框架、≥ 15 条用例、Markdown 报告。
- [ ] CI 运行 mock 评测（作为 pytest 用例）；CI 不发起任何模型调用（PRD 决策 AO1）。
- [ ] 报告头部写入 `promptVersion`、模型名、时间；CI 新增检查：`PROMPT_VERSION` 必须等于 `docs/evals/` 最新 live 报告的版本（AO2）。
- [ ] 用 CPA 真实模型运行 live 评测并提交报告；本地演示「只改版本号不更新报告 → 检查失败」。
- [ ] 步骤 2、3 中每次改动提示词或组装逻辑后，当场用真实模型冒烟（不必等到本步），发现问题当场修。

### 7. 文档与合并
- [ ] README：架构图更新、「AI 编排」工程要点（问题 / 做法 / 验证）、演示模式与真实模型切换、评测结果摘要。
- [ ] `.trellis/spec/backend/`：提示词、Provider、评测约定。
- [ ] finish-work → 快进合并 main → 确认 CI。

## 风险

| 风险 | 应对 |
|---|---|
| TS → Python 移植产生细微文案差异，改变模型行为 | golden 逐字比对 |
| 提示词整理时丢规则 | 关键短语无损测试 |
| 前端仍有遗漏的调用路径 | 删除旧 `/ai/chat` 后，任何遗漏都会在 e2e 中以 404 暴露 |
| live 评测消耗 CPA 额度 | 只按需手动运行；用例数控制在 15–20 |
