"""Phase 9D backend tests — admin_titles, admin_permissions, PATCH endpoints, enforcement, backward-compat."""
import os
import time
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
assert BASE_URL, "REACT_APP_BACKEND_URL not set"

CREDS = {
    "alice": ("alice", "password123"),
    "bob": ("bob", "password123"),
    "charlie": ("charlie", "password123"),
}


def _login(username, password):
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"username": username, "password": password}, timeout=15)
    assert r.status_code == 200, f"login {username} -> {r.status_code} {r.text}"
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def tokens():
    return {u: _login(*v) for u, v in CREDS.items()}


@pytest.fixture(scope="module")
def me_ids(tokens):
    out = {}
    for u, t in tokens.items():
        r = requests.get(f"{BASE_URL}/api/auth/me", headers={"Authorization": f"Bearer {t}"}, timeout=10)
        assert r.status_code == 200
        out[u] = r.json()["id"]
    return out


def _hdr(t):
    return {"Authorization": f"Bearer {t}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def fresh_group(tokens, me_ids):
    """Create a fresh group with alice as owner + bob + charlie."""
    body = {
        "title": f"TEST_Phase9D_{int(time.time())}",
        "participant_ids": [me_ids["bob"], me_ids["charlie"]],
    }
    r = requests.post(f"{BASE_URL}/api/groups", json=body, headers=_hdr(tokens["alice"]), timeout=15)
    assert r.status_code in (200, 201), f"create group -> {r.status_code} {r.text}"
    return r.json()["id"]


class TestPatchAdminRoleEndpoint:
    def test_promote_bob_to_admin(self, tokens, me_ids, fresh_group):
        r = requests.post(
            f"{BASE_URL}/api/groups/{fresh_group}/admins/{me_ids['bob']}",
            headers=_hdr(tokens["alice"]),
            timeout=10,
        )
        assert r.status_code in (200, 201, 204), f"promote bob -> {r.status_code} {r.text}"

    def test_patch_title_and_perms(self, tokens, me_ids, fresh_group):
        body = {"title": "Moderator", "permissions": {"can_pin": True}}
        r = requests.patch(
            f"{BASE_URL}/api/groups/{fresh_group}/admins/{me_ids['bob']}",
            json=body, headers=_hdr(tokens["alice"]), timeout=10,
        )
        assert r.status_code == 200, f"patch role -> {r.status_code} {r.text}"
        data = r.json()
        # Validate returned title + permissions reflect the change
        # The endpoint returns updated conv or admin row — check title in members listing
        m = requests.get(f"{BASE_URL}/api/groups/{fresh_group}/members", headers=_hdr(tokens["alice"]), timeout=10)
        assert m.status_code == 200
        members = m.json().get("participants") or m.json().get("members") or m.json()
        if isinstance(members, dict):
            members = members.get("members") or members.get("participants") or []
        bob_row = next((x for x in members if x.get("id") == me_ids["bob"] or x.get("username") == "bob"), None)
        assert bob_row is not None, f"bob not in members: {members}"
        assert bob_row.get("admin_title") == "Moderator", f"admin_title not Moderator: {bob_row}"
        perms = bob_row.get("admin_permissions") or {}
        assert perms.get("can_pin") is True
        # Other perms either absent (falsy) or False
        for k in ("can_ban", "can_promote", "can_invite", "can_edit_info", "can_delete_messages"):
            assert not perms.get(k), f"perm {k} should be False for moderator: {perms}"

    def test_title_truncates_to_max(self, tokens, me_ids, fresh_group):
        long = "X" * 80
        r = requests.patch(
            f"{BASE_URL}/api/groups/{fresh_group}/admins/{me_ids['bob']}",
            json={"title": long}, headers=_hdr(tokens["alice"]), timeout=10,
        )
        assert r.status_code == 200
        m = requests.get(f"{BASE_URL}/api/groups/{fresh_group}/members", headers=_hdr(tokens["alice"]), timeout=10)
        members = m.json().get("participants") or m.json().get("members") or []
        bob_row = next((x for x in members if x.get("username") == "bob"), None)
        assert bob_row and len(bob_row.get("admin_title") or "") <= 16
        # Restore Moderator title
        requests.patch(
            f"{BASE_URL}/api/groups/{fresh_group}/admins/{me_ids['bob']}",
            json={"title": "Moderator", "permissions": {"can_pin": True}}, headers=_hdr(tokens["alice"]), timeout=10,
        )

    def test_non_owner_cannot_patch(self, tokens, me_ids, fresh_group):
        # bob (admin but not owner with only can_pin) cannot PATCH another admin's role (requires can_promote)
        # First promote charlie too so we have a target
        requests.post(
            f"{BASE_URL}/api/groups/{fresh_group}/admins/{me_ids['charlie']}",
            headers=_hdr(tokens["alice"]), timeout=10,
        )
        r = requests.patch(
            f"{BASE_URL}/api/groups/{fresh_group}/admins/{me_ids['charlie']}",
            json={"title": "Hacker"}, headers=_hdr(tokens["bob"]), timeout=10,
        )
        assert r.status_code == 403, f"bob (no can_promote) should be 403, got {r.status_code}"


class TestPermissionEnforcement:
    """bob has only can_pin=True → cannot ban / invite / edit info / promote / delete others' msgs."""

    def test_bob_cannot_invite(self, tokens, me_ids, fresh_group):
        # Try to add someone (re-add bob, harmless target — backend should reject due to can_invite=false)
        # Actually use a fresh dummy: we'll use charlie's id (already member); endpoint should still 403 first
        r = requests.post(
            f"{BASE_URL}/api/groups/{fresh_group}/members",
            json={"user_ids": [me_ids["alice"]]},  # alice is owner already, but perm check happens first
            headers=_hdr(tokens["bob"]), timeout=10,
        )
        assert r.status_code == 403, f"bob invite -> {r.status_code} {r.text}"

    def test_bob_cannot_edit_info(self, tokens, fresh_group):
        r = requests.patch(
            f"{BASE_URL}/api/groups/{fresh_group}",
            json={"title": "HackedTitle"}, headers=_hdr(tokens["bob"]), timeout=10,
        )
        assert r.status_code == 403

    def test_bob_cannot_promote(self, tokens, me_ids, fresh_group):
        # demote charlie — bob lacks can_promote
        r = requests.delete(
            f"{BASE_URL}/api/groups/{fresh_group}/admins/{me_ids['charlie']}",
            headers=_hdr(tokens["bob"]), timeout=10,
        )
        assert r.status_code == 403

    def test_alice_owner_can_edit(self, tokens, fresh_group):
        r = requests.patch(
            f"{BASE_URL}/api/groups/{fresh_group}",
            json={"title": f"TEST_Phase9D_renamed_{int(time.time())}"},
            headers=_hdr(tokens["alice"]), timeout=10,
        )
        assert r.status_code == 200


class TestBackwardCompat:
    """Group with no admin_permissions entry — admins should inherit ALL perms."""

    @pytest.fixture(scope="class")
    def legacy_group(self, tokens, me_ids):
        body = {"title": f"TEST_Legacy_{int(time.time())}", "participant_ids": [me_ids["bob"]]}
        r = requests.post(f"{BASE_URL}/api/groups", json=body, headers=_hdr(tokens["alice"]), timeout=15)
        assert r.status_code in (200, 201)
        gid = r.json()["id"]
        # Promote bob, but do NOT patch any permissions/title
        requests.post(f"{BASE_URL}/api/groups/{gid}/admins/{me_ids['bob']}", headers=_hdr(tokens["alice"]), timeout=10)
        return gid

    def test_legacy_admin_can_edit_info(self, tokens, legacy_group):
        r = requests.patch(
            f"{BASE_URL}/api/groups/{legacy_group}",
            json={"title": f"TEST_Legacy_edited_{int(time.time())}"},
            headers=_hdr(tokens["bob"]), timeout=10,
        )
        assert r.status_code == 200, f"legacy admin edit -> {r.status_code} {r.text}"

    def test_legacy_admin_can_invite(self, tokens, me_ids, legacy_group):
        r = requests.post(
            f"{BASE_URL}/api/groups/{legacy_group}/members",
            json={"user_ids": [me_ids["charlie"]]},
            headers=_hdr(tokens["bob"]), timeout=10,
        )
        assert r.status_code in (200, 201), f"legacy admin invite -> {r.status_code} {r.text}"


class TestNewGroupEmptyParticipants:
    """NewGroupDialog single-step refactor — backend must accept empty participant_ids."""

    def test_create_group_with_empty_participants(self, tokens):
        body = {"title": f"TEST_Empty_{int(time.time())}", "participant_ids": []}
        r = requests.post(f"{BASE_URL}/api/groups", json=body, headers=_hdr(tokens["alice"]), timeout=15)
        assert r.status_code in (200, 201), f"empty group -> {r.status_code} {r.text}"
        data = r.json()
        assert data.get("title", "").startswith("TEST_Empty_")
        # Verify it appears in alice's conversations
        c = requests.get(f"{BASE_URL}/api/conversations", headers=_hdr(tokens["alice"]), timeout=10)
        assert c.status_code == 200
        ids = [x["id"] for x in c.json()]
        assert data["id"] in ids
