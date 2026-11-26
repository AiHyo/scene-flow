# ai-orchestration 技术设计

> 每节末尾「取舍」写明为什么这样做、放弃了什么（父任务决策 D2）。

## 0. 现状与目标

现状（2026-11-26 核实）：

- 约 400 行系统提示词、5 种模式指令、需求摘要拼装（`summarize`）、角色身份消息、合作资源 / 灵感上下文都在前端 `src/services/ai.ts`，前端拼好 `messages` 后由后端透传（旧接口 `/api/v1/ai/chat`）。
- 4 个结构化模式（directions / theme / scheme / copies）在 `PlanModule.tsx:166/236/334/626` 调用，`onChunk` 均为空函数——不使用流式进度；结果靠 `extractJson` 从自由文本截取。
- chat 模式在 `AiAssistant.tsx:483` 流式渲染，回复中夹带协议行（「建议方向：」「建议主题：」「参考灵感：」「```调整建议 {...}```」），由前端解析（`AiAssistant.tsx:106/115/508/523`）。

目标：提示词与组装逻辑归后端所有；结构化模式由 schema 约束；模型来源可替换；无 key 可演示；有离线评测。

## 1. 边界：前端给数据，后端管提示词

```
前端                                  后端
───────────────────────────────────    ─────────────────────────────────────────────
ProjectData 快照 + userText            prompts/（版本化模板）+ assemble.py（摘要 / 上下文）
+ vision 文本 + 选项                ──► mode router ──► LLMProvider（openai 兼容 | mock）
+ 合作资源 / 灵感命中条目（结构化）       ◄── chat: SSE（OpenAI chunk 格式，不变）
                                       ◄── 结构化模式: {mode, data, promptVersion}
```

- 请求体不再包含 `messages`、`system`、`model`：客户端无法注入系统提示词或选择任意模型。
- 项目数据以**快照**形式随请求发送（Pydantic 宽松校验 + 大小上限 256 KB），后端用它组装提示词。

取舍：考虑过「后端按 projectId 从数据库读取」。但工作台有 800 ms 防抖保存，AI 调用时数据库可能落后于界面，需要先强制冲刷队列再调用，增加一次往返和失败点；而快照只影响调用者自己的提示词，篡改它不越权。安全目标（客户端不能控制系统提示词与模型）同样达成。

取舍：合作资源目录（`src/data/partnerCatalog.ts`）与灵感库（`src/data/inspiration.ts`，866 行）仍在前端被多个页面使用。本任务由前端做命中匹配，把命中条目作为**结构化字段**（`partnerHints[{name,use,scenes}]`、`inspirationHints[{title,howTo,format,needs}]`）发给后端，由后端模板负责「只可引用以下名称」等约束措辞。把两份目录迁成前后端共享 JSON 是更彻底的方案，但会改动大量与本任务无关的页面，留作后续。

## 2. 接口

| 接口 | 用途 | 响应 |
|---|---|---|
| `POST /api/v1/ai/plan/chat` | 对话（含 memOnly / noScene / detail / nickname / vision） | SSE，OpenAI `chat.completion.chunk` 格式，前端解析代码不变 |
| `POST /api/v1/ai/plan/{mode}`，mode ∈ directions / theme / scheme / copies | 结构化生成 | `{"mode", "data": <校验后的对象>, "promptVersion"}` |
| `GET /api/v1/ai/status` | 前端判断是否演示模式 | `{"mode": "live" \| "demo", "promptVersion"}` |

- 旧的 `/api/v1/ai/chat` 删除（唯一调用方 `aiChat` 同步改造）。
- 两个 plan 接口都计入 `kind=chat` 的限流账本（沿用 backend-hardening 的 `enforce_quota`）。
- 识图、生图接口路径与契约不变，内部改走 Provider。

## 3. 提示词模板化

- `backend/app/ai/prompts/`：`system.md`、`role.md`、`modes/{directions,theme,scheme,copies}.md`、`chat_bounds.md`（memOnly / noScene / 详略档位文案）。
- `PROMPT_VERSION`（如 `2026-11-26.1`）随响应返回并写入 `ai_task.input`，评测报告记录版本，便于对比。
- 整理规则编号：现有 18 → 22 编号重复、乱序（21、22 各出现两次，18 在末尾，20b）。重新编号为连续序号，**语义逐条保留**：迁移时为每条原规则提取一个关键短语，单元测试断言新模板全部包含（无损迁移的可执行证明）。

## 4. 组装逻辑移植（TS → Python）

移植 `summarize`、`chatHistoryMessages`、`cleanTypeName`、`knownTotal` / `unpricedItems`（`src/services/budgetMath.ts`）、`deriveTimeRange`（`src/services/deliverables.ts`）到 `backend/app/ai/assemble.py`。

**等价性验证**：实施时用 vitest 对一组项目快照 fixture 运行 TS 版本，导出期望输出 JSON，Python 测试逐字比对（golden test）。完成移植后前端对应函数删除，golden 文件保留在 `backend/tests/golden/` 作为回归基准。

## 5. 结构化输出

- Pydantic 模型：`DirectionsOut`、`ThemeOut`、`SchemeOut`、`CopiesOut`。schema 只约束**结构**（字段、类型、枚举如难度「低 / 中 / 较高」、条目数量范围）；字数等软规则交给提示词与评测，不做硬失败，避免反复修复重试。
- 调用顺序：
  1. provider 支持时用 `response_format: json_schema, strict: true`（已实测 CPA 支持，`gpt-6.2-sol` 返回纯 JSON 且符合 schema）；
  2. 返回内容做 Pydantic 校验；
  3. 失败时带上校验错误做**一次**修复重试；
  4. 仍失败返回 502 `structured_output_invalid`（可读错误），前端提示重试。
- 配置 `LLM_STRUCTURED_OUTPUT=json_schema | prompt`（`prompt` 表示只靠提示词约束，用于不支持的服务商）。
- 前端保留现有 `sanitizeDirection` 等字段清洗，作为第二道防线。

取舍：工具调用同样可用（实测 6.2 s），但 json_schema 语义更直接、与 OpenAI 兼容服务的支持面更广，选它作主路径。

## 6. Provider 抽象与演示模式

```python
class LLMProvider(Protocol):
    async def stream_chat(self, messages) -> AsyncIterator[bytes]: ...   # OpenAI SSE 字节流
    async def complete_json(self, messages, schema: type[BaseModel]) -> BaseModel: ...
class VisionProvider(Protocol):
    async def describe(self, question: str, image: ResolvedImage) -> str: ...
class ImageGenProvider(Protocol):
    async def edit(self, prompt: str, image: ResolvedImage) -> bytes: ...  # + Kling 异步变体
```

- 实现：`OpenAICompatible*`（现有逻辑迁入）、`Kling`（生图）、`Mock*`。
- 选择：`AI_PROVIDER=auto | openai | mock`，默认 `auto`——`LLM_API_KEY` 为空时用 mock。
- Mock 行为（演示用、确定性）：
  - chat：按用户话语关键词挑选预置回复（问候 / 给方向 / 调预算 / 只记条件 / 默认），逐字流式输出（可配置间隔），回复中包含真实协议行（「建议方向：」等），让前端的候选卡、主题采纳、调整建议卡都能被演示。
  - 结构化模式：返回 `backend/app/ai/mock/fixtures/*.json`，并通过同一 Pydantic 校验。
  - 识图：固定的场地描述。
  - 生图：样例场地返回对应的「布置后」样例图（与「布置前」一起预置到 `samples/`）；用户自传照片返回明确提示「演示模式仅支持样例场地生图，配置模型密钥后可用」，不伪造效果图。
- 前端：工作台顶栏在 `/ai/status` 为 demo 时显示「演示模式」标识，悬停说明「未配置模型密钥，AI 回复为预置示例」。

取舍：演示模式不追求「看起来像真 AI」，而是诚实标注、让完整交互可走通；自传照片拒绝生图，避免把样例图冒充用户场地的效果。

## 7. 离线评测

- `backend/evals/`：`cases/*.json`（≥ 15 条）+ `run.py`。
- 用例 = 项目快照 + 模式 + 用户话语 + 断言列表。断言类型：`schema_valid`、`count_between`、`schedule_sorted`、`verbatim_field`（用户指定的主题名逐字保留）、`regex_absent`（不编造「小王 / 小李」类人名、零新增采购时不出现「采购 / 购买」）、`budget_direction`（超支时说「超支」而非「结余」）、`no_claimed_done`（未执行不说「已更新 / 已生成」）。
- 运行：`python -m evals.run --provider mock|live --out docs/evals/<date>.md`，输出 Markdown 报告（每条用例通过 / 失败、耗时、提示词版本、模型名）。
- **CI 只跑 mock，不发起任何模型调用**（PRD 决策 AO1）；模型质量结论来自 live 报告。
- **用机制保证「改提示词必须实测」**（AO2）：报告头部记录 `promptVersion`；CI 检查 `PROMPT_VERSION` 等于 `docs/evals/` 中最新 live 报告的版本。改模板必须提升版本号（提示词无损测试会对模板内容做哈希，内容变了而版本号没变时测试失败），提升版本号又要求有对应的 live 报告——三者连成一条链，CI 全程只读文件。

## 8. 兼容与回滚

- 前端 `aiChat(mode, project, userText, onChunk, vision, opts)` 签名不变，内部改为调用新接口；结构化模式返回 `{text: JSON.stringify(data), json: data}`，调用方无需改动。
- chat 协议行格式不变，前端解析不变。
- 回滚：按步骤提交，任一步可单独回退；数据库无迁移（演示模式与评测不改表结构）。

## 9. 不在本任务内

- chat 协议行改为结构化 SSE 事件（会大改 `AiAssistant.tsx`）。
- 合作资源 / 灵感目录迁成共享 JSON。
- 提示词 A/B 与线上监控。
