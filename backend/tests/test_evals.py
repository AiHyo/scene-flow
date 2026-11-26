"""CI side of the evaluation: replay the committed live recordings. No model is called.

A failure here means a prompt, the assembly code, a case input or a check changed
after the last live run. Fix: `cd backend && uv run python -m evals.run --live`
(uses the real model from .env) and commit docs/evals/.
"""

from __future__ import annotations

import json
from collections import Counter

import pytest

from app.ai.prompts import PROMPT_HASH, PROMPT_VERSION
from evals.assertions import evaluate
from evals.run import RECORDINGS, REPORT, case_messages, load_suite, messages_digest, output_from_recording

CASES, PATTERNS, PROJECTS = load_suite()
REC = json.loads(RECORDINGS.read_text(encoding="utf-8"))
RERUN = "Run the live evaluation: cd backend && uv run python -m evals.run --live, then commit docs/evals/."


def test_suite_shape():
    ids = [c["id"] for c in CASES]
    assert len(ids) >= 15 and len(set(ids)) == len(ids)
    assert {c["mode"] for c in CASES} == {"chat", "directions", "theme", "scheme", "copies"}
    assert all(c.get("rule") and c["checks"] for c in CASES)


def test_recordings_are_for_the_current_prompt_version():
    assert REC["promptVersion"] == PROMPT_VERSION, f"recordings are for {REC['promptVersion']}. {RERUN}"
    assert REC["promptHash"] == PROMPT_HASH, f"prompt templates changed since the live run. {RERUN}"
    assert f"`{PROMPT_VERSION}`" in REPORT.read_text(encoding="utf-8")


@pytest.mark.parametrize("case", CASES, ids=[c["id"] for c in CASES])
def test_case_was_recorded_with_the_exact_current_messages(case):
    rec = REC["cases"].get(case["id"])
    assert rec is not None, f"no live recording for {case['id']}. {RERUN}"
    assert rec["messagesSha256"] == messages_digest(case_messages(case, PROJECTS)), (
        f"the messages for {case['id']} changed (prompt, assembly or case input). {RERUN}"
    )


@pytest.mark.parametrize("case", CASES, ids=[c["id"] for c in CASES])
def test_checks_reproduce_the_recorded_result(case):
    rec = REC["cases"][case["id"]]
    assert evaluate(case, output_from_recording(case, rec), PATTERNS) == rec["failures"]


def test_latest_live_run_passed_every_case():
    failed = {cid: r["failures"] for cid, r in REC["cases"].items() if r["failures"]}
    assert not failed, f"the committed live run has failing cases: {failed}"


# ---------------------------------------------------------------- the checks can actually fail

CASE = {c["id"]: c for c in CASES}


def _output(case_id: str):
    return output_from_recording(CASE[case_id], REC["cases"][case_id])


@pytest.mark.parametrize(
    ("checks_of", "output_of"),
    [
        ("chat-overspent", "chat-under-budget"),  # a real "you have 1745 left" reply must fail the overspent rule
        ("chat-under-budget", "chat-overspent"),
        ("copies-no-invented-time", "copies-start-time"),  # a real invitation with 13:30 must fail "no times"
        ("chat-ideas-directions", "chat-mem-only"),  # a reply without direction lines must fail
    ],
)
def test_checks_reject_real_outputs_from_the_wrong_situation(checks_of, output_of):
    assert evaluate(CASE[checks_of], _output(output_of), PATTERNS)


def test_checks_reject_synthetic_violations():
    theme = _output("theme-verbatim")
    assert evaluate(CASE["theme-verbatim"], {"theme": {**theme["theme"], "name": "森林野餐派对"}}, PATTERNS)

    scheme = _output("scheme-structure")
    bad_owner = {**scheme, "tasks": [{"name": "签到", "owner": "小王", "deadline": "", "done": False}]}
    assert evaluate(CASE["scheme-structure"], bad_owner, PATTERNS)
    unsorted = {**scheme, "schedule": list(reversed(scheme["schedule"]))}
    assert evaluate(CASE["scheme-structure"], unsorted, PATTERNS)

    overreach = '好的\n```调整建议\n{"change":"x","plan":{"visualTheme":"浅蓝","budgetAdd":[{"name":"灯"}]}}\n```'
    assert evaluate(CASE["chat-color-only-adjust"], overreach, PATTERNS)
    phantom = '```调整建议\n{"change":"x","plan":{"budgetRemoveNames":["舞台"]}}\n```'
    assert evaluate(CASE["chat-no-phantom-removal"], phantom, PATTERNS)


def test_affirmative_remaining_pattern_ignores_negations():
    """「没有预算结余，已超支」 is correct; only a positive amount left is a violation."""
    pat = PATTERNS["affirm_remaining"]
    import re

    assert not re.search(pat, "目前没有预算结余，已超支 500.26 元。")
    assert re.search(pat, "暂时结余 **1745 元**")
    assert re.search(pat, "剩余预算是 3000 元")


def test_recorded_outputs_contain_no_credentials():
    raw = RECORDINGS.read_text(encoding="utf-8")
    assert "sk-" not in raw and "Bearer" not in raw
    assert Counter(c["mode"] for c in CASES)["chat"] >= 10
