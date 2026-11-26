"""Scripted demo-mode chat replies.

Each reply is keyed off what the user just said and uses the same protocol lines a real
model is instructed to emit (建议方向 / 建议主题 / ```调整建议```), so every frontend
feature built on them — direction cards, theme suggestion, the adjustment confirm card —
can be demonstrated without an API key. Every reply says it is a demo example.
"""

from __future__ import annotations

import json
import re
from typing import Any

DEMO_TAG = "（演示模式示例回复：未配置模型密钥，配置后即为真实 AI 回复）"

_USER_TEXT = re.compile(r"【我的话】\n(.*?)(?:\n\n|\Z)", re.S)
_COLOR_TARGET = re.compile(r"(?:改成|换成|改为|换为|调成)([^，。,.!！？\s]{2,12})")


def _user_text(messages: list[dict[str, Any]]) -> str:
    content = str(messages[-1].get("content", "")) if messages else ""
    m = _USER_TEXT.search(content)
    return m.group(1).strip() if m else ""


def _is_mem_only(messages: list[dict[str, Any]]) -> bool:
    return bool(messages) and "【本次指令边界】用户本次只要求记录" in str(messages[-1].get("content", ""))


def _directions_reply() -> str:
    return "\n".join(
        [
            "我们可以先从几个不同气质的方向里挑一个，再慢慢补细节～",
            "1. 草地野餐交流会：轻松自由，准备最简单；",
            "2. 小组协作挑战赛：互动性最强，需要提前设计关卡；",
            "3. 城市漫步寻宝：最新鲜，但路线踩点工作量大。",
            "人数和预算还没定也没关系，先选一个最有感觉的方向就好（建议，待确认）。",
            DEMO_TAG,
            "建议方向：草地野餐交流会|自然轻松|准备简单、预算友好，适合以交流为主",
            "建议方向：小组协作挑战赛|活力竞技|互动强，需要提前设计关卡与计分",
            "建议方向：城市漫步寻宝|探索户外|体验新鲜，但路线踩点工作量较大",
            "建议主题：草地合伙人",
        ]
    )


def _color_adjust_reply(text: str) -> str:
    m = _COLOR_TARGET.search(text)
    color = m.group(1) if m else "浅蓝与白色"
    card = {
        "change": f"把活动配色调整为「{color}」",
        "affects": ["活动视觉主题配色"],
        "keep": ["流程", "费用明细", "物料数量"],
        "pending": [],
        "manualWarn": [],
        "plan": {"visualTheme": color},
    }
    return (
        f"明白，只调整配色、其他保持不变，这样改动最小也最稳妥。确认后会把配色更新为「{color}」。\n{DEMO_TAG}\n"
        f"```调整建议\n{json.dumps(card, ensure_ascii=False)}\n```"
    )


def demo_reply(messages: list[dict[str, Any]]) -> str:
    text = _user_text(messages)
    if _is_mem_only(messages):
        return f"好的，已记下这次的条件，后续会按它来考虑。\n{DEMO_TAG}"
    if re.search(r"配色|颜色|色调|色系", text) and re.search(r"改|换|调", text):
        return _color_adjust_reply(text)
    if re.search(r"预算|费用|花费|多少钱", text):
        return (
            "预算这块我会按「上限 − 已列费用」的有符号差值来算：低于上限才叫结余，高于上限就是超支；"
            "价格待询的项目不计入合计。真实模式下会直接用你当前的预算和费用明细给出结论。\n" + DEMO_TAG
        )
    if re.search(r"布置|场地|效果图|照片|拍", text):
        return (
            "场地布置可以去「场景布置」页：选一组样例场地，就能看到保留原有建筑结构、只添加可移动物件的布置效果。"
            "演示模式下效果图仅支持样例场地，配置模型密钥后可以用你自己的场地照片。\n" + DEMO_TAG
        )
    if re.search(r"^(你好|您好|hi|hello|在吗|嗨)", text, re.I):
        return (
            "你好呀，我是小灵～可以陪你聊活动方向、把想法整理成完整方案、排流程管预算、写邀请函文案，"
            "也能基于场地照片生成布置效果图。想先从哪里开始？\n" + DEMO_TAG
        )
    return _directions_reply()
