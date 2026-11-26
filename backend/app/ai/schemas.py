"""Structured outputs for the four generation modes.

The Pydantic models are the source of truth and validate locally (including counts).
`strict_json_schema()` derives the schema sent to the provider as
`response_format: json_schema, strict: true`: structure only (fields, types, enums),
with keywords that OpenAI strict mode rejects (minItems, maxLength, …) removed.
Field names match what the frontend reads (PlanModule.tsx), so no adapter is needed.
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


# ---- directions


class DirectionOut(_Strict):
    name: str
    style: str
    highlights: list[str] = Field(min_length=1, max_length=6)
    difficulty: Literal["低", "中", "较高"]
    budgetLevel: Literal["较低", "中等", "较高"]
    note: str


class DirectionsOut(_Strict):
    directions: list[DirectionOut] = Field(min_length=2, max_length=5)


# ---- theme


class ThemeBody(_Strict):
    name: str
    slogan: str
    highlights: list[str] = Field(min_length=1, max_length=6)


class ThemeOut(_Strict):
    theme: ThemeBody


# ---- copies


class CopiesOut(_Strict):
    invite: str
    hosting: str
    onsite: list[str] = Field(min_length=1, max_length=8)


# ---- full scheme


class ScheduleItemOut(_Strict):
    name: str
    time: str
    duration: str
    note: str


class BudgetItemOut(_Strict):
    name: str
    qty: float
    unitPrice: float


class MaterialOut(_Strict):
    category: str
    name: str
    qty: str
    ready: bool


class TaskOut(_Strict):
    name: str
    owner: str
    deadline: str
    done: bool


class SchemeOut(_Strict):
    theme: ThemeBody
    schedule: list[ScheduleItemOut] = Field(min_length=1, max_length=12)
    budgetItems: list[BudgetItemOut] = Field(min_length=1, max_length=20)
    materials: list[MaterialOut] = Field(max_length=40)
    tasks: list[TaskOut] = Field(max_length=40)
    copies: CopiesOut


OUTPUT_MODELS: dict[str, type[BaseModel]] = {
    "directions": DirectionsOut,
    "theme": ThemeOut,
    "scheme": SchemeOut,
    "copies": CopiesOut,
}

_UNSUPPORTED_IN_STRICT = {
    "minItems",
    "maxItems",
    "minLength",
    "maxLength",
    "minimum",
    "maximum",
    "pattern",
    "format",
    "default",
    "title",
    "description",
}


def _clean(node: Any) -> Any:
    if isinstance(node, dict):
        out = {}
        for k, v in node.items():
            if k in ("properties", "$defs"):
                # keys here are field / definition names, not schema keywords: keep them all
                out[k] = {name: _clean(sub) for name, sub in v.items()}
            elif k not in _UNSUPPORTED_IN_STRICT:
                out[k] = _clean(v)
        if out.get("type") == "object" and "properties" in out:
            out["additionalProperties"] = False
            out["required"] = list(out["properties"])
        return out
    if isinstance(node, list):
        return [_clean(v) for v in node]
    return node


def strict_json_schema(model: type[BaseModel]) -> dict[str, Any]:
    return _clean(model.model_json_schema())
