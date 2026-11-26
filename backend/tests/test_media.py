from __future__ import annotations

import pytest

from app.routers.media import MAX_IMAGE_BYTES

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64
JPEG = b"\xff\xd8\xff\xe0" + b"\x00" * 64


async def _upload(client, session, data: bytes, content_type: str, folder: str = "venue"):
    return await client.post(
        "/api/v1/media/upload",
        files={"file": ("photo.bin", data, content_type)},
        data={"folder": folder},
        headers=session.headers,
    )


async def test_upload_stores_object_with_type_derived_extension(client, make_guest, storage):
    guest = await make_guest()
    resp = await _upload(client, guest, PNG, "image/png")

    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["objectKey"].startswith("venue/") and body["objectKey"].endswith(".png")
    assert body["url"] == f"http://minio.test/media/{body['objectKey']}"
    assert (await storage.get(body["objectKey"])).data == PNG


@pytest.mark.parametrize("folder", ["generated", "samples", "../etc", "misc"])
async def test_upload_rejects_unknown_folder(client, make_guest, folder):
    guest = await make_guest()
    resp = await _upload(client, guest, PNG, "image/png", folder=folder)
    assert resp.status_code == 400
    assert resp.json()["detail"] == "不支持的上传目录"


@pytest.mark.parametrize(
    ("data", "declared"),
    [
        (JPEG, "image/png"),  # extension/type spoofing
        (b"<svg onload=alert(1)>", "image/png"),  # not an image at all
        (b"<html></html>", "image/jpeg"),
    ],
)
async def test_upload_rejects_content_that_does_not_match_declared_type(client, make_guest, data, declared):
    guest = await make_guest()
    resp = await _upload(client, guest, data, declared)
    assert resp.status_code == 400


async def test_upload_rejects_unsupported_declared_type(client, make_guest):
    guest = await make_guest()
    resp = await _upload(client, guest, b"<svg/>", "image/svg+xml")
    assert resp.status_code == 400


async def test_upload_rejects_oversized_file(client, make_guest):
    guest = await make_guest()
    resp = await _upload(client, guest, PNG + b"\x00" * MAX_IMAGE_BYTES, "image/png")
    assert resp.status_code == 413


async def test_upload_rejects_empty_file(client, make_guest):
    guest = await make_guest()
    resp = await _upload(client, guest, b"", "image/png")
    assert resp.status_code == 400


async def test_upload_requires_login(client):
    resp = await client.post(
        "/api/v1/media/upload", files={"file": ("a.png", PNG, "image/png")}, data={"folder": "venue"}
    )
    assert resp.status_code == 401
