"""Deterministic checks over a model output. Pure functions: CI replays recorded live
outputs through them, so changing a check is verified against real model behaviour."""

from __future__ import annotations

import json
import re
from typing import Any

ADJUST_BLOCK = re.compile(r"```调整建议\s*\n([\s\S]*?)```")


def resolve(data: Any, path: str | None) -> Any:
    if not path:
        return data
    cur = data
    for part in path.split("."):
        cur = cur.get(part) if isinstance(cur, dict) else None
    return cur


def _text(output: Any, path: str | None) -> str:
    value = resolve(output, path) if isinstance(output, dict) else output
    return value if isinstance(value, str) else json.dumps(value, ensure_ascii=False)


def _minutes(t: str) -> int | None:
    m = re.search(r"(\d{1,2})[:：](\d{2})", t or "")
    return int(m.group(1)) * 60 + int(m.group(2)) if m else None


def run_check(check: dict[str, Any], output: Any, patterns: dict[str, str]) -> str | None:
    """Return None when the check passes, otherwise a short failure reason."""
    kind = check["type"]
    pattern = check.get("pattern")
    if pattern and pattern.startswith("$"):
        pattern = patterns[pattern[1:]]
    path = check.get("path")

    if kind == "regex_present":
        return None if re.search(pattern, _text(output, path), re.M) else f"缺少匹配 /{pattern}/"
    if kind == "regex_absent":
        m = re.search(pattern, _text(output, path), re.M)
        return f"不应出现「{m.group(0)}」" if m else None
    if kind == "count_between":
        n = len(resolve(output, path) or []) if path else len(re.findall(pattern, _text(output, None), re.M))
        return None if check["min"] <= n <= check["max"] else f"数量 {n} 不在 {check['min']}–{check['max']}"
    if kind == "equals":
        got = resolve(output, path)
        return None if got == check["value"] else f"{path} = {got!r}，期望 {check['value']!r}"
    if kind == "max_len":
        too_long = [
            str(it.get(check["key"]))
            for it in resolve(output, path) or []
            if len(str(it.get(check["key"]))) > check["max"]
        ]
        return f"超过 {check['max']} 字：{too_long}" if too_long else None
    if kind == "all_match":
        bad = [
            it.get(check["key"])
            for it in resolve(output, path) or []
            if not re.search(check["pattern"], str(it.get(check["key"], "")))
        ]
        return f"{check['key']} 不符合：{bad[:3]}" if bad else None
    if kind == "times_sorted":
        mins = [_minutes(str(it.get(check["key"], ""))) for it in resolve(output, path) or []]
        known = [m for m in mins if m is not None]
        return None if known == sorted(known) and len(known) == len(mins) else f"时间未排序或缺失：{mins}"
    if kind == "adjust_card":
        return _check_adjust_card(check, _text(output, None))
    raise ValueError(f"unknown check type {kind}")


def _check_adjust_card(check: dict[str, Any], text: str) -> str | None:
    m = ADJUST_BLOCK.search(text)
    if not m:
        return "缺少调整建议块" if check.get("required") else None
    try:
        plan = json.loads(m.group(1).strip()).get("plan") or {}
    except json.JSONDecodeError:
        return "调整建议块不是合法 JSON"
    missing = [k for k in check.get("requireKeys", []) if k not in plan]
    if missing:
        return f"调整建议缺少字段 {missing}"
    extra = [k for k in check.get("forbidKeys", []) if k in plan]
    if extra:
        return f"调整建议越界包含 {extra}"
    for key, pat in check.get("valuePatterns", {}).items():
        if not re.search(pat, json.dumps(plan.get(key), ensure_ascii=False)):
            return f"{key} 不匹配 /{pat}/：{plan.get(key)!r}"
    for key, pat in check.get("forbidValuePatterns", {}).items():
        if plan.get(key) is not None and re.search(pat, json.dumps(plan.get(key), ensure_ascii=False)):
            return f"{key} 不应包含 /{pat}/：{plan.get(key)!r}"
    return None


def evaluate(case: dict[str, Any], output: Any, patterns: dict[str, str]) -> list[str]:
    failures = []
    for check in case["checks"]:
        reason = run_check(check, output, patterns)
        if reason:
            failures.append(f"{check['type']}: {reason}")
    return failures
