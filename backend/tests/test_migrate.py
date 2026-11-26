"""Guest → account project migration must prove ownership of the guest identity."""

from __future__ import annotations


async def _create_project(client, session, title):
    resp = await client.post("/api/v1/project", json={"title": title, "data": {}}, headers=session.headers)
    assert resp.status_code == 201
    return resp.json()["id"]


async def _owner_titles(client, session):
    return {p["title"] for p in (await client.get("/api/v1/project", headers=session.headers)).json()}


async def test_holder_of_guest_credential_can_migrate(client, make_guest, make_account):
    guest = await make_guest()
    await _create_project(client, guest, "访客活动 1")
    await _create_project(client, guest, "访客活动 2")
    account = await make_account()

    resp = await client.post(
        "/api/v1/auth/migrate-project", json={"credentialId": guest.credential_id}, headers=account.headers
    )

    assert resp.status_code == 200
    assert resp.json() == {"migratedCount": 2}
    assert await _owner_titles(client, account) == {"访客活动 1", "访客活动 2"}
    assert await _owner_titles(client, guest) == set()


async def test_knowing_only_the_guest_id_is_not_enough(client, make_guest, make_account):
    """The old API accepted fromUserId: anyone with a guest's UUID could take their projects."""
    victim = await make_guest()
    await _create_project(client, victim, "受害者的活动")
    attacker = await make_account()

    old_style = await client.post(
        "/api/v1/auth/migrate-project", json={"fromUserId": victim.id}, headers=attacker.headers
    )
    guessed = await client.post(
        "/api/v1/auth/migrate-project", json={"credentialId": victim.id}, headers=attacker.headers
    )

    assert old_style.status_code == 422
    assert guessed.status_code == 403
    assert await _owner_titles(client, victim) == {"受害者的活动"}
    assert await _owner_titles(client, attacker) == set()


async def test_unknown_credential_is_forbidden(client, make_account):
    account = await make_account()
    resp = await client.post(
        "/api/v1/auth/migrate-project", json={"credentialId": "cred-does-not-exist"}, headers=account.headers
    )
    assert resp.status_code == 403
    assert resp.json()["code"] == "forbidden"


async def test_guest_cannot_call_migration(client, make_guest):
    guest = await make_guest()
    resp = await client.post(
        "/api/v1/auth/migrate-project", json={"credentialId": guest.credential_id}, headers=guest.headers
    )
    assert resp.status_code == 403
