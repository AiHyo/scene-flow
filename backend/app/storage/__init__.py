"""Process-wide storage handle. Tests replace it with `set_storage(MemoryStorage())`."""

from __future__ import annotations

from app.storage.base import ObjectStorage

_storage: ObjectStorage | None = None


def get_storage() -> ObjectStorage:
    global _storage
    if _storage is None:
        from app.storage.s3 import storage_from_settings

        _storage = storage_from_settings()
    return _storage


def set_storage(storage: ObjectStorage | None) -> None:
    global _storage
    _storage = storage
