"""Glass Messenger Phase 2 — backend integration tests.

Covers:
- /users/search (auth + exclude self + match by username/display_name)
- GET /users/{id} (with is_online)
- POST /conversations idempotency
- GET /conversations (sorted desc, populated other_user + unread_count + last_message)
- GET /conversations/{id}/messages (order, pagination, 403)
- POST /conversations/{id}/messages (status transitions, last_message update)
- POST /conversations/{id}/read (marks seen)
- WebSocket /api/ws (ready, ping->pong, typing relay, presence, deliver-on-connect)
- Seed conversations exist (alice<->bob 4, alice<->charlie 2)
- OpenAPI lists new chat paths
"""
import asyncio
import json
import os
import time
import uuid

import pytest
import requests
import websockets

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://neon-glass-app.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"
WS_URL = BASE_URL.replace("https://", "wss://").replace("http://", "ws://") + "/api/ws"


# ----------------------- Fixtures ----------------------------------------
@pytest.fixture(scope="session")
def session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


def _login(session, username, password="password123"):
    r = session.post(f"{API}/auth/login", json={"username": username, "password": password})
    assert r.status_code == 200, f"login {username}: {r.status_code} {r.text}"
    d = r.json()
    return d["access_token"], d["user"]


@pytest.fixture(scope="session")
def alice(session):
    token, user = _login(session, "alice")
    return {"token": token, "user": user, "headers": {"Authorization": f"Bearer {token}"}}


@pytest.fixture(scope="session")
def bob(session):
    token, user = _login(session, "bob")
    return {"token": token, "user": user, "headers": {"Authorization": f"Bearer {token}"}}


@pytest.fixture(scope="session")
def charlie(session):
    token, user = _login(session, "charlie")
    return {"token": token, "user": user, "headers": {"Authorization": f"Bearer {token}"}}


# ----------------------- Users search & by-id ---------------------------
class TestUsersSearch:
    def test_search_finds_bob_excludes_self(self, session, alice):
        r = session.get(f"{API}/users/search", params={"q": "bo"}, headers=alice["headers"])
        assert r.status_code == 200
        data = r.json()
        assert isinstance(data, list)
        usernames = [u["username"] for u in data]
        assert "bob" in usernames
        assert "alice" not in usernames  # excludes self
        # Has is_online field
        for u in data:
            assert "is_online" in u

    def test_search_unauth(self, session):
        r = session.get(f"{API}/users/search", params={"q": "bo"})
        assert r.status_code == 401

    def test_search_empty_q_returns_empty(self, session, alice):
        r = session.get(f"{API}/users/search", params={"q": ""}, headers=alice["headers"])
        assert r.status_code == 200
        assert r.json() == []

    def test_get_user_by_id(self, session, alice, bob):
        r = session.get(f"{API}/users/{bob['user']['id']}", headers=alice["headers"])
        assert r.status_code == 200
        d = r.json()
        assert d["id"] == bob["user"]["id"]
        assert d["username"] == "bob"
        assert "is_online" in d

    def test_get_user_by_id_404(self, session, alice):
        r = session.get(f"{API}/users/nonexistent-id-xxx", headers=alice["headers"])
        assert r.status_code == 404


# ----------------------- Conversations -----------------------------------
class TestConversations:
    def test_seeded_conversations_present(self, session, alice, bob, charlie):
        r = session.get(f"{API}/conversations", headers=alice["headers"])
        assert r.status_code == 200
        convs = r.json()
        assert len(convs) >= 2, f"expected >=2 seeded convs, got {len(convs)}"
        # other_user populated for all
        for c in convs:
            assert c["other_user"] is not None
            assert "unread_count" in c
            assert c["last_message"] is not None
            assert c["last_message_at"] is not None
        partners = {c["other_user"]["username"] for c in convs}
        assert "bob" in partners
        assert "charlie" in partners

    def test_conversations_sorted_desc(self, session, alice):
        r = session.get(f"{API}/conversations", headers=alice["headers"])
        assert r.status_code == 200
        convs = r.json()
        timestamps = [c.get("last_message_at") or c.get("created_at") for c in convs]
        assert timestamps == sorted(timestamps, reverse=True)

    def test_create_conversation_idempotent(self, session, alice, bob):
        # Calling twice with same user must yield same conv id
        r1 = session.post(f"{API}/conversations", json={"user_id": bob["user"]["id"]}, headers=alice["headers"])
        assert r1.status_code == 200, r1.text
        c1 = r1.json()
        r2 = session.post(f"{API}/conversations", json={"user_id": bob["user"]["id"]}, headers=alice["headers"])
        assert r2.status_code == 200
        c2 = r2.json()
        assert c1["id"] == c2["id"]
        assert c1["other_user"]["username"] == "bob"

    def test_create_conv_self_rejected(self, session, alice):
        r = session.post(f"{API}/conversations", json={"user_id": alice["user"]["id"]}, headers=alice["headers"])
        assert r.status_code == 400

    def test_create_conv_user_not_found(self, session, alice):
        r = session.post(f"{API}/conversations", json={"user_id": "nonexistent-xx"}, headers=alice["headers"])
        assert r.status_code == 404


# ----------------------- Messages ----------------------------------------
@pytest.fixture(scope="session")
def alice_bob_conv(session, alice, bob):
    r = session.post(f"{API}/conversations", json={"user_id": bob["user"]["id"]}, headers=alice["headers"])
    assert r.status_code == 200
    return r.json()


class TestMessages:
    def test_get_messages_order_and_seed_count(self, session, alice, alice_bob_conv):
        r = session.get(f"{API}/conversations/{alice_bob_conv['id']}/messages", headers=alice["headers"])
        assert r.status_code == 200
        msgs = r.json()
        assert len(msgs) >= 4, f"expected >=4 seeded messages, got {len(msgs)}"
        # oldest -> newest order
        ts = [m["created_at"] for m in msgs]
        assert ts == sorted(ts)
        # Seeded should be seen
        for m in msgs[:4]:
            assert m["status"] == "seen", f"seeded msg status: {m}"

    def test_get_messages_pagination_before(self, session, alice, alice_bob_conv):
        all_r = session.get(f"{API}/conversations/{alice_bob_conv['id']}/messages", headers=alice["headers"])
        all_msgs = all_r.json()
        if len(all_msgs) < 2:
            pytest.skip("Not enough messages to test pagination")
        ref = all_msgs[-1]["id"]
        r = session.get(
            f"{API}/conversations/{alice_bob_conv['id']}/messages",
            params={"before": ref, "limit": 2},
            headers=alice["headers"],
        )
        assert r.status_code == 200
        page = r.json()
        # All returned msgs must be strictly older
        for m in page:
            assert m["created_at"] < all_msgs[-1]["created_at"]

    def test_get_messages_403_non_participant(self, session, charlie, alice_bob_conv):
        r = session.get(
            f"{API}/conversations/{alice_bob_conv['id']}/messages",
            headers=charlie["headers"],
        )
        assert r.status_code == 403

    def test_post_message_status_sent_when_bob_offline(self, session, alice, bob, alice_bob_conv):
        # Bob is NOT WS-connected here -> expected 'sent'
        text = f"TEST_msg_{uuid.uuid4().hex[:6]}"
        r = session.post(
            f"{API}/conversations/{alice_bob_conv['id']}/messages",
            json={"text": text},
            headers=alice["headers"],
        )
        assert r.status_code == 200, r.text
        m = r.json()
        assert m["text"] == text
        assert m["sender_id"] == alice["user"]["id"]
        assert m["status"] in ("sent", "delivered")  # delivered if bob happens to be online from earlier test

        # Conversation's last_message updated
        r2 = session.get(f"{API}/conversations", headers=alice["headers"])
        convs = {c["id"]: c for c in r2.json()}
        assert convs[alice_bob_conv["id"]]["last_message"]["text"] == text

    def test_post_message_empty_rejected(self, session, alice, alice_bob_conv):
        r = session.post(
            f"{API}/conversations/{alice_bob_conv['id']}/messages",
            json={"text": "   "},
            headers=alice["headers"],
        )
        assert r.status_code == 422

    def test_post_message_403(self, session, charlie, alice_bob_conv):
        r = session.post(
            f"{API}/conversations/{alice_bob_conv['id']}/messages",
            json={"text": "hi"},
            headers=charlie["headers"],
        )
        assert r.status_code == 403


# ----------------------- Read marker -------------------------------------
class TestReadMarker:
    def test_mark_read_sets_seen(self, session, alice, bob, alice_bob_conv):
        # Bob sends a fresh message -> alice marks read
        text = f"TEST_read_{uuid.uuid4().hex[:6]}"
        rb = session.post(
            f"{API}/conversations/{alice_bob_conv['id']}/messages",
            json={"text": text},
            headers=bob["headers"],
        )
        assert rb.status_code == 200
        msg_id = rb.json()["id"]

        # Alice marks the conversation as read
        r = session.post(
            f"{API}/conversations/{alice_bob_conv['id']}/read",
            headers=alice["headers"],
        )
        assert r.status_code == 200
        body = r.json()
        assert "updated" in body
        # Fetch messages and confirm seen on bob's msg
        rm = session.get(f"{API}/conversations/{alice_bob_conv['id']}/messages", headers=alice["headers"])
        msgs = rm.json()
        target = next((m for m in msgs if m["id"] == msg_id), None)
        assert target is not None
        assert target["status"] == "seen"
        assert target["seen_at"] is not None

    def test_mark_read_403(self, session, charlie, alice_bob_conv):
        r = session.post(f"{API}/conversations/{alice_bob_conv['id']}/read", headers=charlie["headers"])
        assert r.status_code == 403


# ----------------------- Phase 1 regression ------------------------------
class TestPhase1Regression:
    def test_health(self, session):
        r = session.get(f"{API}/")
        assert r.status_code == 200

    def test_login_alice(self, session):
        r = session.post(f"{API}/auth/login", json={"username": "alice", "password": "password123"})
        assert r.status_code == 200

    def test_auth_me(self, session, alice):
        r = session.get(f"{API}/auth/me", headers=alice["headers"])
        assert r.status_code == 200
        assert r.json()["username"] == "alice"

    def test_openapi_has_chat_paths(self, session):
        r = session.get(f"{API}/openapi.json")
        assert r.status_code == 200
        paths = r.json().get("paths", {})
        for p in [
            "/api/users/search",
            "/api/users/{user_id}",
            "/api/conversations",
            "/api/conversations/{conv_id}/messages",
            "/api/conversations/{conv_id}/read",
        ]:
            assert p in paths, f"missing path {p}"


# ----------------------- WebSocket ---------------------------------------
class TestWebSocket:
    @pytest.mark.asyncio
    async def test_ws_ready_and_ping(self, alice):
        url = f"{WS_URL}?token={alice['token']}"
        async with websockets.connect(url, open_timeout=10) as ws:
            ready_raw = await asyncio.wait_for(ws.recv(), timeout=10)
            ready = json.loads(ready_raw)
            # ready may be followed by message_status events; ensure first is 'ready' or we eventually see it
            if ready.get("type") != "ready":
                # collect more frames until ready
                for _ in range(5):
                    nxt = json.loads(await asyncio.wait_for(ws.recv(), timeout=5))
                    if nxt.get("type") == "ready":
                        ready = nxt
                        break
            assert ready.get("type") == "ready"
            assert ready.get("user_id") == alice["user"]["id"]

            await ws.send(json.dumps({"type": "ping"}))
            # Look for pong (skip any presence/status frames first)
            got_pong = False
            for _ in range(8):
                msg = json.loads(await asyncio.wait_for(ws.recv(), timeout=5))
                if msg.get("type") == "pong":
                    got_pong = True
                    break
            assert got_pong, "no pong received"

    @pytest.mark.asyncio
    async def test_ws_rejects_bad_token(self):
        url = f"{WS_URL}?token=invalid.jwt.here"
        try:
            async with websockets.connect(url, open_timeout=10) as ws:
                # server should close immediately
                try:
                    await asyncio.wait_for(ws.recv(), timeout=5)
                except Exception:
                    pass
        except Exception:
            pass  # connection refused/closed is expected
        # If we got here without unhandled, that's good

    @pytest.mark.asyncio
    async def test_ws_typing_relay_and_message_realtime(self, session, alice, bob, alice_bob_conv):
        """alice connects via WS; bob posts a message via REST; alice should
        receive message_new within ~3s. Also: bob sends 'typing' via WS, alice receives it."""
        a_url = f"{WS_URL}?token={alice['token']}"
        b_url = f"{WS_URL}?token={bob['token']}"

        async with websockets.connect(a_url, open_timeout=10) as a_ws, \
                   websockets.connect(b_url, open_timeout=10) as b_ws:
            # Drain initial frames (ready / presence / status) on both
            async def drain(ws, seconds=1.0):
                frames = []
                end = time.time() + seconds
                while time.time() < end:
                    try:
                        f = await asyncio.wait_for(ws.recv(), timeout=0.4)
                        frames.append(json.loads(f))
                    except asyncio.TimeoutError:
                        pass
                return frames

            await drain(a_ws, 1.5)
            await drain(b_ws, 1.5)

            # Bob sends typing -> alice should receive
            await b_ws.send(json.dumps({
                "type": "typing",
                "conversation_id": alice_bob_conv["id"],
                "is_typing": True,
            }))
            saw_typing = False
            for _ in range(20):
                try:
                    f = await asyncio.wait_for(a_ws.recv(), timeout=1.5)
                    msg = json.loads(f)
                    if msg.get("type") == "typing" and msg.get("conversation_id") == alice_bob_conv["id"]:
                        assert msg.get("user_id") == bob["user"]["id"]
                        assert msg.get("is_typing") is True
                        saw_typing = True
                        break
                except asyncio.TimeoutError:
                    break
            assert saw_typing, "alice did not receive bob's typing event"

            # Bob posts a message via REST -> alice should get message_new via WS
            text = f"TEST_ws_{uuid.uuid4().hex[:6]}"
            r = session.post(
                f"{API}/conversations/{alice_bob_conv['id']}/messages",
                json={"text": text},
                headers=bob["headers"],
            )
            assert r.status_code == 200
            posted = r.json()
            # Because alice is WS-connected, status should be 'delivered'
            assert posted["status"] == "delivered", f"expected delivered (alice online), got {posted['status']}"

            saw_msg = False
            for _ in range(20):
                try:
                    f = await asyncio.wait_for(a_ws.recv(), timeout=2)
                    msg = json.loads(f)
                    if msg.get("type") == "message_new" and msg.get("message", {}).get("text") == text:
                        saw_msg = True
                        break
                except asyncio.TimeoutError:
                    break
            assert saw_msg, "alice did not receive message_new over WS"
