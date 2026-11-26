"""Offline evaluation of the co-planning prompts.

Live run (real model from .env; costs a few calls per case):

    cd backend && uv run python -m evals.run --live

writes docs/evals/recordings.json (raw model outputs + a hash of the exact messages
sent) and docs/evals/report.md. CI never calls a model: tests/test_evals.py replays
the recordings, checking that every case's messages hash still matches (so any change
to prompts, assembly or case inputs forces a new live run) and that the checks give
the same results on the recorded outputs.
"""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import sys
import time
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from app.ai.assemble import ChatOptions, build_messages
from app.ai.plan import _validate, structured_completion
from app.ai.prompts import PROMPT_HASH, PROMPT_VERSION, current
from app.ai.providers import ai_mode, get_providers
from app.ai.schemas import OUTPUT_MODELS
from evals.assertions import evaluate

EVALS_DIR = Path(__file__).resolve().parent
DOCS_DIR = EVALS_DIR.parents[1] / "docs" / "evals"
RECORDINGS = DOCS_DIR / "recordings.json"
REPORT = DOCS_DIR / "report.md"


def load_suite() -> tuple[list[dict[str, Any]], dict[str, str], dict[str, Any]]:
    suite = json.loads((EVALS_DIR / "cases.json").read_text(encoding="utf-8"))
    projects = json.loads((EVALS_DIR / "projects.json").read_text(encoding="utf-8"))
    return suite["cases"], suite["patterns"], projects


def case_messages(case: dict[str, Any], projects: dict[str, Any]) -> list[dict[str, str]]:
    o = case.get("options", {})
    opts = ChatOptions(
        detail=o.get("detail", "medium"),
        nickname=o.get("nickname"),
        mem_only=bool(o.get("memOnly")),
        no_scene=bool(o.get("noScene")),
        vision=o.get("vision"),
    )
    return build_messages(current(), case["mode"], projects[case["project"]], case["userText"], opts)


def messages_digest(messages: list[dict[str, str]]) -> str:
    return hashlib.sha256(json.dumps(messages, ensure_ascii=False, sort_keys=True).encode()).hexdigest()


def output_from_recording(case: dict[str, Any], rec: dict[str, Any]) -> Any:
    """Chat: the streamed text. Structured: the validated object from the last raw output."""
    if case["mode"] == "chat":
        return rec["outputs"][-1]
    parsed, errors = _validate(OUTPUT_MODELS[case["mode"]], rec["outputs"][-1])
    if parsed is None:
        raise AssertionError(f"recorded output for {case['id']} no longer validates: {errors}")
    return parsed.model_dump()


async def _collect_chat(llm, messages) -> str:
    text = []
    stream = await llm.stream_chat(messages)
    buffer = ""
    async for chunk in stream:
        buffer += chunk.decode("utf-8", errors="replace")
        while "\n" in buffer:
            line, buffer = buffer.split("\n", 1)
            line = line.strip()
            if line.startswith("data:") and line != "data: [DONE]":
                try:
                    delta = (json.loads(line[5:]).get("choices") or [{}])[0].get("delta", {}).get("content")
                except json.JSONDecodeError:
                    continue
                if delta:
                    text.append(delta)
    return "".join(text)


async def run_live(only: set[str] | None = None) -> int:
    if ai_mode() != "live":
        print("live evaluation needs a real model: set LLM_API_KEY in .env (demo mode is not evaluated)")
        return 2
    cases, patterns, projects = load_suite()
    llm = get_providers().llm
    previous = json.loads(RECORDINGS.read_text(encoding="utf-8"))["cases"] if only and RECORDINGS.exists() else {}
    recorded: dict[str, Any] = dict(previous)

    for case in cases:
        if only and case["id"] not in only:
            continue
        messages = case_messages(case, projects)
        started = time.monotonic()
        try:
            if case["mode"] == "chat":
                outputs = [await _collect_chat(llm, messages)]
                repaired = False
            else:
                result = await structured_completion(llm, case["mode"], messages)
                outputs, repaired = result.raw_outputs, result.repaired
        except Exception as exc:  # recorded as a failure, the run continues
            outputs, repaired = [f"<error> {type(exc).__name__}: {exc}"], False
        latency = round(time.monotonic() - started, 1)
        rec = {
            "messagesSha256": messages_digest(messages),
            "outputs": outputs,
            "repaired": repaired,
            "latency": latency,
        }
        try:
            failures = evaluate(case, output_from_recording(case, rec), patterns)
        except AssertionError as exc:
            failures = [str(exc)]
        rec["failures"] = failures
        recorded[case["id"]] = rec
        print(f"{'PASS' if not failures else 'FAIL'}  {case['id']:28s} {latency:5.1f}s  {'; '.join(failures)}")

    DOCS_DIR.mkdir(parents=True, exist_ok=True)
    meta = {
        "promptVersion": PROMPT_VERSION,
        "promptHash": PROMPT_HASH,
        "model": f"{llm.name}:{getattr(llm, 'model', '?')}",
        "createdAt": datetime.now(UTC).strftime("%Y-%m-%d %H:%M UTC"),
    }
    RECORDINGS.write_text(json.dumps({**meta, "cases": recorded}, ensure_ascii=False, indent=1), encoding="utf-8")
    REPORT.write_text(render_report(meta, cases, recorded), encoding="utf-8")
    passed = sum(1 for c in cases if not recorded.get(c["id"], {}).get("failures", ["missing"]))
    print(f"\n{passed}/{len(cases)} cases passed → {REPORT.relative_to(EVALS_DIR.parents[1])}")
    return 0


def render_report(meta: dict[str, str], cases: list[dict[str, Any]], recorded: dict[str, Any]) -> str:
    passed = [c for c in cases if not recorded[c["id"]]["failures"]]
    repaired = sum(1 for c in cases if recorded[c["id"]].get("repaired"))
    lines = [
        "# 提示词离线评测报告",
        "",
        f"- promptVersion: `{meta['promptVersion']}`",
        f"- 模型：`{meta['model']}`",
        f"- 时间：{meta['createdAt']}",
        f"- 结果：**{len(passed)}/{len(cases)} 通过**；结构化输出修复重试 {repaired} 次",
        "",
        "用例与断言见 `backend/evals/cases.json`；原始输出与请求哈希见 `recordings.json`。"
        "CI 不调用模型，而是回放本文件对应的录制结果（见 `backend/tests/test_evals.py`）。",
        "",
        "| 用例 | 模式 | 规则 | 结果 | 耗时 |",
        "|---|---|---|---|---|",
    ]
    for c in cases:
        rec = recorded[c["id"]]
        status = "✅" if not rec["failures"] else "❌ " + "；".join(rec["failures"])
        lines.append(f"| `{c['id']}` | {c['mode']} | {c['rule']} | {status} | {rec['latency']}s |")
    return "\n".join(lines) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--live", action="store_true", help="run every case against the real model and record")
    parser.add_argument("--only", nargs="*", help="re-run only these case ids (others keep their recordings)")
    args = parser.parse_args()
    if not args.live:
        parser.print_help()
        return 1
    return asyncio.run(run_live(set(args.only) if args.only else None))


if __name__ == "__main__":
    sys.exit(main())
