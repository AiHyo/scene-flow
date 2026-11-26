# 提示词离线评测报告

- promptVersion: `2026-11-26.1`
- 模型：`openai:gpt-6.2-sol`
- 时间：2026-11-26 10:25 UTC
- 结果：**19/19 通过**；结构化输出修复重试 0 次

用例与断言见 `backend/evals/cases.json`；原始输出与请求哈希见 `recordings.json`。CI 不调用模型，而是回放本文件对应的录制结果（见 `backend/tests/test_evals.py`）。

| 用例 | 模式 | 规则 | 结果 | 耗时 |
|---|---|---|---|---|
| `chat-overspent` | chat | 11 预算状态：超出上限必须说超支，绝不把差额说成余额 | ✅ | 4.5s |
| `chat-under-budget` | chat | 11 预算状态：低于上限时给出正确结余（上限 5000 − 已知 3255 = 1745） | ✅ | 4.7s |
| `chat-budget-undecided` | chat | 11/12 预算上限未设定时没有余额概念，不得报出结余数字 | ✅ | 3.1s |
| `chat-unpriced-not-counted` | chat | 11 价格待询的项目不计入合计（已知合计 3255，音响待询价） | ✅ | 4.0s |
| `chat-mem-only` | chat | 只记条件时不输出方向 / 主题协议行，不宣称已生成或已更新 | ✅ | 2.9s |
| `chat-ideas-directions` | chat | 10/20 没想好时给出 2–3 个可一键采纳的方向行，字段长度符合协议 | ✅ | 12.7s |
| `chat-no-scene` | chat | 用户明确不要图片时，只做文字内容，不提议生成图片 | ✅ | 16.3s |
| `chat-color-only-adjust` | chat | 19/22 只改配色：调整建议只包含配色，不动流程与费用 | ✅ | 7.6s |
| `chat-no-phantom-removal` | chat | 19 费用明细里没有舞台，就绝不写「删除舞台」 | ✅ | 10.5s |
| `chat-nickname-greeting` | chat | 16 带昵称时亲切称呼，并以小灵自我介绍 | ✅ | 4.0s |
| `chat-no-invented-staff` | chat | 24 没有提供人员时负责人写待分配，不编造人名 | ✅ | 8.4s |
| `chat-vision-no-dimensions` | chat | 9 单张照片不推断面积与尺寸 | ✅ | 10.0s |
| `directions-from-scratch` | directions | 20 方向生成：恰好 3 个，名称与风格长度符合要求 | ✅ | 8.9s |
| `theme-verbatim` | theme | 21 用户指定的主题名与口号必须逐字采用 | ✅ | 3.1s |
| `scheme-structure` | scheme | 方案：5–8 个环节按时间排序，6–12 个费用项，负责人不编造 | ✅ | 52.3s |
| `scheme-no-invented-staff` | scheme | 24 从零生成方案时同样不编造人名 | ✅ | 40.6s |
| `copies-cross-day` | copies | 文案时间与流程推导一致，跨日时明确说明次日结束 | ✅ | 14.4s |
| `copies-start-time` | copies | 文案开始时间必须与流程表一致（13:30） | ✅ | 10.0s |
| `copies-no-invented-time` | copies | 流程没有时间时不编造具体钟点 | ✅ | 11.9s |
