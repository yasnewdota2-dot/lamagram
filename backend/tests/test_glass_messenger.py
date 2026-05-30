"""Glass Messenger Phase 1 — backend integration tests.

Covers: health, signup, login, /auth/me, logout, PATCH /users/me,
avatar upload + static serving, openapi reachability, and seed users.
"""
import io
import os
import time
import uuid

import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://neon-glass-app.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"


@pytest.fixture(scope="session")
def session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


def _unique_username(prefix="test"):
    # 3-20 lowercase letters/numbers/underscores
    return f"{prefix}_{uuid.uuid4().hex[:8]}"


@pytest.fixture(scope="session")
def new_user(session):
    """Create a fresh user via signup once and reuse across tests."""
    username = _unique_username("u")
    payload = {"username": username, "password": "secret123", "display_name": "Test User"}
    r = session.post(f"{API}/auth/signup", json=payload)
    assert r.status_code == 200, f"signup failed: {r.status_code} {r.text}"
    data = r.json()
    assert data["user"]["username"] == username
    assert isinstance(data["access_token"], str) and len(data["access_token"]) > 10
    return {"username": username, "password": "secret123", "token": data["access_token"], "user": data["user"]}


# ----------------------- Health ------------------------------------------
class TestHealth:
    def test_root(self, session):
        r = session.get(f"{API}/")
        assert r.status_code == 200
        d = r.json()
        assert d.get("status") == "ok"

    def test_openapi(self, session):
        r = session.get(f"{API}/openapi.json")
        assert r.status_code == 200
        d = r.json()
        assert "paths" in d
        assert "/api/auth/login" in d["paths"]


# ----------------------- Signup ------------------------------------------
class TestSignup:
    def test_signup_success(self, new_user):
        assert new_user["token"]
        assert new_user["user"]["display_name"] == "Test User"
        assert new_user["user"]["bio"] == ""
        assert new_user["user"]["avatar_url"] is None
        assert "id" in new_user["user"]

    def test_signup_duplicate_returns_409(self, session, new_user):
        r = session.post(f"{API}/auth/signup", json={
            "username": new_user["username"],
            "password": "anothersecret",
            "display_name": "Duplicate",
        })
        assert r.status_code == 409

    # Note: validator lowercases input before regex check, so "BadCaps" is normalized to "badcaps" and accepted.
    @pytest.mark.parametrize("username", ["ab", "with space", "has-dash", "x" * 21])
    def test_signup_invalid_username(self, session, username):
        r = session.post(f"{API}/auth/signup", json={
            "username": username, "password": "secret123", "display_name": "X",
        })
        assert r.status_code == 422, f"expected 422 for username={username!r}, got {r.status_code}"

    def test_signup_short_password(self, session):
        r = session.post(f"{API}/auth/signup", json={
            "username": _unique_username("p"), "password": "abc", "display_name": "X",
        })
        assert r.status_code == 422


# ----------------------- Login -------------------------------------------
class TestLogin:
    def test_login_success(self, session, new_user):
        r = session.post(f"{API}/auth/login", json={
            "username": new_user["username"], "password": new_user["password"],
        })
        assert r.status_code == 200
        d = r.json()
        assert d["user"]["username"] == new_user["username"]
        assert isinstance(d["access_token"], str)

    def test_login_wrong_password(self, session, new_user):
        r = session.post(f"{API}/auth/login", json={
            "username": new_user["username"], "password": "wrongpass",
        })
        assert r.status_code == 401

    def test_login_unknown_user(self, session):
        r = session.post(f"{API}/auth/login", json={
            "username": "nonexistent_zzz_user", "password": "whatever",
        })
        assert r.status_code == 401

    @pytest.mark.parametrize("uname", ["alice", "bob", "charlie"])
    def test_seed_users_login(self, session, uname):
        r = session.post(f"{API}/auth/login", json={"username": uname, "password": "password123"})
        assert r.status_code == 200, f"seed user {uname} login failed: {r.text}"
        assert r.json()["user"]["username"] == uname


# ----------------------- /auth/me & logout -------------------------------
class TestMeLogout:
    def test_me_with_token(self, session, new_user):
        r = session.get(f"{API}/auth/me", headers={"Authorization": f"Bearer {new_user['token']}"})
        assert r.status_code == 200
        assert r.json()["username"] == new_user["username"]

    def test_me_without_token(self, session):
        # Use a bare requests call so the session Bearer (if any) isn't sent
        r = requests.get(f"{API}/auth/me")
        assert r.status_code == 401

    def test_me_invalid_token(self, session):
        r = requests.get(f"{API}/auth/me", headers={"Authorization": "Bearer not-a-real-token"})
        assert r.status_code == 401

    def test_logout(self, session, new_user):
        r = session.post(f"{API}/auth/logout", headers={"Authorization": f"Bearer {new_user['token']}"})
        assert r.status_code == 200
        assert r.json().get("success") is True


# ----------------------- PATCH /users/me ---------------------------------
class TestUpdateProfile:
    def test_update_and_persist(self, session, new_user):
        headers = {"Authorization": f"Bearer {new_user['token']}"}
        new_display = "Updated Name"
        new_bio = "I love glass UI"
        r = session.patch(f"{API}/users/me", json={"display_name": new_display, "bio": new_bio}, headers=headers)
        assert r.status_code == 200
        d = r.json()
        assert d["display_name"] == new_display
        assert d["bio"] == new_bio

        # Verify persistence via /auth/me
        r2 = session.get(f"{API}/auth/me", headers=headers)
        assert r2.status_code == 200
        assert r2.json()["display_name"] == new_display
        assert r2.json()["bio"] == new_bio

    def test_update_requires_auth(self, session):
        r = requests.patch(f"{API}/users/me", json={"display_name": "x"})
        assert r.status_code == 401


# ----------------------- Avatar upload + static serving ------------------
PNG_1x1 = bytes.fromhex(
    "89504E470D0A1A0A0000000D49484452000000010000000108060000001F15C4"
    "890000000A49444154789C6300010000000500010D0A2DB40000000049454E44AE426082"
)


class TestAvatar:
    def test_upload_avatar_and_fetch(self, new_user):
        headers = {"Authorization": f"Bearer {new_user['token']}"}
        files = {"file": ("avatar.png", io.BytesIO(PNG_1x1), "image/png")}
        r = requests.post(f"{API}/users/me/avatar", headers=headers, files=files)
        assert r.status_code == 200, r.text
        avatar_url = r.json()["avatar_url"]
        assert avatar_url.startswith("/api/uploads/avatars/")

        # Fetch the static file
        full = f"{BASE_URL}{avatar_url}"
        r2 = requests.get(full)
        assert r2.status_code == 200
        assert r2.content[:8] == PNG_1x1[:8]  # PNG signature
        assert len(r2.content) == len(PNG_1x1)

        # Persisted via /auth/me
        r3 = requests.get(f"{API}/auth/me", headers=headers)
        assert r3.status_code == 200
        assert r3.json()["avatar_url"] == avatar_url

    def test_upload_rejects_non_image(self, new_user):
        headers = {"Authorization": f"Bearer {new_user['token']}"}
        files = {"file": ("note.txt", io.BytesIO(b"hello"), "text/plain")}
        r = requests.post(f"{API}/users/me/avatar", headers=headers, files=files)
        assert r.status_code == 400

    def test_upload_requires_auth(self):
        files = {"file": ("a.png", io.BytesIO(PNG_1x1), "image/png")}
        r = requests.post(f"{API}/users/me/avatar", files=files)
        assert r.status_code == 401
