"""
Phase 5A — Performance Sweep tests.

Focus:
- GET /api/conversations response shape is unchanged (after N+1 -> batched refactor).
- Saved Messages is pinned first (regression).
- Batched query is correct: each DM has fully populated other_user and unread_count.
- Unread aggregation correctness: count of unseen messages from peer reflects in unread_count.
- Latency sanity: GET /api/conversations completes well under 2s for seeded data.
- Phase 4 regressions: @username search hint endpoint, by-username, copy-username settings field.
"""

import os
import time
import uuid

import pytest
import requests

def _load_backend_url():
    url = os.environ.get("REACT_APP_BACKEND_URL", "").strip()
    if not url:
        # read /app/frontend/.env directly
        try:
            with open("/app/frontend/.env") as f:
                for line in f:
                    if line.startswith("REACT_APP_BACKEND_URL="):
                        url = line.split("=", 1)[1].strip()
                        break
        except Exception:
            pass
    return url.rstrip("/")

BASE_URL = _load_backend_url()
assert BASE_URL, "REACT_APP_BACKEND_URL must be set"


def _login(username: str, password: str = "password123") -> str:
    r = requests.post(
        f"{BASE_URL}/api/auth/login",
        json={"username": username, "password": password},
        timeout=15,
    )
    assert r.status_code == 200, f"login failed for {username}: {r.status_code} {r.text}"
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def alice_token():
    return _login("alice")


@pytest.fixture(scope="module")
def bob_token():
    return _login("bob")


@pytest.fixture(scope="module")
def alice_headers(alice_token):
    return {"Authorization": f"Bearer {alice_token}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def bob_headers(bob_token):
    return {"Authorization": f"Bearer {bob_token}", "Content-Type": "application/json"}


# ---------- Response shape & saved pinning ----------

class TestConversationsShape:
    def test_get_conversations_status(self, alice_headers):
        r = requests.get(f"{BASE_URL}/api/conversations", headers=alice_headers, timeout=15)
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_saved_is_pinned_first(self, alice_headers):
        # ensure saved exists
        requests.post(
            f"{BASE_URL}/api/conversations/saved",
            headers=alice_headers,
            timeout=15,
        )
        r = requests.get(f"{BASE_URL}/api/conversations", headers=alice_headers, timeout=15)
        assert r.status_code == 200
        convs = r.json()
        assert len(convs) >= 1
        assert convs[0]["kind"] == "saved", f"first conv must be saved, got {convs[0]}"

    def test_each_conv_has_required_fields(self, alice_headers):
        r = requests.get(f"{BASE_URL}/api/conversations", headers=alice_headers, timeout=15)
        convs = r.json()
        required = {
            "id", "kind", "participants", "other_user",
            "last_message", "last_message_at", "created_at", "unread_count",
        }
        for c in convs:
            missing = required - set(c.keys())
            assert not missing, f"conv {c.get('id')} missing fields: {missing}"
            # types
            assert isinstance(c["id"], str)
            assert c["kind"] in ("saved", "dm")
            assert isinstance(c["participants"], list)
            assert isinstance(c["unread_count"], int)

    def test_dm_other_user_shape(self, alice_headers):
        r = requests.get(f"{BASE_URL}/api/conversations", headers=alice_headers, timeout=15)
        convs = r.json()
        dms = [c for c in convs if c["kind"] == "dm"]
        assert dms, "expected at least one DM (alice<->bob) in seed"
        sub_required = {"id", "username", "display_name", "avatar_url", "is_online", "last_seen", "bio"}
        for c in dms:
            ou = c["other_user"]
            assert ou is not None, f"DM {c['id']} has no other_user (batched fetch failed?)"
            missing = sub_required - set(ou.keys())
            assert not missing, f"other_user missing fields: {missing}"
            assert isinstance(ou["is_online"], bool)


# ---------- Latency sanity ----------

class TestLatency:
    def test_get_conversations_latency_under_2s(self, alice_headers):
        t0 = time.perf_counter()
        r = requests.get(f"{BASE_URL}/api/conversations", headers=alice_headers, timeout=15)
        dt = time.perf_counter() - t0
        assert r.status_code == 200
        assert dt < 2.0, f"GET /api/conversations took {dt:.3f}s (should be <2s)"

    def test_get_conversations_repeated_calls(self, alice_headers):
        # 5 sequential calls should all be quick — sanity that no N+1 regressed
        durations = []
        for _ in range(5):
            t0 = time.perf_counter()
            r = requests.get(f"{BASE_URL}/api/conversations", headers=alice_headers, timeout=15)
            durations.append(time.perf_counter() - t0)
            assert r.status_code == 200
        avg = sum(durations) / len(durations)
        assert avg < 1.5, f"avg latency {avg:.3f}s too high"


# ---------- Unread aggregation correctness ----------

class TestUnreadAggregation:
    def test_unread_count_increases_after_peer_message(self, alice_headers, bob_headers):
        # Find alice's DM with bob
        r = requests.get(f"{BASE_URL}/api/conversations", headers=alice_headers, timeout=15)
        convs = r.json()
        dm = next((c for c in convs if c["kind"] == "dm" and c["other_user"]["username"] == "bob"), None)
        assert dm is not None, "alice<->bob dm must exist"
        conv_id = dm["id"]

        # mark all as read first from alice side
        requests.post(
            f"{BASE_URL}/api/conversations/{conv_id}/read",
            headers=alice_headers,
            timeout=15,
        )

        # Bob sends a new message
        marker = f"TEST_phase5a_unread_{uuid.uuid4().hex[:8]}"
        sr = requests.post(
            f"{BASE_URL}/api/conversations/{conv_id}/messages",
            headers=bob_headers,
            json={"text": marker},
            timeout=15,
        )
        assert sr.status_code in (200, 201), f"send failed: {sr.status_code} {sr.text}"

        # Alice fetches conversations — unread should be >= 1 for that conv
        r2 = requests.get(f"{BASE_URL}/api/conversations", headers=alice_headers, timeout=15)
        convs2 = r2.json()
        dm2 = next(c for c in convs2 if c["id"] == conv_id)
        assert dm2["unread_count"] >= 1, f"expected unread>=1, got {dm2['unread_count']}"
        # last_message reflects new text
        lm = dm2.get("last_message")
        assert lm is not None and lm.get("text") == marker, f"last_message not updated: {lm}"

        # cleanup: mark as read
        requests.post(
            f"{BASE_URL}/api/conversations/{conv_id}/read",
            headers=alice_headers,
            timeout=15,
        )


# ---------- Saved messages persistence (regression) ----------

class TestSavedMessages:
    def test_send_to_saved_persists(self, alice_headers):
        rs = requests.post(
            f"{BASE_URL}/api/conversations/saved",
            headers=alice_headers,
            timeout=15,
        )
        assert rs.status_code in (200, 201)
        saved_id = rs.json()["id"]

        marker = f"TEST_phase5a_saved_{uuid.uuid4().hex[:8]}"
        sr = requests.post(
            f"{BASE_URL}/api/conversations/{saved_id}/messages",
            headers=alice_headers,
            json={"text": marker},
            timeout=15,
        )
        assert sr.status_code in (200, 201)
        body = sr.json()
        # saved messages should be auto-seen
        assert body.get("status") == "seen", f"saved msg status should be 'seen', got {body.get('status')}"
        assert body.get("seen_at") is not None, "saved msg seen_at should be set"
        assert body.get("text") == marker

        # verify via GET
        gm = requests.get(
            f"{BASE_URL}/api/conversations/{saved_id}/messages",
            headers=alice_headers,
            timeout=15,
        )
        assert gm.status_code == 200
        texts = [m.get("text") for m in gm.json()]
        assert marker in texts


# ---------- Phase 4 regressions ----------

class TestPhase4Regression:
    def test_by_username_lookup(self, alice_headers):
        r = requests.get(f"{BASE_URL}/api/users/by-username/bob", headers=alice_headers, timeout=15)
        assert r.status_code == 200
        assert r.json()["username"] == "bob"

    def test_username_prefix_search(self, alice_headers):
        r = requests.get(f"{BASE_URL}/api/users/search?q=@bo", headers=alice_headers, timeout=15)
        assert r.status_code == 200
        users = r.json()
        assert any(u.get("username") == "bob" for u in users)

    def test_settings_me_has_username(self, alice_headers):
        r = requests.get(f"{BASE_URL}/api/auth/me", headers=alice_headers, timeout=15)
        assert r.status_code == 200
        me = r.json()
        assert me.get("username") == "alice"


# ---------- Concurrent send guard (idempotency-ish: 5 rapid POSTs each create one message) ----------

class TestRapidSends:
    def test_each_post_creates_one_message(self, alice_headers):
        """
        This validates the SERVER does not dedupe — frontend Phase 5A is what guards
        against duplicate POSTs (sendLockRef). On the backend each POST must succeed
        and each creates exactly one record. (Frontend test will assert only 1 POST
        actually leaves the browser on rapid clicks.)
        """
        rs = requests.post(f"{BASE_URL}/api/conversations/saved", headers=alice_headers, timeout=15)
        saved_id = rs.json()["id"]
        marker_base = f"TEST_phase5a_rapid_{uuid.uuid4().hex[:6]}"
        created_ids = []
        for i in range(3):
            r = requests.post(
                f"{BASE_URL}/api/conversations/{saved_id}/messages",
                headers=alice_headers,
                json={"text": f"{marker_base}_{i}"},
                timeout=15,
            )
            assert r.status_code in (200, 201), f"send {i} failed: {r.status_code}"
            created_ids.append(r.json()["id"])
        assert len(set(created_ids)) == 3, "each POST must create a distinct message id"
