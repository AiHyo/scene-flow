from __future__ import annotations


async def test_guest_login_is_stable_per_credential(make_guest):
    first = await make_guest("cred-stable-0001")
    again = await make_guest("cred-stable-0001")
    other = await make_guest("cred-other-0002")

    assert first.user["isAnon"] is True
    assert again.id == first.id
    assert other.id != first.id


async def test_register_then_login(client, make_account):
    account = await make_account("alice@example.com", "pass1234")
    assert account.user["isAnon"] is False

    resp = await client.post("/api/v1/auth/login", json={"email": "Alice@Example.com", "password": "pass1234"})
    assert resp.status_code == 200
    assert resp.json()["user"]["id"] == account.id


async def test_register_duplicate_email_conflicts(client, make_account):
    await make_account("dup@example.com")
    resp = await client.post("/api/v1/auth/register", json={"email": "dup@example.com", "password": "secret123"})
    assert resp.status_code == 409


async def test_login_wrong_password_rejected(client, make_account):
    await make_account("bob@example.com", "right-pass")
    resp = await client.post("/api/v1/auth/login", json={"email": "bob@example.com", "password": "wrong-pass"})
    assert resp.status_code == 401


async def test_me_requires_token(client):
    assert (await client.get("/api/v1/auth/me")).status_code == 401
    bad = await client.get("/api/v1/auth/me", headers={"Authorization": "Bearer not-a-jwt"})
    assert bad.status_code == 401


async def test_patch_me_updates_nickname(client, make_account):
    account = await make_account()
    resp = await client.patch("/api/v1/auth/me", json={"nickname": "  新昵称  "}, headers=account.headers)
    assert resp.status_code == 200
    assert resp.json()["nickname"] == "新昵称"
