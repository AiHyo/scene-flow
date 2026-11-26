from __future__ import annotations

import asyncio
import json
from functools import cached_property

import boto3
from botocore.client import Config as BotoConfig
from botocore.exceptions import ClientError

from app.core.config import settings
from app.storage.base import StoredObject


class S3Storage:
    """MinIO / S3 implementation. boto3 is blocking, so calls run in a thread."""

    def __init__(self, *, endpoint: str, public_base_url: str, access_key: str, secret_key: str, bucket: str):
        self.endpoint = endpoint
        self.public_base_url = public_base_url
        self.bucket = bucket
        self._access_key = access_key
        self._secret_key = secret_key

    @cached_property
    def _client(self):
        return boto3.client(
            "s3",
            endpoint_url=self.endpoint,
            aws_access_key_id=self._access_key,
            aws_secret_access_key=self._secret_key,
            config=BotoConfig(signature_version="s3v4"),
            region_name="us-east-1",
        )

    async def put(self, key: str, data: bytes, content_type: str) -> None:
        await asyncio.to_thread(
            self._client.put_object, Bucket=self.bucket, Key=key, Body=data, ContentType=content_type
        )

    async def get(self, key: str) -> StoredObject | None:
        def _get() -> StoredObject | None:
            try:
                obj = self._client.get_object(Bucket=self.bucket, Key=key)
            except ClientError as exc:
                if exc.response.get("Error", {}).get("Code") in ("NoSuchKey", "404"):
                    return None
                raise
            return StoredObject(key, obj["Body"].read(), obj.get("ContentType") or "application/octet-stream")

        return await asyncio.to_thread(_get)

    async def exists(self, key: str) -> bool:
        def _head() -> bool:
            try:
                self._client.head_object(Bucket=self.bucket, Key=key)
                return True
            except ClientError:
                return False

        return await asyncio.to_thread(_head)

    async def delete_many(self, keys: list[str]) -> None:
        if not keys:
            return
        await asyncio.to_thread(
            self._client.delete_objects,
            Bucket=self.bucket,
            Delete={"Objects": [{"Key": k} for k in keys]},
        )

    async def ensure_ready(self) -> None:
        """Create the bucket if needed and allow anonymous reads (images are shown by URL)."""

        def _ensure() -> None:
            try:
                self._client.head_bucket(Bucket=self.bucket)
            except ClientError:
                self._client.create_bucket(Bucket=self.bucket)
            policy = {
                "Version": "2012-10-17",
                "Statement": [
                    {
                        "Effect": "Allow",
                        "Principal": {"AWS": ["*"]},
                        "Action": ["s3:GetObject"],
                        "Resource": [f"arn:aws:s3:::{self.bucket}/*"],
                    }
                ],
            }
            self._client.put_bucket_policy(Bucket=self.bucket, Policy=json.dumps(policy))

        await asyncio.to_thread(_ensure)


def storage_from_settings() -> S3Storage:
    return S3Storage(
        endpoint=settings.minio_endpoint,
        public_base_url=settings.minio_public_url,
        access_key=settings.minio_access_key,
        secret_key=settings.minio_secret_key,
        bucket=settings.minio_bucket,
    )
