from __future__ import annotations

import asyncio
import json
import uuid
from functools import lru_cache
from urllib.parse import urlparse

import boto3
from botocore.client import Config as BotoConfig
from botocore.exceptions import ClientError

from app.core.config import settings


@lru_cache(maxsize=1)
def _get_s3_client():
    return boto3.client(
        "s3",
        endpoint_url=settings.minio_endpoint,
        aws_access_key_id=settings.minio_access_key,
        aws_secret_access_key=settings.minio_secret_key,
        config=BotoConfig(signature_version="s3v4"),
        region_name="us-east-1",
    )


def build_public_url(object_key: str) -> str:
    """拼接对外可访问的对象存储 URL"""
    base = settings.minio_public_url.rstrip("/")
    return f"{base}/{settings.minio_bucket}/{object_key.lstrip('/')}"


def extract_object_key(url: str) -> str | None:
    """从公开 URL 提取当前 bucket 对应的对象键，外部链接返回 None"""
    parsed = urlparse(url)
    prefix = f"/{settings.minio_bucket}/"
    if not parsed.path.startswith(prefix):
        return None
    return parsed.path[len(prefix) :]


def _put_object_sync(object_key: str, data: bytes, content_type: str) -> None:
    _get_s3_client().put_object(
        Bucket=settings.minio_bucket,
        Key=object_key,
        Body=data,
        ContentType=content_type,
    )


def _delete_objects_sync(keys: list[str]) -> None:
    if not keys:
        return
    _get_s3_client().delete_objects(
        Bucket=settings.minio_bucket,
        Delete={"Objects": [{"Key": k} for k in keys]},
    )


def _ensure_bucket_sync() -> None:
    client = _get_s3_client()
    try:
        client.head_bucket(Bucket=settings.minio_bucket)
    except ClientError:
        client.create_bucket(Bucket=settings.minio_bucket)
    policy = {
        "Version": "2012-10-17",
        "Statement": [
            {
                "Effect": "Allow",
                "Principal": {"AWS": ["*"]},
                "Action": ["s3:GetObject"],
                "Resource": [f"arn:aws:s3:::{settings.minio_bucket}/*"],
            }
        ],
    }
    client.put_bucket_policy(Bucket=settings.minio_bucket, Policy=json.dumps(policy))


async def ensure_bucket() -> None:
    """确保存储桶存在并开启公开读权限"""
    await asyncio.to_thread(_ensure_bucket_sync)


async def upload_bytes(data: bytes, folder: str, ext: str, content_type: str) -> tuple[str, str]:
    """上传字节流到 MinIO，返回 (public_url, object_key)"""
    clean_folder = folder.strip("/ ") or "misc"
    clean_ext = ext if ext.startswith(".") else f".{ext}"
    object_key = f"{clean_folder}/{uuid.uuid4().hex}{clean_ext.lower()}"
    await asyncio.to_thread(_put_object_sync, object_key, data, content_type)
    return build_public_url(object_key), object_key


async def delete_by_urls(urls: list[str]) -> None:
    """按公开 URL 批量清理 MinIO 中的对象（跳过非本桶外部链接）"""
    keys = [k for u in urls if (k := extract_object_key(u))]
    if keys:
        await asyncio.to_thread(_delete_objects_sync, keys)
