from __future__ import annotations

POST = {"title": "草坪团建", "content": "分享一下现场布置", "imgList": []}


async def test_guest_cannot_post(client, make_guest):
    guest = await make_guest()
    resp = await client.post("/api/v1/plaza-post", json=POST, headers=guest.headers)
    assert resp.status_code == 403


async def test_account_posts_and_list_is_public(client, make_account):
    author = await make_account()
    created = await client.post("/api/v1/plaza-post", json=POST, headers=author.headers)
    assert created.status_code == 201, created.text

    listing = await client.get("/api/v1/plaza-post")
    assert listing.status_code == 200
    assert [p["title"] for p in listing.json()] == ["草坪团建"]


async def test_like_toggles(client, make_account):
    author = await make_account()
    post_id = (await client.post("/api/v1/plaza-post", json=POST, headers=author.headers)).json()["id"]

    first = await client.post(f"/api/v1/plaza-post/{post_id}/like", headers=author.headers)
    second = await client.post(f"/api/v1/plaza-post/{post_id}/like", headers=author.headers)
    assert first.status_code == 200 and second.status_code == 200
    assert first.json()["liked"] is True
    assert second.json()["liked"] is False


async def test_only_author_can_delete_post_and_its_images(client, make_account, storage):
    await storage.put("plaza/a.jpg", b"img", "image/jpeg")
    author, other = await make_account(), await make_account()
    post = {**POST, "imgList": ["http://minio.test/media/plaza/a.jpg", "https://elsewhere.example/b.jpg"]}
    post_id = (await client.post("/api/v1/plaza-post", json=post, headers=author.headers)).json()["id"]

    assert (await client.delete(f"/api/v1/plaza-post/{post_id}", headers=other.headers)).status_code == 403
    assert await storage.exists("plaza/a.jpg")

    assert (await client.delete(f"/api/v1/plaza-post/{post_id}", headers=author.headers)).status_code == 204
    assert not await storage.exists("plaza/a.jpg")
