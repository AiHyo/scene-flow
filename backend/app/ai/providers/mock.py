"""Demo-mode providers: deterministic, honest, and good enough to walk through every
UI flow without an API key. They never pretend a sample image is the user's venue."""

from __future__ import annotations

import asyncio
import json
import uuid
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any

from app.ai.image_refs import SAMPLE_AFTER_KEYS, ResolvedImage
from app.core.errors import BadRequest
from app.storage import get_storage

FIXTURES = Path(__file__).resolve().parent / "mock_fixtures"

DEMO_VISION_DESCRIPTION = (
    "（演示模式示例识别结果）画面是一处开阔的活动空间：地面平整，主要区域空旷，"
    "四周有可利用的边界与通道。入口、门窗位置与精确尺寸在画面中无法确认。"
)

DEMO_CHAT_REPLY = (
    "你好呀，我是小灵～当前是演示模式（未配置模型密钥），我的回复是预置示例。"
    "配置 LLM_API_KEY 后，就能基于你的需求给出真实建议啦。"
)


def sse_chunks(text: str, *, step: int = 2) -> list[bytes]:
    """Split text into OpenAI `chat.completion.chunk` SSE frames, ending with [DONE]."""
    cid = f"chatcmpl-demo-{uuid.uuid4().hex[:12]}"
    frames = []
    for i in range(0, len(text), step):
        chunk = {
            "id": cid,
            "object": "chat.completion.chunk",
            "choices": [{"index": 0, "delta": {"content": text[i : i + step]}, "finish_reason": None}],
        }
        frames.append(f"data: {json.dumps(chunk, ensure_ascii=False)}\n\n".encode())
    frames.append(b"data: [DONE]\n\n")
    return frames


class MockLLM:
    name = "mock"
    model = "demo"

    def __init__(self, delay_ms: int = 15, reply_for=None):
        self.delay = delay_ms / 1000
        # reply_for(messages) -> str; replaced by the scripted demo replies in a later step
        self._reply_for = reply_for or (lambda _messages: DEMO_CHAT_REPLY)

    async def stream_chat(self, messages: list[dict[str, Any]]) -> AsyncIterator[bytes]:
        frames = sse_chunks(self._reply_for(messages))

        async def _iter() -> AsyncIterator[bytes]:
            for frame in frames:
                if self.delay:
                    await asyncio.sleep(self.delay)
                yield frame

        return _iter()

    async def complete_json(
        self, messages: list[dict[str, Any]], schema_name: str, schema: dict[str, Any] | None
    ) -> str:
        """Prepared example output for each generation mode (validated like real output)."""
        return (FIXTURES / f"{schema_name}.json").read_text(encoding="utf-8")


class MockVision:
    name = "mock"

    async def describe(self, question: str, image: ResolvedImage) -> str:
        return DEMO_VISION_DESCRIPTION


class MockImageGen:
    """Returns the prepared 'after' image for built-in sample venues only."""

    name = "mock"
    is_async = False

    async def edit(self, prompt: str, image: ResolvedImage) -> bytes:
        after_key = SAMPLE_AFTER_KEYS.get(image.key)
        if after_key is None:
            raise BadRequest("演示模式仅支持样例场地生成效果图；配置模型密钥后即可使用你自己的场地照片")
        obj = await get_storage().get(after_key)
        if obj is None:
            raise BadRequest("演示用效果图未就绪，请稍后重试")
        return obj.data
