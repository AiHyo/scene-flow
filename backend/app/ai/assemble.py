"""Server-side prompt assembly, ported 1:1 from the original frontend `src/services/ai.ts`.

Input is the project snapshot exactly as the frontend holds it (raw JSON dicts), because
the wording depends on JavaScript semantics: `${undefined}` prints "undefined", `0` and
"" are falsy, `Math.round` rounds .5 up, and numbers print without a trailing ".0".
The helpers below reproduce those semantics; tests/golden proves byte equality with the
original implementation across 45 captured cases.
"""

from __future__ import annotations

import math
import re
from dataclasses import dataclass, field
from typing import Any, Literal

from app.ai.prompts import PromptSet

Mode = Literal["chat", "directions", "theme", "scheme", "copies"]
Detail = Literal["brief", "medium", "detailed"]


class _Missing:
    """A key that is absent from the JSON object (JavaScript `undefined`)."""

    def __repr__(self) -> str:
        return "undefined"


MISSING: Any = _Missing()


# ---------------------------------------------------------------- JavaScript semantics


def get(obj: Any, key: str) -> Any:
    """`obj?.key` — MISSING when obj is not an object or the key is absent."""
    if isinstance(obj, dict) and key in obj:
        return obj[key]
    return MISSING


def truthy(v: Any) -> bool:
    if v is MISSING or v is None or v is False:
        return False
    if isinstance(v, (int, float)) and not isinstance(v, bool):
        return v != 0 and not (isinstance(v, float) and math.isnan(v))
    if isinstance(v, str):
        return v != ""
    return True  # objects and arrays are truthy, even when empty


def js_num_str(x: float) -> str:
    if isinstance(x, bool):
        return "true" if x else "false"
    if isinstance(x, float):
        if math.isnan(x):
            return "NaN"
        if math.isinf(x):
            return "Infinity" if x > 0 else "-Infinity"
        if x.is_integer() and abs(x) < 1e21:
            return str(int(x))
        return repr(x)
    return str(x)


def js_str(v: Any) -> str:
    """String conversion as done by a JavaScript template literal."""
    if v is MISSING:
        return "undefined"
    if v is None:
        return "null"
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, (int, float)):
        return js_num_str(v)
    if isinstance(v, str):
        return v
    if isinstance(v, list):
        return ",".join("" if (e is None or e is MISSING) else js_str(e) for e in v)
    return "[object Object]"


def js_number(v: Any) -> float:
    """`Number(v)`."""
    if v is MISSING:
        return math.nan
    if v is None or v is False:
        return 0
    if v is True:
        return 1
    if isinstance(v, (int, float)):
        return v
    if isinstance(v, str):
        s = v.strip()
        if s == "":
            return 0
        try:
            return float(int(s, 0)) if re.fullmatch(r"0[xXbBoO][0-9a-fA-F]+", s) else float(s)
        except ValueError:
            return math.nan
    return math.nan


def js_round(x: float) -> float:
    """`Math.round`: halves round toward +Infinity."""
    return math.floor(x + 0.5)


def num_or_zero(v: Any) -> float:
    """`Number(v) || 0`."""
    n = js_number(v)
    return n if truthy(n) else 0


def as_list(v: Any) -> list[Any]:
    """`v ?? []` for arrays."""
    return v if isinstance(v, list) else []


# ---------------------------------------------------------------- ports of small TS helpers


def clean_type_name(t: str) -> str:
    """`cleanTypeName` in ai.ts."""
    return re.sub(r"^(?:这是|一个|我们要办(?:的)?|我想办(?:的)?)", "", t).strip() or t


def line_amount(item: Any) -> float | None:
    """`lineAmount` in budgetMath.ts."""
    if truthy(get(item, "priceUnknown")):
        return None
    q = js_number(get(item, "qty"))
    p = js_number(get(item, "unitPrice"))
    if not (math.isfinite(q) and math.isfinite(p)):
        return None
    return js_round(q * p * 100) / 100


def known_total(items: list[Any]) -> float:
    """`knownTotal` in budgetMath.ts (sum in cents, back to yuan)."""
    cents = 0
    for it in items:
        a = line_amount(it)
        if a is not None:
            cents += js_round(a * 100)
    return cents / 100


def unpriced_items(items: list[Any]) -> list[Any]:
    """`unpricedItems` in budgetMath.ts (strict `=== true`)."""
    return [it for it in items if get(it, "priceUnknown") is True]


@dataclass(frozen=True)
class TimeRange:
    start: str
    end: str
    cross_day: bool


def derive_time_range(schedule: Any) -> TimeRange | None:
    """`deriveTimeRange` in deliverables.ts."""
    items = [
        it
        for it in as_list(schedule)
        if truthy(it) and truthy(get(it, "time")) and re.search(r"\d{1,2}:\d{2}", js_str(get(it, "time")))
    ]
    if not items:
        return None

    def to_min(t: str) -> int | None:
        m = re.search(r"(\d{1,2}):(\d{2})", t)
        return int(m.group(1)) * 60 + int(m.group(2)) if m else None

    def text(v: Any) -> str:
        return "" if v is MISSING or v is None else js_str(v)

    first, last = items[0], items[-1]
    s = to_min(text(get(first, "time")))
    last_min = to_min(text(get(last, "time")))
    if s is None or last_min is None:
        return None
    duration = text(get(last, "duration"))
    dm = re.search(r"(\d{1,3})\s*(?:小时|h|hour)", duration, re.IGNORECASE)
    mm = re.search(r"(\d{1,3})\s*(?:分钟|min)", duration, re.IGNORECASE)
    if dm:
        dur = int(dm.group(1)) * 60
    elif mm:
        dur = int(mm.group(1))
    elif re.search(r"半场|半小时", duration):
        dur = 30
    else:
        dur = 0
    end = last_min + dur
    cross_day = False
    if end < s:
        cross_day = True
        end += 24 * 60
    # Ends at or after midnight → next day (e.g. 23:30 + 90 min ends 01:00 tomorrow).
    # The original only flagged a 24 h+ span, so 20:00→01:00 was reported as same-day.
    if end >= 24 * 60:
        cross_day = True

    def fmt(minutes: int) -> str:
        return f"{(minutes % 1440) // 60:02d}:{minutes % 60:02d}"

    return TimeRange(fmt(s), fmt(end), cross_day)


# ---------------------------------------------------------------- summary (`summarize` in ai.ts)


def summarize(project: dict[str, Any]) -> str:
    r = get(project, "requirements")
    r = r if isinstance(r, dict) else {}
    parts: list[str] = []

    goal = get(r, "goal")
    desc = get(project, "description")
    parts.append(f"活动目标：{js_str(goal if truthy(goal) else desc if truthy(desc) else '待明确')}")

    type_pending = get(r, "typePending")
    if truthy(type_pending):
        options = [o for o in as_list(get(type_pending, "options")) if o != "还没想好"]
        parts.append(
            f"【当前有效条件】活动类型待确认（候选：{' / '.join(js_str(o) for o in options)}）："
            "不预设任何一个为当前类型，引用时说明类型尚未确认；如需提及请引导用户从候选中选择"
        )
    elif truthy(get(r, "type")):
        t = clean_type_name(js_str(get(r, "type")))
        parts.append(f"活动类型：{t}")
        parts.append(
            f"【当前有效条件】活动类型已确认为「{t}」。历史对话中出现过的其他活动类型（包括先前引导选择或早期讨论）"
            f"仅属历史过程，不得当作当前类型，不得与「{t}」融合、并列或相加成新类型（如不得拼接为「{t}生日活动」这类混合表述）"
        )

    for label, key in (
        ("活动主题", "visualTheme"),
        ("人数", "headcount"),
        ("预算", "budget"),
        ("地区", "region"),
        ("日期", "date"),
        ("场地类型", "venueType"),
        ("风格偏好", "style"),
    ):
        v = get(r, key)
        if truthy(get(v, "value")):
            suffix = "（建议，待确认）" if get(v, "source") == "ai" else ""
            parts.append(f"{label}：{js_str(get(v, 'value'))}{suffix}")

    for label, key in (
        ("背景故事", "story"),
        ("组织介绍", "orgIntro"),
        ("近期成果", "achievements"),
        ("重点人物", "keyPeople"),
        ("文案语气", "tone"),
        ("避免提及", "avoid"),
        ("其他需求/补充说明", "otherNeeds"),
    ):
        v = get(r, key)
        if truthy(v):
            parts.append(f"{label}：{js_str(v)}")

    theme = get(project, "theme")
    if truthy(get(theme, "name")):
        parts.append(f"已定主题：{js_str(get(theme, 'name'))}")

    budget = get(project, "budget")
    budget_items = as_list(get(budget, "items"))
    known = known_total(budget_items)
    unpriced = unpriced_items(budget_items)
    unpriced_note = (
        f"，另有 {len(unpriced)} 项价格待询未计入合计（{'、'.join(js_str(get(x, 'name')) for x in unpriced)}）"
        if unpriced
        else ""
    )
    limit = get(budget, "limit")
    if limit is not MISSING and limit is not None:
        remain = js_round((js_number(limit) - known) * 100) / 100
        remain_text = f"剩余 {js_num_str(remain)} 元" if remain >= 0 else f"超出 {js_num_str(-remain)} 元"
        parts.append(
            f"【当前有效条件】预算已确定：上限 {js_str(limit)} 元，已安排（已知价格）{js_num_str(known)} 元"
            f"{unpriced_note}，{remain_text}"
        )
    elif budget_items:
        parts.append(
            "【当前有效条件】预算：未确定（无硬性上限）。以下事实以此为准：此前对话或材料中出现过的任何预算数字"
            "（如历史消息中的金额）均不代表当前有效条件，不得当作已确定的上限、余额或硬约束引用；"
            f"费用明细已知合计 {js_num_str(known)} 元{unpriced_note}，仅是当前已记录的估算，不代表预算已确定。"
        )
    else:
        parts.append(
            "【当前有效条件】预算：未确定（无硬性上限）。此前对话中出现过的任何预算数字均不代表当前有效条件，"
            "不得当作已确定的上限或硬约束引用。"
        )

    live: list[str] = []
    if truthy(get(theme, "name")):
        live.append(f"主题「{js_str(get(theme, 'name'))}」")
    selected = get(project, "selectedDirectionId")
    if truthy(selected):
        d = next((x for x in as_list(get(project, "directions")) if get(x, "id") == selected), None)
        if d is not None:
            live.append(f"已选方向「{js_str(get(d, 'name'))}」")
    schedule = as_list(get(project, "schedule"))
    if schedule:
        rendered = []
        for x in schedule:
            time = f"（{js_str(get(x, 'time'))}）" if truthy(get(x, "time")) else ""
            note = f"｜备注：{js_str(get(x, 'note'))}" if truthy(get(x, "note")) else ""
            rendered.append(f"{js_str(get(x, 'name'))}#{js_str(get(x, 'id'))}{time}{note}")
        live.append(f"流程（调整时用 schedulePatch 按 id 或名称定位，只写要改的字段）：{'；'.join(rendered)}")
    if budget_items:
        rendered = []
        for x in budget_items:
            price = "待询价" if truthy(get(x, "priceUnknown")) else js_num_str(num_or_zero(get(x, "unitPrice")))
            rendered.append(
                f"{js_str(get(x, 'name'))}#{js_str(get(x, 'id'))}({js_num_str(num_or_zero(get(x, 'qty')))}×{price})"
            )
        live.append(
            f"预算明细（合计 {js_num_str(known)} 元{unpriced_note}）：{'、'.join(rendered)}"
            "（由数量×单价计算，单价 0 表示免费）"
        )
    else:
        live.append("预算明细：暂无条目（预算上限未定）")
    materials = as_list(get(project, "materials"))
    if materials:
        live.append(f"物料：{'、'.join(js_str(get(x, 'name')) for x in materials)}")
    sc = get(project, "scene")
    if truthy(sc):
        if truthy(get(sc, "afterUrl")):
            live.append(
                f"已生成布置效果图{'（对应调整前的旧要求）' if truthy(get(sc, 'stale')) else '（对应当前要求）'}"
            )
        rq = [get(sc, "style"), *as_list(get(sc, "tags")), get(sc, "extra")]
        rq_text = "、".join(js_str(v) for v in rq if truthy(v))
        if rq_text:
            live.append(f"布置要求：{rq_text}")
    parts.append("【方案实况】\n" + "\n".join(live))
    return "\n".join(parts)


# ---------------------------------------------------------------- full message assembly (`aiChat` in ai.ts)


@dataclass(frozen=True)
class PartnerHint:
    name: str
    use: str
    scenes: str


@dataclass(frozen=True)
class InspirationHint:
    title: str
    how_to: str
    format: str
    needs: str


@dataclass(frozen=True)
class ChatOptions:
    detail: Detail = "medium"
    nickname: str | None = None
    mem_only: bool = False
    no_scene: bool = False
    vision: str | None = None
    partners: list[PartnerHint] = field(default_factory=list)
    inspirations: list[InspirationHint] = field(default_factory=list)


def history_messages(chat_log: Any, prompts: PromptSet) -> list[dict[str, str]]:
    """`chatHistoryMessages`: only valid user/assistant turns with non-blank text, last 12."""
    valid = [
        m
        for m in as_list(chat_log)
        if get(m, "role") in ("user", "assistant")
        and isinstance(get(m, "content"), str)
        and get(m, "content").strip() != ""
    ][-12:]
    out = []
    for m in valid:
        content = get(m, "content")
        if truthy(get(m, "imageUrl")) and truthy(get(m, "vision")):
            content = prompts.frag("history_vision", content=content, vision=js_str(get(m, "vision")))
        out.append({"role": get(m, "role"), "content": content})
    return out


def build_messages(
    prompts: PromptSet,
    mode: Mode,
    project: dict[str, Any],
    user_text: str,
    opts: ChatOptions | None = None,
) -> list[dict[str, str]]:
    opts = opts or ChatOptions()
    is_chat = mode == "chat"
    parts = [
        "" if is_chat else prompts.frag("mode_header", instruction=prompts.modes[mode]),
        prompts.frag("detail_line", detail=prompts.fragments[f"detail_{opts.detail}"]) if is_chat else "",
        prompts.fragments["mem_only"] if is_chat and opts.mem_only else "",
        prompts.fragments["no_scene"] if is_chat and not opts.mem_only and opts.no_scene else "",
        prompts.frag("nickname", nickname=opts.nickname) if opts.nickname else "",
        prompts.frag("summary", summary=summarize(project)),
        _copies_time(prompts, project) if mode == "copies" else "",
        prompts.frag("user_text", text=user_text.strip()) if user_text.strip() else "",
        _partners(prompts, opts.partners) if is_chat else "",
        _inspirations(prompts, opts.inspirations) if is_chat else "",
        prompts.frag("vision", vision=opts.vision) if opts.vision else "",
    ]
    user_content = "\n\n".join(p for p in parts if p)
    return [
        {"role": "system", "content": prompts.system},
        {"role": "user", "content": prompts.role},
        *history_messages(get(project, "chatLog"), prompts),
        {"role": "user", "content": user_content},
    ]


def _copies_time(prompts: PromptSet, project: dict[str, Any]) -> str:
    tr = derive_time_range(get(project, "schedule"))
    if tr is None:
        return prompts.fragments["copies_time_unknown"]
    cross = prompts.fragments["copies_cross_day"] if tr.cross_day else ""
    return prompts.frag("copies_time_known", start=tr.start, end=tr.end, cross_day=cross)


def _partners(prompts: PromptSet, hints: list[PartnerHint]) -> str:
    if not hints:
        return ""
    lines = "\n".join(prompts.frag("partner_line", name=h.name, use=h.use, scenes=h.scenes) for h in hints)
    return prompts.fragments["partners_header"] + lines


def _inspirations(prompts: PromptSet, hints: list[InspirationHint]) -> str:
    if not hints:
        return ""
    lines = "\n".join(
        prompts.frag("inspiration_line", title=h.title, howTo=h.how_to, format=h.format, needs=h.needs) for h in hints
    )
    return prompts.fragments["inspirations_header"] + lines
