"""Object storage interface.

Business code depends on this protocol, not on boto3, so tests can swap in an
in-memory store and the SSRF-safe image resolver can read objects without HTTP.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from typing import Protocol
from urllib.parse import urlparse


@dataclass(frozen=True)
class StoredObject:
    key: str
    data: bytes
    content_type: str


class ObjectStorage(Protocol):
    bucket: str
    public_base_url: str

    async def put(self, key: str, data: bytes, content_type: str) -> None: ...

    async def get(self, key: str) -> StoredObject | None: ...

    async def exists(self, key: str) -> bool: ...

    async def delete_many(self, keys: list[str]) -> None: ...

    async def ensure_ready(self) -> None: ...


def public_url(storage: ObjectStorage, key: str) -> str:
    return f"{storage.public_base_url.rstrip('/')}/{storage.bucket}/{key.lstrip('/')}"


def key_from_url(storage: ObjectStorage, url: str) -> str | None:
    """Return the object key if `url` points into this bucket at the public base URL.

    Both scheme+host and the bucket path prefix must match, so a look-alike URL on
    another host (e.g. http://169.254.169.254/media/x) is not accepted.
    """
    target = urlparse(url)
    base = urlparse(storage.public_base_url)
    if target.scheme not in ("http", "https") or (target.scheme, target.netloc) != (base.scheme, base.netloc):
        return None
    prefix = f"{base.path.rstrip('/')}/{storage.bucket}/"
    if not target.path.startswith(prefix) or target.query or target.fragment:
        return None
    key = target.path[len(prefix) :]
    if not key or ".." in key.split("/"):
        return None
    return key


def new_object_key(folder: str, ext: str) -> str:
    clean_folder = folder.strip("/ ") or "misc"
    clean_ext = ext if ext.startswith(".") else f".{ext}"
    return f"{clean_folder}/{uuid.uuid4().hex}{clean_ext.lower()}"


async def upload(storage: ObjectStorage, data: bytes, folder: str, ext: str, content_type: str) -> tuple[str, str]:
    """Store bytes under a fresh key; returns (public_url, key)."""
    key = new_object_key(folder, ext)
    await storage.put(key, data, content_type)
    return public_url(storage, key), key


async def delete_by_urls(storage: ObjectStorage, urls: list[str]) -> None:
    """Delete objects referenced by public URLs; foreign URLs are skipped."""
    keys = [k for u in urls if (k := key_from_url(storage, u))]
    if keys:
        await storage.delete_many(keys)
