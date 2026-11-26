from __future__ import annotations


async def _create(client, session, title="团建", data=None):
    resp = await client.post(
        "/api/v1/project", json={"title": title, "data": data or {"k": 1}}, headers=session.headers
    )
    assert resp.status_code == 201, resp.text
    return resp.json()["id"]


async def test_project_crud_roundtrip(client, make_guest):
    guest = await make_guest()
    pid = await _create(client, guest, data={"theme": "森系"})

    detail = await client.get(f"/api/v1/project/{pid}", headers=guest.headers)
    assert detail.status_code == 200
    assert detail.json()["data"] == {"theme": "森系"}

    patch = await client.patch(f"/api/v1/project/{pid}", json={"title": "新标题"}, headers=guest.headers)
    assert patch.status_code in (200, 204)
    assert (await client.get(f"/api/v1/project/{pid}", headers=guest.headers)).json()["title"] == "新标题"

    assert (await client.delete(f"/api/v1/project/{pid}", headers=guest.headers)).status_code == 204
    assert (await client.get(f"/api/v1/project/{pid}", headers=guest.headers)).status_code == 404


async def test_list_returns_only_own_projects(client, make_guest):
    alice, bob = await make_guest(), await make_guest()
    await _create(client, alice, "A1")
    await _create(client, alice, "A2")
    await _create(client, bob, "B1")

    titles = {p["title"] for p in (await client.get("/api/v1/project", headers=alice.headers)).json()}
    assert titles == {"A1", "A2"}


async def test_other_users_project_is_forbidden(client, make_guest):
    owner, intruder = await make_guest(), await make_guest()
    pid = await _create(client, owner)

    assert (await client.get(f"/api/v1/project/{pid}", headers=intruder.headers)).status_code == 403
    patch = await client.patch(f"/api/v1/project/{pid}", json={"title": "x"}, headers=intruder.headers)
    assert patch.status_code == 403
    assert (await client.delete(f"/api/v1/project/{pid}", headers=intruder.headers)).status_code == 403


async def test_project_requires_login(client):
    assert (await client.get("/api/v1/project")).status_code == 401
