# 仓库门面与工程卫生清理

## Goal

消除「平台生成半成品」的第一印象：别人 clone 后能用文档中的命令直接装好依赖并构建，仓库中没有遗留文件、脚手架残留与版权不明的素材。

## Decisions（继承父任务）

- D1：不改写 git 历史；README 不专门提秒哒，设「AI 协作开发方式」章节；清理仓库中的秒哒脚手架残留。`.trellis/workspace/miaoda/` 日志属于开发过程记录，保留。
- D3：AI 工具目录（`.agent/ .agents/ .claude/ .codex/ .cursor/`）全部保留在版本控制中，作为 AI 协作开发流程的证据。

## Requirements

### R1 脚手架残留
- `package.json` 包名 `miaoda-react-admin` → `sceneflow-web`（`package.json:2`）。
- 移除与本项目无关的 ast-grep 规则 `.rules/supabase-google-sso.yml`（含 `miaoda-gg.com`）与 `.rules/supabase-edge-function-get-body.yml`，同步删除 `.rules/check.sh` 中对应调用；其余规则保留（仍被 `npm run lint` 使用）。
- 归档已完成或过期的 Trellis 任务 `00-bootstrap-guidelines`、`11-16-fastapi-decoupling`（`task.py archive`）。

### R2 遗留与垃圾文件
- 删除已提交的 10 个备份文件（`git ls-files | grep '\.bak'`，含 `src/**/*.bak-prebg`、`src/index.css.bak-prebg`、`public/images/assets/default-avatar.png.bak`）。
- `.gitignore` 增加：`*.bak`、`*.bak-*`、`.claude/worktrees/`、`.claude/settings.local.json`。

### R3 依赖与锁文件
- 同步 `pnpm-lock.yaml` 与 `package.json`（当前锁文件残留 `@supabase/supabase-js`、`miaoda-react-devkit`、`miaoda-sc-plugin`，导致 `pnpm install --frozen-lockfile` 失败）。
- 移除业务代码未引用的依赖：已核实 `axios`、`video-react`、`recharts`、`motion`、`streamdown`、`qrcode`、`react-day-picker`、`embla-carousel-react`、`input-otp`、`vaul`、`cmdk`、`react-hook-form`、`next-themes` 在 `src/`（除 `components/ui`）中无导入；连带删除只被这些依赖使用、且未被业务代码引用的 `src/components/ui/*` 组件（当前 50 个中 15 个被引用）及对应 `@types/*`。每项删除前复核 grep，删除后 `tsgo` + `build` 必须通过。
- README 安装命令统一为 pnpm。

### R4 素材版权
- `src/data/partnerCatalog.ts` 中 11 张外链图片（9 张 `baidu_image_search_*`，均位于秒哒 CDN `*.bcebos.com`）全部本地化：
  - 8 张复用仓库已有素材：气球拱门 → `material-balloons.webp`；KT 板签到背景 → `material-signin.webp`；拍照手举牌 → `material-photoprops.webp`；照片墙麻绳木夹 → `inspiration-memory-wall.webp`；弹幕灯牌 → `material-lighting.webp`；桌旗椅套 → `inspiration-table-center.webp`；野餐防潮垫 → `inspiration-green-corner.webp`；纸盘纸杯 → `inspiration-warm-dinner.webp`。
  - 3 张（胶片相机、破冰桌游、帆布袋）下载 Pexels 授权图片，压缩为 webp 存入 `public/images/assets/`，在 `CREDITS.md` 记录来源与许可。

### R5 开源基础设施
- 新增 `LICENSE`（MIT，版权人 AiHyo）。
- 新增 `.github/workflows/ci.yml`：前端 `pnpm install --frozen-lockfile` → `pnpm lint` → `pnpm build`（后端 job 由 backend-hardening 子任务补充）。
- README 重写骨架：一句话定位、首屏截图（Playwright 脚本生成，桌面 + 移动端）、核心功能、技术栈、运行方式（pnpm / Docker）、「AI 协作开发方式」章节。架构图与「工程亮点」章节留占位，在 ai-orchestration 完成后补全。

## Acceptance Criteria

- [ ] `git ls-files | grep -E '\.bak'` 无输出。
- [ ] `git grep -i miaoda -- ':!.trellis'` 无输出。
- [ ] 在干净目录中 `pnpm install --frozen-lockfile && pnpm build` 成功。
- [ ] `npm run lint` 输出 SUCCESS。
- [ ] `git grep bcebos -- src` 无输出；资源页 11 张商品卡片图片均正常显示（截图核对）。
- [ ] 仓库根目录存在 `LICENSE`、`CREDITS.md`、`.github/workflows/ci.yml`；CI 中的每一步命令在本地逐条执行通过。
- [ ] README 首屏包含截图与一键运行命令，且不含个人邮箱等隐私信息。
- [ ] 现有页面在本地 `vite preview` 下渲染与改动前一致（首页、找灵感、案例、场景布置、广场、合作伙伴截图对比）。

## Out of Scope

- 改写 git 历史（D1）。
- 移除 AI 工具目录（D3）。
- 任何后端代码、AI 编排与前端性能改动（属于其他子任务）。
