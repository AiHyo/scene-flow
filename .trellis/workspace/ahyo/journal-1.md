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
