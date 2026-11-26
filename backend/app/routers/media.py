from __future__ import annotations

from fastapi import APIRouter, Depends, File, Form, Request, UploadFile

from app.core.deps import get_current_user
from app.core.errors import BadRequest, PayloadTooLarge
from app.models.profile import Profile
from app.schemas.common import CamelModel
from app.storage import get_storage
from app.storage.base import upload

router = APIRouter(prefix="/api/v1/media", tags=["media"])

MAX_IMAGE_BYTES = 5 * 1024 * 1024
# multipart 边界与表单字段的额外开销
_MULTIPART_OVERHEAD = 64 * 1024

# 前端实际使用的上传目录；generated / samples 仅供后端内部写入
UPLOAD_FOLDERS = ("avatar", "plaza", "venue")

_EXT_BY_TYPE = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "image/gif": ".gif"}


def sniff_image_type(head: bytes) -> str | None:
    """Identify the image format from its magic bytes."""
    if head.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if head.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if head.startswith((b"GIF87a", b"GIF89a")):
        return "image/gif"
    if len(head) >= 12 and head[:4] == b"RIFF" and head[8:12] == b"WEBP":
        return "image/webp"
    return None


class MediaUploadOut(CamelModel):
    url: str
    object_key: str


@router.post("/upload", response_model=MediaUploadOut)
async def upload_media(
    request: Request,
    file: UploadFile = File(...),
    folder: str = Form(..., description="上传目录：avatar | plaza | venue"),
    _user: Profile = Depends(get_current_user),
) -> MediaUploadOut:
    """上传图片至对象存储并返回公开访问地址"""
    if folder not in UPLOAD_FOLDERS:
        raise BadRequest("不支持的上传目录")
    declared = (file.content_type or "").lower()
    if declared not in _EXT_BY_TYPE:
        raise BadRequest("仅支持 JPG/PNG/WebP/GIF 格式图片")

    # 请求头声明的长度明显超限时直接拒绝；但不信任它，下面仍限量读取
    content_length = request.headers.get("content-length")
    if content_length and content_length.isdigit() and int(content_length) > MAX_IMAGE_BYTES + _MULTIPART_OVERHEAD:
        raise PayloadTooLarge("图片大小不能超过 5MB")

    raw = await file.read(MAX_IMAGE_BYTES + 1)
    if not raw:
        raise BadRequest("上传文件不能为空")
    if len(raw) > MAX_IMAGE_BYTES:
        raise PayloadTooLarge("图片大小不能超过 5MB")

    actual = sniff_image_type(raw[:16])
    if actual != declared:
        raise BadRequest("文件内容与声明的图片格式不符")

    url, key = await upload(get_storage(), raw, folder=folder, ext=_EXT_BY_TYPE[actual], content_type=actual)
    return MediaUploadOut(url=url, object_key=key)
