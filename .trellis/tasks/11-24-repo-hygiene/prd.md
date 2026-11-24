# 仓库门面与工程卫生清理

## Goal

消除「平台生成半成品」的第一印象：别人 clone 后能用文档中的命令直接装好依赖并构建，仓库中没有遗留文件、脚手架残留与版权不明的素材。

## Requirements

### R1 脚手架残留
- `package.json` 包名 `miaoda-react-admin` → `sceneflow-web`（`package.json:2`）。
- `.rules/` 中与本项目无关的规则移除：`supabase-google-sso.yml`（含 `miaoda-gg.com`）、`supabase-edge-function-get-body.yml`，并同步更新 `.rules/check.sh` 中对应调用；其余规则保留（仍被 `npm run lint` 使用）。
- 秒哒来源的呈现方式按父任务决策执行（见父任务 Open Questions）。

### R2 遗留与垃圾文件
- 删除已提交的 10 个备份文件：`src/**/*.bak-prebg`、`src/index.css.bak-prebg`、`public/images/assets/default-avatar.png.bak` 等（`git ls-files | grep .bak`）。
- `.gitignore` 增加 `*.bak`、`*.bak-*` 规则。
- 已完成或过期的 Trellis 任务 `00-bootstrap-guidelines`、`11-16-fastapi-decoupling` 归档。

### R3 依赖与锁文件
- `pnpm-lock.yaml` 与 `package.json` 同步（当前锁文件残留 `@supabase/supabase-js`、`miaoda-react-devkit`、`miaoda-sc-plugin`，`pnpm install --frozen-lockfile` 失败）。
- 移除业务代码未引用的依赖：`axios`、`video-react`（及 `@types/video-react`）、`recharts`、`motion`、`streamdown`、`qrcode`、`@types/bmapgl` 等；连带删除仅依赖它们且未被使用的 `src/components/ui/*` 组件（50 个中仅 15 个被引用）。删除前逐个 grep 复核。
- README 中的安装命令统一为 pnpm。

### R4 素材版权
- `src/data/partnerCatalog.ts` 中 11 张外链图片（9 张 `baidu_image_search_*` 来自秒哒 CDN）替换为本地、可公开授权的图片（Pexels/Unsplash 许可或自制），不再外链第三方 CDN。

### R5 开源基础设施
- 新增 `LICENSE`（MIT，署名为作者）。
- 新增 GitHub Actions：前端 `pnpm install --frozen-lockfile` → lint → typecheck → build（后端部分由 backend-hardening 子任务补充）。
- README 重写骨架：一句话定位、截图（复用 Playwright 截图脚本生成）、技术栈、运行方式；架构图与「工程亮点」章节在 ai-orchestration 完成后补全。

## Acceptance Criteria

- [ ] `git ls-files | grep -E '\.bak'` 无输出。
- [ ] `git grep -i miaoda -- ':!.trellis' ':!pnpm-lock.yaml'` 仅剩父任务决策允许保留的说明性文字。
- [ ] 全新 clone 后 `pnpm install --frozen-lockfile && pnpm build` 成功。
- [ ] `npm run lint` 输出 SUCCESS。
- [ ] `src/` 中无 `bcebos.com` 外链图片。
- [ ] 仓库根目录存在 `LICENSE` 与 `.github/workflows/ci.yml`，CI 本地用 `act` 或逐步命令验证通过。
- [ ] README 首屏包含截图与一键运行命令。

## Out of Scope

- 改写 git 历史（除非父任务决策选择该方案）。
- AI 工具目录（`.agent/ .agents/ .claude/ .codex/ .cursor/`）的去留 —— 待用户决策后再纳入。
