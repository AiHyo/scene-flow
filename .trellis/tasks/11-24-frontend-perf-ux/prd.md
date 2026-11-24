# 前端性能与 UI 细节打磨

> 状态：需求草稿。开始前需补 design.md / implement.md 并经用户确认。

## Goal

让首屏加载与交互体验配得上视觉完成度，并修正截图审查中发现的 UI 细节问题。

## Requirements

### 性能
- P1 路由级懒加载（`src/routes.tsx` 当前全部静态导入），首屏 JS 显著下降。
- P2 字体瘦身：`src/main.tsx:5-10` 引入 6 个 fontsource 字重（产出 1176 个字体文件、825 KB CSS）→ 正文改系统字体栈，标题仅保留 1~2 个字重或按需子集。
- P3 图片瘦身：`public/images/layout-reference/*.png`（每张 2~3.7 MB）与 `default-avatar.png`（957 KB）转 webp/avif，必要处加 `srcset`。
- P4 拆分巨型组件：`src/pages/Workbench.tsx`（1826 行，26 个 useState / 14 个 useEffect）、`src/components/workbench/AiAssistant.tsx`（1709 行）按职责拆分，服务端状态引入请求缓存层（方案在 design 中定）。

### UI/UX
- U1 首页 GSAP Observer 全屏分幕：提供「跳过动画 / 直接浏览」入口，验证触控板、键盘、移动端与 `prefers-reduced-motion` 降级路径。
- U2 悬浮小猫：在已有吉祥物插画的页面隐藏，避免遮挡首页进度点与卡片。
- U3 文案排版：标题/副标题使用 `text-wrap: balance/pretty`，消除「整。」类孤字换行；检查首页标题第二行缩进。
- U4 导航收敛：评估合并「找灵感 / 案例探索」，统一「AI 共策」用语（具体方案需用户确认）。

## Acceptance Criteria

- [ ] 生产构建首屏 JS（gzip）较当前 395 KB 下降 ≥ 40%，CSS（gzip）较 334 KB 下降 ≥ 70%。
- [ ] `public/images` 总体积较当前 26 MB 下降 ≥ 60%，视觉无明显劣化。
- [ ] `Workbench.tsx` 与 `AiAssistant.tsx` 单文件均 < 600 行，行为不变（关键流程有组件测试或 Playwright 冒烟测试）。
- [ ] 桌面与 390px 移动端截图复核：无遮挡、无孤字换行；首页可在 1 次操作内跳过动画。
