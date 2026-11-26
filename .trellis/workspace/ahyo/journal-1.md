# Journal - ahyo (Part 1)

> AI development session journal
> Started: 2026-11-25

---



## Session 1: repo-hygiene：仓库门面与工程卫生清理
<!-- trellis-session: v=2 fp=a0d8f740a594477e -->

**Date**: 2026-11-25
**Task**: repo-hygiene：仓库门面与工程卫生清理
**Branch**: `worktree-portfolio-polish`

### Summary

清理脚手架残留与 10 个备份文件；删除 35 个未用 UI 组件与 38 个依赖并修复 frozen-lockfile；修复 lint 脚本在新克隆下不可用（执行权限、ast-grep、沙箱路径）；11 张外链商品图本地化并新增 CREDITS；新增 MIT、前端 CI、重写 README。干净环境与 GitHub CI 均通过，已快进合并 main。发现访客项目迁移越权（S6）与样例场地生图因相对路径失效，记入 backend-hardening。

### Git Commits

| Hash | Message |
|------|---------|
| `b7db469` | chore: 清理脚手架残留（包名、无关 lint 规则、过期任务归档） |
| `54a2fa9` | chore: 删除已提交的备份文件并忽略备份与本地会话目录 |
| `f1a5259` | chore: 精简依赖、同步锁文件并修复 lint 脚本在本机不可用的问题 |
| `aa9a0d6` | fix: 合作伙伴商品图本地化，移除第三方 CDN 外链与来源不明图片 |
| `e43ae93` | docs: 新增 MIT 许可、前端 CI 与重写 README |

### Status

[OK] **Completed**


## Session 2: backend-hardening：后端安全与工程基座
<!-- trellis-session: v=2 fp=d7fc0d14856b88e9 -->

**Date**: 2026-11-25
**Task**: backend-hardening：后端安全与工程基座
**Branch**: `worktree-portfolio-polish`

### Summary

ruff 与真实 Postgres 测试基座（81 测试）+ 后端 CI；AppError 统一错误、请求 ID、共享 HTTP 客户端、CORS 白名单、prod 弱密钥拒绝启动；SSRF 改为唯一白名单入口经存储读取并经变异测试验证，修复样例场地生图失效；上传魔数校验；ai_task 持久化+重启恢复+咨询锁限流；访客迁移改凭证证明（S6）；项目乐观锁+冲突弹窗（方案 A），Docker 全栈 Playwright 双窗口 13 项检查通过；修复前端 Dockerfile 忽略锁文件、补 .dockerignore。开发中测试套件偶发挂起两次未复现，已加锁/连接池/任务/用例级超时护栏。GitHub CI 前后端均绿。

### Git Commits

| Hash | Message |
|------|---------|
| `6ffa662` | style(backend): 引入 ruff 并统一格式与现代类型注解 |
| `4f30a40` | test(backend): 搭建真实 Postgres 测试基座与后端 CI |
| `e3a3eae` | feat(backend): 领域异常、请求 ID 日志、共享 HTTP 客户端与安全配置默认值 |
| `c33d0ee` | fix(security): 修复 SSRF、样例场地生图失效并加固图片上传 |
| `a306456` | feat(backend): AI 任务持久化、重启恢复与基于用量账本的限流 |
| `7cb40dc` | fix(security): 访客项目迁移改为凭证证明所有权，修复越权转移 |
| `3174327` | feat: 项目乐观锁与多窗口冲突弹窗，修复前端 Docker 构建忽略锁文件 |
| `f493373` | docs: 后端工程要点、测试与端到端运行说明，新增后端规范 |
| `faced2f` | ci: 所有分支推送均运行 CI，合并前即可验证 |

### Status

[OK] **Completed**


## Session 3: ai-orchestration：AI 编排后端化、演示模式与离线评测
<!-- trellis-session: v=2 fp=43f5e3d64159f951 -->

**Date**: 2026-11-26
**Task**: ai-orchestration：AI 编排后端化、演示模式与离线评测
**Branch**: `worktree-portfolio-polish`

### Summary

Provider 抽象（OpenAI 兼容 / 可灵 / Mock）与无密钥演示模式；提示词与组装逻辑迁到后端，golden 测试证明与原前端 45 例逐字一致，规则重新编号并以版本哈希约束；/ai/plan/chat 与 /ai/plan/{mode} 接口，json_schema strict + 校验 + 一次修复重试，拒绝客户端 messages/model；前端删除全部提示词，旧透传接口 404；演示模式协议行完整，无密钥 Docker 全栈 Playwright 13/13；19 条离线评测真实模型 19/19，CI 回放录制结果并逐用例比对消息哈希（改一字即 21 个测试失败）。修复原 deriveTimeRange 跨午夜未标记跨日。后端测试 94→230，GitHub CI 前后端均绿。遗留：场景页刚生成即提示效果图对应旧要求（前端老问题，待 frontend 子任务排查）。

### Git Commits

| Hash | Message |
|------|---------|
| `73e0428` | feat(ai): Provider 抽象与演示模式基座，测试不再读取本机 .env |
| `81e50ce` | feat(ai): 提示词组装逻辑移植到后端，golden 测试证明与原前端逐字一致 |
| `e2bdd93` | fix: 流程结束时间跨过午夜时正确标记为跨日 |
| `0df9a98` | refactor(ai): 系统提示词规则连续编号，并以测试约束版本与无损 |
| `26d1f32` | feat(ai): 共策接口由后端组装提示词，结构化输出加校验与一次修复重试 |
| `8304e5e` | feat: 前端切换到后端共策接口，删除前端提示词与旧透传接口 |
| `588dfba` | feat(ai): 演示模式可完整走通共策流程，并以无密钥端到端测试验证 |
| `20355b8` | feat(ai): 提示词离线评测——真实模型录制、CI 回放，提示词改动必须实测 |
| `fe5be6e` | docs: AI 编排工程要点、演示模式与提示词修改流程，新增 AI 编排规范 |

### Status

[OK] **Completed**
