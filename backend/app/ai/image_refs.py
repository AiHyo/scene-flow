"""The only way AI features read an image the user referenced.

SSRF guard: the server never fetches a URL the client supplied. An image reference
is accepted only if it is
  1. a public URL of an object in our own bucket, read back through the storage
     client (no HTTP request), or
  2. one of the registered sample venue paths, which are pre-seeded into the
     bucket at startup.
Everything else (other hosts, internal addresses, data: URLs, relative paths that
are not registered) is rejected with 400.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from pathlib import Path

from app.core.config import settings
from app.core.errors import BadRequest
from app.storage import get_storage
from app.storage.base import key_from_url, public_url

logger = logging.getLogger(__name__)

# 与 src/data/venueSamples.ts 中的 before 路径一一对应
SAMPLE_VENUES: dict[str, str] = {
    "/images/layout-reference/01-lawn-before.png": "samples/01-lawn-before.png",
    "/images/layout-reference/02-graduation-before.png": "samples/02-graduation-before.png",
    "/images/layout-reference/03-courtyard-before.png": "samples/03-courtyard-before.png",
}

MAX_REFERENCED_IMAGE_BYTES = 15 * 1024 * 1024


@dataclass(frozen=True)
class ResolvedImage:
    key: str
    data: bytes
    content_type: str
    public_url: str


def _key_for_ref(ref: str) -> str | None:
    ref = ref.strip()
    if ref in SAMPLE_VENUES:
        return SAMPLE_VENUES[ref]
    return key_from_url(get_storage(), ref)


def validate_image_ref(ref: str) -> str:
    """Check a reference without reading it; returns the object key."""
    key = _key_for_ref(ref)
    if key is None:
        raise BadRequest("仅支持本站上传的图片或内置样例场地")
    return key


async def resolve_image_ref(ref: str) -> ResolvedImage:
    key = validate_image_ref(ref)
    storage = get_storage()
    obj = await storage.get(key)
    if obj is None:
        raise BadRequest("图片不存在或已被删除，请重新上传")
    if not obj.content_type.startswith("image/"):
        raise BadRequest("引用的文件不是图片")
    if len(obj.data) > MAX_REFERENCED_IMAGE_BYTES:
        raise BadRequest("图片过大")
    return ResolvedImage(key, obj.data, obj.content_type, public_url(storage, key))


async def seed_sample_venues(source_dir: str | Path | None = None) -> int:
    """Upload missing sample venue images into the bucket. Idempotent.

    A missing source file is logged, not fatal: the rest of the app still works and
    the resolver reports a clear error if that sample is used.
    """
    base = Path(source_dir or settings.sample_assets_dir)
    storage = get_storage()
    seeded = 0
    for rel_path, key in SAMPLE_VENUES.items():
        if await storage.exists(key):
            continue
        src = base / Path(rel_path).name
        if not src.is_file():
            logger.warning("sample venue image not found: %s", src)
            continue
        await storage.put(key, src.read_bytes(), "image/png")
        seeded += 1
    if seeded:
        logger.info("seeded %d sample venue image(s)", seeded)
    return seeded
