"""Provider selection.

`AI_PROVIDER=auto` (default) uses real models when `LLM_API_KEY` is set and falls back
to demo mode otherwise, so a fresh clone works without any key. Resolved on every
call (cheap) so tests and config changes never see a stale choice.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from app.ai.providers.base import (
    AsyncImageGenProvider,
    LLMProvider,
    SyncImageGenProvider,
    VisionProvider,
)
from app.ai.providers.kling import KlingImageGen
from app.ai.providers.mock import MockImageGen, MockLLM, MockVision
from app.ai.providers.openai_compat import OpenAICompatImageEdit, OpenAICompatLLM, OpenAICompatVision
from app.core.config import settings
from app.core.errors import ServiceMisconfigured

AIMode = Literal["live", "demo"]


@dataclass(frozen=True)
class Providers:
    mode: AIMode
    llm: LLMProvider
    vision: VisionProvider
    image: SyncImageGenProvider | AsyncImageGenProvider


def ai_mode() -> AIMode:
    if settings.ai_provider == "mock":
        return "demo"
    if settings.ai_provider == "openai":
        return "live"
    return "live" if settings.llm_api_key else "demo"


def get_providers() -> Providers:
    if ai_mode() == "demo":
        return Providers(
            mode="demo",
            llm=MockLLM(delay_ms=settings.mock_stream_delay_ms),
            vision=MockVision(),
            image=MockImageGen(),
        )

    if not settings.llm_api_key:
        raise ServiceMisconfigured("AI_PROVIDER=openai 但未配置 LLM_API_KEY")

    llm = OpenAICompatLLM(settings.llm_base_url, settings.llm_api_key, settings.llm_model, settings.llm_vision_model)
    vision = OpenAICompatVision(
        settings.vision_base_url or settings.llm_base_url,
        settings.vision_api_key or settings.llm_api_key,
        settings.vision_model or settings.llm_vision_model,
    )
    image: SyncImageGenProvider | AsyncImageGenProvider
    if settings.img_gen_provider == "kling":
        if not settings.img_gen_base_url or not settings.img_gen_api_key:
            raise ServiceMisconfigured("IMG_GEN_PROVIDER=kling 但未配置 IMG_GEN_BASE_URL 或 IMG_GEN_API_KEY")
        image = KlingImageGen(settings.img_gen_base_url, settings.img_gen_api_key)
    else:
        image = OpenAICompatImageEdit(
            settings.img_gen_base_url or settings.llm_base_url,
            settings.img_gen_api_key or settings.llm_api_key,
            settings.img_gen_model or "gpt-image-2.6",
        )
    return Providers(mode="live", llm=llm, vision=vision, image=image)
