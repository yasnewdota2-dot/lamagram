"""Glass Messenger Phase 4 — Saved Messages + Username-first search.

Covers:
- POST /api/conversations/saved is idempotent; kind='saved'; participants=[me]
- GET /api/conversations returns saved first (pinned ordering)
- Text messages in saved conversation persist (GET .../messages)
- GET /api/users/by-username/{username} returns profile (404 if missing)
- GET /api/users/search?q=@al returns username prefix matches
"""
import os
import uuid

import pytest
import requests

BASE_URL = os.environ.get(
    "REACT_APP_BACKEND_URL", "https://neon-glass-app.preview.emergentagent.com"
).rstrip("/")
API = f"{BASE_URL}/api"


def _login(s, u, p="password123"):
    r = s.post(f"{API}/auth/login", json={"username": u, "password": p})
    assert r.status_code == 200, r.text
    d = r.json()
    return d["access_token"], d["user"]


@pytest.fixture(scope="session")
def session():
    return requests.Session()


@pytest.fixture(scope="session")
def alice(session):
    tok, user = _login(session, "alice")
    return {"token": tok, "user": user, "headers": {"Authorization": f"Bearer {tok}"}}


@pytest.fixture(scope="session")
def bob(session):
    tok, user = _login(session, "bob")
    return {"token": tok, "user": user, "headers": {"Authorization": f"Bearer {tok}"}}


# -- Saved conversation ----------------------------------------------------
class TestSavedConversation:
    def test_create_saved_idempotent(self, session, alice):
        r1 = session.post(f"{API}/conversations/saved", headers=alice["headers"])
        assert r1.status_code == 200, r1.text
        c1 = r1.json()
        assert c1.get("kind") == "saved"
        # participants list should contain only me
        parts = c1.get("participants") or []
        # public_conversation may return ids or user dicts; check either way
        if parts and isinstance(parts[0], dict):
            ids = [p.get("id") for p in parts]
        else:
            ids = parts
        assert ids == [alice["user"]["id"]], f"participants={parts}"

        # second call returns same id
        r2 = session.post(f"{API}/conversations/saved", headers=alice["headers"])
        assert r2.status_code == 200
        c2 = r2.json()
        assert c2["id"] == c1["id"], "Saved conversation must be idempotent"
        assert c2["kind"] == "saved"

    def test_saved_pinned_first_in_list(self, session, alice):
        # Ensure saved exists
        sr = session.post(f"{API}/conversations/saved", headers=alice["headers"])
        saved_id = sr.json()["id"]

        r = session.get(f"{API}/conversations", headers=alice["headers"])
        assert r.status_code == 200
        convs = r.json()
        assert len(convs) > 0
        assert convs[0]["id"] == saved_id, (
            f"Saved must be first; got order={[c.get('kind') for c in convs[:3]]}"
        )
        assert convs[0]["kind"] == "saved"

    def test_send_text_in_saved_persists(self, session, alice):
        sr = session.post(f"{API}/conversations/saved", headers=alice["headers"])
        saved_id = sr.json()["id"]
        text = f"TEST_saved_{uuid.uuid4().hex[:8]}"
        post = session.post(
            f"{API}/conversations/{saved_id}/messages",
            json={"text": text},
            headers={**alice["headers"], "Content-Type": "application/json"},
        )
        assert post.status_code == 200, post.text
        msg = post.json()
        assert msg["text"] == text
        assert msg["sender_id"] == alice["user"]["id"]

        # Reload via GET messages — must include it
        g = session.get(
            f"{API}/conversations/{saved_id}/messages", headers=alice["headers"]
        )
        assert g.status_code == 200
        texts = [m["text"] for m in g.json() if m.get("text")]
        assert text in texts

    def test_saved_only_has_self(self, session, alice, bob):
        # bob's saved must not contain alice and vice-versa
        ra = session.post(f"{API}/conversations/saved", headers=alice["headers"])
        rb = session.post(f"{API}/conversations/saved", headers=bob["headers"])
        assert ra.json()["id"] != rb.json()["id"]


# -- Username-first search -------------------------------------------------
class TestUsernameSearch:
    def test_by_username_found(self, session, alice):
        r = session.get(f"{API}/users/by-username/bob", headers=alice["headers"])
        assert r.status_code == 200, r.text
        u = r.json()
        assert u["username"] == "bob"
        assert "id" in u

    def test_by_username_not_found_404(self, session, alice):
        r = session.get(
            f"{API}/users/by-username/nope_xyz_{uuid.uuid4().hex[:6]}",
            headers=alice["headers"],
        )
        assert r.status_code == 404

    def test_by_username_case_insensitive(self, session, alice):
        # username is stored lowercase; lookup should normalize input
        r = session.get(f"{API}/users/by-username/BOB", headers=alice["headers"])
        assert r.status_code == 200
        assert r.json()["username"] == "bob"

    def test_search_at_prefix_returns_username_matches(self, session, alice):
        r = session.get(
            f"{API}/users/search", params={"q": "@al"}, headers=alice["headers"]
        )
        assert r.status_code == 200, r.text
        results = r.json()
        # alice should be excluded (self) — so '@al' on alice gives [] unless others match
        usernames = [u["username"] for u in results]
        for un in usernames:
            assert un.startswith("al"), f"Expected username prefix 'al', got {un}"
        # Now from bob's account, searching '@al' should include alice
        tok, _ = _login(session, "bob")
        r2 = session.get(
            f"{API}/users/search",
            params={"q": "@al"},
            headers={"Authorization": f"Bearer {tok}"},
        )
        assert r2.status_code == 200
        unames = [u["username"] for u in r2.json()]
        assert "alice" in unames, f"Expected alice in '@al' results from bob; got {unames}"

    def test_search_at_prefix_bob(self, session, alice):
        r = session.get(
            f"{API}/users/search", params={"q": "@bo"}, headers=alice["headers"]
        )
        assert r.status_code == 200
        unames = [u["username"] for u in r.json()]
        assert "bob" in unames

    def test_search_empty_at_returns_empty(self, session, alice):
        r = session.get(f"{API}/users/search", params={"q": "@"}, headers=alice["headers"])
        assert r.status_code == 200
        assert r.json() == []
