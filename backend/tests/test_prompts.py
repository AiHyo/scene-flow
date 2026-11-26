"""Guards on the production prompt templates."""

from __future__ import annotations

import re
from pathlib import Path
from string import Template

from app.ai.prompts import PROMPT_HASH, PROMPT_VERSION, PROMPTS_DIR, PromptSet, content_hash, current

LEGACY = PromptSet.load(Path(__file__).resolve().parent / "golden" / "legacy_prompts")
RULE = re.compile(r"^(\d+b?)\. (.+)$", re.M)


def _rules(text: str) -> list[tuple[str, str]]:
    return RULE.findall(text)


def test_version_matches_template_content():
    """Editing any template requires bumping VERSION (and a live eval report, enforced in CI)."""
    actual = content_hash(PROMPTS_DIR)
    assert actual == PROMPT_HASH, (
        "Prompt templates changed but backend/app/ai/prompts/VERSION was not updated.\n"
        f"Bump the version and set the hash to {actual}, then run the live evaluation against the real "
        "model and commit its report (docs/evals/). CI never calls models; this is how prompt changes stay tested."
    )
    assert re.fullmatch(r"\d{4}-\d{2}-\d{2}\.\d+", PROMPT_VERSION)


def test_no_legacy_rule_was_dropped():
    """Each original rule's opening phrase must still be present in the production system prompt."""
    production = current().system
    missing = [f"{num}. {body[:18]}" for num, body in _rules(LEGACY.system) if body[:18] not in production]
    assert not missing, f"rules missing from the production prompt: {missing}"
    assert len(_rules(production)) >= len(_rules(LEGACY.system))


def test_role_keeps_identity_and_safety_rule():
    """Wording may evolve (version hash + live eval guard that); these must not be lost."""
    role = current().role
    assert "「小灵」" in role
    assert "绝不把角色名或昵称写进正式活动方案" in role
    assert "核心准则：" in current().system


def test_rules_are_numbered_sequentially():
    numbers = [num for num, _ in _rules(current().system)]
    assert numbers == [str(i) for i in range(1, len(numbers) + 1)]


def test_rule_cross_references_point_to_the_right_rule():
    """The nickname fragment cites a rule by number; it must be the nickname rule."""
    prompts = current()
    cited = re.findall(r"准则(\d+)", prompts.fragments["nickname"])
    rules = dict(_rules(prompts.system))
    for num in cited:
        assert rules[num].startswith("用户昵称互动"), (num, rules[num][:20])


def test_every_fragment_renders_with_its_placeholders():
    for name, text in current().fragments.items():
        placeholders = {
            m.group("braced") or m.group("named")
            for m in Template.pattern.finditer(text)
            if m.group("braced") or m.group("named")
        }
        rendered = Template(text).substitute(dict.fromkeys(placeholders, "X"))
        assert "${" not in rendered, name
