from __future__ import annotations

from app.storage.base import StoredObject


class MemoryStorage:
    """In-process object store for tests."""

    def __init__(self, bucket: str = "media", public_base_url: str = "http://minio.test"):
        self.bucket = bucket
        self.public_base_url = public_base_url
        self.objects: dict[str, StoredObject] = {}

    async def put(self, key: str, data: bytes, content_type: str) -> None:
        self.objects[key] = StoredObject(key, data, content_type)

    async def get(self, key: str) -> StoredObject | None:
        return self.objects.get(key)

    async def exists(self, key: str) -> bool:
        return key in self.objects

    async def delete_many(self, keys: list[str]) -> None:
        for k in keys:
            self.objects.pop(k, None)

    async def ensure_ready(self) -> None:
        return None
