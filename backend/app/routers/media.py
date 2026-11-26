from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, UploadFile

from app.core.deps import get_current_user
from app.core.errors import BadRequest, PayloadTooLarge
from app.models.profile import Profile
from app.schemas.common import CamelModel
from app.storage.s3 import upload_bytes

router = APIRouter(prefix="/api/v1/media", tags=["media"])

MAX_IMAGE_BYTES = 5 * 1024 * 1024
ALLOWED_CONTENT_TYPES = {"image/jpeg", "image/png", "image/webp", "image/gif"}


class MediaUploadOut(CamelModel):
    url: str
    object_key: str


@router.post("/upload", response_model=MediaUploadOut)
async def upload_media(
    file: UploadFile = File(...),
    folder: str = Form(default="misc"),
    _user: Profile = Depends(get_current_user),
) -> MediaUploadOut:
    """上传图片至 MinIO 并返回公开访问地址"""
    content_type = (file.content_type or "").lower()
    if content_type not in ALLOWED_CONTENT_TYPES:
        raise BadRequest("仅支持 JPG/PNG/WebP/GIF 格式图片")

    raw = await file.read()
    if not raw:
        raise BadRequest("上传文件不能为空")
    if len(raw) > MAX_IMAGE_BYTES:
        raise PayloadTooLarge("图片大小不能超过 5MB")

    ext = Path(file.filename or "").suffix or ".jpg"
    url, object_key = await upload_bytes(raw, folder=folder, ext=ext, content_type=content_type)
    return MediaUploadOut(url=url, object_key=object_key)
