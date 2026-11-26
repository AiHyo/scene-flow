"""Optimistic locking on project PATCH."""

from __future__ import annotations

import asyncio


async def _create(client, session):
    resp = await client.post("/api/v1/project", json={"title": "原标题", "data": {"v": 0}}, headers=session.headers)
    assert resp.status_code == 201
    return resp.json()["id"]


async def _patch(client, session, pid, **body):
    return await client.patch(f"/api/v1/project/{pid}", json=body, headers=session.headers)


async def test_new_project_starts_at_version_1(client, make_guest):
    guest = await make_guest()
    pid = await _create(client, guest)
    detail = (await client.get(f"/api/v1/project/{pid}", headers=guest.headers)).json()
    assert detail["version"] == 1
    listing = (await client.get("/api/v1/project", headers=guest.headers)).json()
    assert listing[0]["version"] == 1


async def test_matching_version_succeeds_and_increments(client, make_guest):
    guest = await make_guest()
    pid = await _create(client, guest)

    first = await _patch(client, guest, pid, data={"v": 1}, expectedVersion=1)
    assert first.status_code == 200 and first.json() == {"version": 2}

    second = await _patch(client, guest, pid, data={"v": 2}, expectedVersion=2)
    assert second.json() == {"version": 3}
    detail = (await client.get(f"/api/v1/project/{pid}", headers=guest.headers)).json()
    assert detail["data"] == {"v": 2} and detail["version"] == 3


async def test_stale_version_is_rejected_with_current_version(client, make_guest):
    guest = await make_guest()
    pid = await _create(client, guest)
    assert (await _patch(client, guest, pid, data={"by": "window A"}, expectedVersion=1)).status_code == 200

    stale = await _patch(client, guest, pid, data={"by": "window B"}, expectedVersion=1)

    assert stale.status_code == 409
    assert stale.json() == {"detail": "活动已在其他窗口更新", "code": "version_conflict", "currentVersion": 2}
    detail = (await client.get(f"/api/v1/project/{pid}", headers=guest.headers)).json()
    assert detail["data"] == {"by": "window A"}  # B did not overwrite A


async def test_overwrite_with_current_version_after_conflict(client, make_guest):
    """「用我的版本覆盖」= resubmit with the currentVersion from the 409."""
    guest = await make_guest()
    pid = await _create(client, guest)
    await _patch(client, guest, pid, data={"by": "A"}, expectedVersion=1)
    conflict = await _patch(client, guest, pid, data={"by": "B"}, expectedVersion=1)

    retry = await _patch(client, guest, pid, data={"by": "B"}, expectedVersion=conflict.json()["currentVersion"])

    assert retry.status_code == 200
    assert (await client.get(f"/api/v1/project/{pid}", headers=guest.headers)).json()["data"] == {"by": "B"}


async def test_patch_without_version_is_unconditional_but_bumps_version(client, make_guest):
    guest = await make_guest()
    pid = await _create(client, guest)
    resp = await _patch(client, guest, pid, title="改名")
    assert resp.json() == {"version": 2}
    # An editor still holding version 1 now sees the rename as a conflict.
    assert (await _patch(client, guest, pid, data={"x": 1}, expectedVersion=1)).status_code == 409


async def test_concurrent_writers_with_same_version_only_one_wins(client, make_guest):
    guest = await make_guest()
    pid = await _create(client, guest)

    results = await asyncio.gather(
        *[_patch(client, guest, pid, data={"writer": i}, expectedVersion=1) for i in range(5)]
    )

    codes = sorted(r.status_code for r in results)
    assert codes == [200, 409, 409, 409, 409]
    winner = next(i for i, r in enumerate(results) if r.status_code == 200)
    detail = (await client.get(f"/api/v1/project/{pid}", headers=guest.headers)).json()
    assert detail["data"] == {"writer": winner} and detail["version"] == 2


async def test_version_check_still_enforces_ownership(client, make_guest):
    owner, intruder = await make_guest(), await make_guest()
    pid = await _create(client, owner)
    resp = await _patch(client, intruder, pid, data={"x": 1}, expectedVersion=1)
    assert resp.status_code == 403
