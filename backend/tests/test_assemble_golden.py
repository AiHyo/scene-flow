"""The Python prompt assembly must reproduce the original frontend byte for byte.

`golden/assembly_cases.json` was captured by running the ORIGINAL TypeScript `aiChat`
(src/services/ai.ts at commit 9399215) under vitest with the network layer mocked, for
45 combinations of project state, mode and options. `golden/legacy_prompts/` holds that
version's prompt wording verbatim. Loading the legacy wording and comparing whole
message arrays proves the assembly *logic* is unchanged, independent of later edits to
the production wording (which test_prompts.py covers).
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from app.ai.assemble import ChatOptions, InspirationHint, PartnerHint, build_messages, derive_time_range, known_total
from app.ai.prompts import PromptSet

GOLDEN = Path(__file__).resolve().parent / "golden"
LEGACY = PromptSet.load(GOLDEN / "legacy_prompts")
CASES = json.loads((GOLDEN / "assembly_cases.json").read_text(encoding="utf-8"))


def _options(case: dict) -> ChatOptions:
    o = case.get("opts") or {}
    return ChatOptions(
        detail=o.get("detail", "medium"),
        nickname=o.get("nickname"),
        mem_only=bool(o.get("memOnly")),
        no_scene=bool(o.get("noScene")),
        vision=case.get("vision"),
        partners=[PartnerHint(**p) for p in case["hints"]["partners"]],
        inspirations=[
            InspirationHint(title=i["title"], how_to=i["howTo"], format=i["format"], needs=i["needs"])
            for i in case["hints"]["inspirations"]
        ],
    )


@pytest.mark.parametrize("case", CASES, ids=[c["name"] for c in CASES])
def test_matches_original_frontend_assembly(case):
    got = build_messages(LEGACY, case["mode"], case["project"], case["userText"], _options(case))
    expected = case["expected"]["messages"]
    assert len(got) == len(expected)
    for g, e in zip(got, expected, strict=True):
        assert g["role"] == e["role"]
        assert g["content"] == e["content"]


def test_golden_covers_every_mode_and_option():
    modes = {c["mode"] for c in CASES}
    assert modes == {"chat", "directions", "theme", "scheme", "copies"}
    opts = {k for c in CASES for k in (c.get("opts") or {})}
    assert opts >= {"detail", "memOnly", "noScene", "nickname"}
    assert any(c.get("vision") for c in CASES)
    assert any(c["hints"]["partners"] for c in CASES) and any(c["hints"]["inspirations"] for c in CASES)


@pytest.mark.parametrize(
    ("items", "total"),
    [
        ([{"qty": 30, "unitPrice": 68.5}, {"qty": 1, "unitPrice": 1200}], 3255),
        ([{"qty": 3, "unitPrice": 0.1}], 0.3),  # float noise must not leak
        ([{"qty": 1, "unitPrice": 1500.255}], 1500.26),  # JS Math.round rounds .5 up
        ([{"qty": 1, "unitPrice": 99, "priceUnknown": True}], 0),
        ([{"qty": "", "unitPrice": 10}, {"qty": "2", "unitPrice": "5"}], 10),
        ([{"unitPrice": 10}], 0),  # missing qty -> NaN -> skipped
    ],
)
def test_known_total_matches_budget_math(items, total):
    assert known_total(items) == total


@pytest.mark.parametrize(
    ("schedule", "expected"),
    [
        ([{"time": "13:30"}, {"time": "16:30", "duration": "45 分钟"}], ("13:30", "17:15", False)),
        # Original deriveTimeRange: ending past midnight is NOT flagged as cross-day (bug, fixed next commit)
        ([{"time": "20:00"}, {"time": "23:30", "duration": "90 分钟"}], ("20:00", "01:00", False)),
        ([{"time": "09:00"}, {"time": "10:00", "duration": "半场"}], ("09:00", "10:30", False)),
        ([{"time": "待定"}], None),
    ],
)
def test_derive_time_range(schedule, expected):
    tr = derive_time_range(schedule)
    assert (tr and (tr.start, tr.end, tr.cross_day)) == expected
