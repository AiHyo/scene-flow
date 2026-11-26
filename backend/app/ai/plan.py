"""AI co-planning: assemble the prompt server-side, call the model, validate the result.

Chat streams through unchanged (OpenAI chunk format, protocol lines parsed by the
frontend). The four generation modes return validated objects:

  json_schema strict → Pydantic validation → on failure, one repair retry carrying the
  validation errors → still invalid → 502 `structured_output_invalid`.
"""

from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass
from typing import Any

from pydantic import BaseModel, ValidationError
from sqlalchemy.ext.asyncio import AsyncSession

from app.ai.assemble import ChatOptions, Mode, build_messages
from app.ai.prompts import PROMPT_VERSION, current
from app.ai.providers import get_providers
from app.ai.providers.base import LLMProvider
from app.ai.quota import enforce_quota
from app.ai.schemas import OUTPUT_MODELS, strict_json_schema
from app.ai.tasks import create_task_row, set_task_state
from app.core.config import settings
from app.core.errors import AppError
from app.models.profile import Profile

logger = logging.getLogger(__name__)

REPAIR_INSTRUCTION = (
    "你上一次的输出不符合要求，问题如下：\n{errors}\n"
    "请只输出一个完整、合法、符合上述格式要求的 JSON 对象，不要任何其他文字、注释或代码块标记。"
)


class StructuredOutputInvalid(AppError):
    status_code = 502
    code = "structured_output_invalid"


def extract_json_text(raw: str) -> str:
    """Tolerate code fences or stray prose around the JSON (prompt-only providers)."""
    cleaned = re.sub(r"```(?:json)?", "", raw).strip()
    start, end = cleaned.find("{"), cleaned.rfind("}")
    return cleaned[start : end + 1] if 0 <= start < end else cleaned


def _validate(model: type[BaseModel], raw: str) -> tuple[BaseModel | None, str]:
    try:
        return model.model_validate(json.loads(extract_json_text(raw))), ""
    except json.JSONDecodeError as exc:
        return None, f"不是合法的 JSON：{exc.msg}（位置 {exc.pos}）"
    except ValidationError as exc:
        problems = [f"- {'.'.join(str(p) for p in e['loc']) or '根对象'}：{e['msg']}" for e in exc.errors()[:10]]
        return None, "\n".join(problems)


async def _record(db: AsyncSession, user: Profile, mode: str, provider: str) -> Any:
    await enforce_quota(db, user, "chat")
    row = await create_task_row(
        db,
        user,
        kind="chat",
        provider=provider,
        input={"mode": mode, "promptVersion": PROMPT_VERSION},
        status="running",
    )
    await db.commit()
    return row


async def open_plan_chat(db: AsyncSession, user: Profile, project: dict[str, Any], user_text: str, opts: ChatOptions):
    llm = get_providers().llm
    messages = build_messages(current(), "chat", project, user_text, opts)
    row = await _record(db, user, "chat", llm.name)
    try:
        stream = await llm.stream_chat(messages)
    except Exception as exc:
        await set_task_state(row.id, status="failed", error=str(exc)[:500])
        raise
    await set_task_state(row.id, status="succeeded")
    return stream


async def generate(
    db: AsyncSession, user: Profile, mode: Mode, project: dict[str, Any], user_text: str, nickname: str | None
) -> dict[str, Any]:
    llm = get_providers().llm
    messages = build_messages(current(), mode, project, user_text, ChatOptions(nickname=nickname))
    row = await _record(db, user, mode, llm.name)
    try:
        result = await structured_completion(llm, mode, messages)
    except Exception as exc:
        await set_task_state(row.id, status="failed", error=str(exc)[:500])
        raise
    await set_task_state(row.id, status="succeeded", result={"repaired": result.repaired})
    return {"mode": mode, "data": result.data, "promptVersion": PROMPT_VERSION}


@dataclass(frozen=True)
class StructuredResult:
    data: dict[str, Any]
    repaired: bool
    raw_outputs: list[str]  # every model response, in order (kept for evaluation recordings)


async def structured_completion(llm: LLMProvider, mode: Mode, messages: list[dict[str, Any]]) -> StructuredResult:
    """json_schema strict → validate → one repair retry → StructuredOutputInvalid.
    Shared by the API and the offline evaluation so both exercise the same path."""
    model = OUTPUT_MODELS[mode]
    schema = strict_json_schema(model) if settings.llm_structured_output == "json_schema" else None
    raws = [await llm.complete_json(messages, mode, schema)]
    parsed, errors = _validate(model, raws[-1])
    if parsed is None:
        logger.info("structured output invalid for %s, retrying once: %s", mode, errors.replace("\n", " | "))
        retry = [*messages, {"role": "assistant", "content": raws[-1]}]
        retry.append({"role": "user", "content": REPAIR_INSTRUCTION.format(errors=errors)})
        raws.append(await llm.complete_json(retry, mode, schema))
        parsed, errors = _validate(model, raws[-1])
    if parsed is None:
        raise StructuredOutputInvalid("AI 返回的内容格式不正确，请重试", extra={"errors": errors.splitlines()[:5]})
    return StructuredResult(data=parsed.model_dump(), repaired=len(raws) > 1, raw_outputs=raws)
