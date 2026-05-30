"""
Glass Messenger Phase 5B backend tests:
Reply / Forward / Edit / Delete (me|all) / Pin / Mute
+ WS message_edited, message_deleted, conversation_updated
"""
import os
import json
import asyncio
import pytest
import requests
import websockets
from urllib.parse import urlparse

def _load_backend_url():
    url = os.environ.get("REACT_APP_BACKEND_URL", "").strip()
    if not url:
        try:
            with open("/app/frontend/.env") as f:
                for line in f:
                    if line.startswith("REACT_APP_BACKEND_URL="):
                        url = line.split("=", 1)[1].strip().strip('"')
                        break
        except Exception:
            pass
    return url.rstrip("/")

BASE_URL = _load_backend_url()
assert BASE_URL, "REACT_APP_BACKEND_URL must be set"
API = f"{BASE_URL}/api"


# ---------- helpers ----------
def login(username, password="password123"):
    r = requests.post(f"{API}/auth/login", json={"username": username, "password": password})
    assert r.status_code == 200, f"login {username} failed: {r.status_code} {r.text}"
    j = r.json()
    return j.get("access_token") or j.get("token")


def auth(token):
    return {"Authorization": f"Bearer {token}"}


def get_me(token):
    r = requests.get(f"{API}/auth/me", headers=auth(token))
    assert r.status_code == 200, r.text
    return r.json()


def open_dm(token, peer_id):
    r = requests.post(f"{API}/conversations", json={"user_id": peer_id}, headers=auth(token))
    assert r.status_code in (200, 201), r.text
    return r.json()["id"]


def saved_conv_id(token):
    r = requests.get(f"{API}/conversations", headers=auth(token))
    assert r.status_code == 200
    for c in r.json():
        if c["kind"] == "saved":
            return c["id"]
    raise AssertionError("no saved conv")


def send_text(token, conv_id, text, reply_to_message_id=None):
    body = {"type": "text", "text": text}
    if reply_to_message_id:
        body["reply_to_message_id"] = reply_to_message_id
    r = requests.post(f"{API}/conversations/{conv_id}/messages", json=body, headers=auth(token))
    assert r.status_code == 200, r.text
    return r.json()


def get_messages(token, conv_id):
    r = requests.get(f"{API}/conversations/{conv_id}/messages", headers=auth(token))
    assert r.status_code == 200, r.text
    return r.json()


# ---------- fixtures ----------
@pytest.fixture(scope="module")
def tokens():
    return {
        "alice": login("alice"),
        "bob": login("bob"),
        "charlie": login("charlie"),
    }


@pytest.fixture(scope="module")
def users(tokens):
    return {u: get_me(t) for u, t in tokens.items()}


@pytest.fixture(scope="module")
def conv_ids(tokens, users):
    a, b, c = tokens["alice"], tokens["bob"], tokens["charlie"]
    return {
        "alice_bob": open_dm(a, users["bob"]["id"]),
        "alice_charlie": open_dm(a, users["charlie"]["id"]),
        "alice_saved": saved_conv_id(a),
    }


# ====================================================================
# REPLY
# ====================================================================
class TestReply:
    def test_reply_snapshot_in_response_and_get(self, tokens, conv_ids):
        bob_msg = send_text(tokens["bob"], conv_ids["alice_bob"], "TEST_5B_orig from bob")
        reply = send_text(tokens["alice"], conv_ids["alice_bob"], "TEST_5B_reply from alice",
                          reply_to_message_id=bob_msg["id"])
        # response carries snapshot
        assert reply.get("reply_to") is not None, f"reply_to missing: {reply}"
        snap = reply["reply_to"]
        assert snap["message_id"] == bob_msg["id"]
        assert snap["sender_id"] == bob_msg["sender_id"]
        assert snap["type"] == "text"
        assert "text_preview" in snap
        assert "orig from bob" in snap["text_preview"]
        # persisted in GET
        msgs = get_messages(tokens["alice"], conv_ids["alice_bob"])
        found = next((m for m in msgs if m["id"] == reply["id"]), None)
        assert found and found["reply_to"] and found["reply_to"]["message_id"] == bob_msg["id"]

    def test_reply_to_invalid_id_400(self, tokens, conv_ids):
        r = requests.post(
            f"{API}/conversations/{conv_ids['alice_bob']}/messages",
            json={"type": "text", "text": "bad reply", "reply_to_message_id": "does-not-exist"},
            headers=auth(tokens["alice"]),
        )
        assert r.status_code == 400, r.text


# ====================================================================
# EDIT
# ====================================================================
class TestEdit:
    def test_edit_sets_edited_and_edited_at(self, tokens, conv_ids):
        m = send_text(tokens["alice"], conv_ids["alice_bob"], "TEST_5B_edit_me v1")
        r = requests.patch(
            f"{API}/messages/{m['id']}",
            json={"text": "TEST_5B_edit_me v2"},
            headers=auth(tokens["alice"]),
        )
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["edited"] is True
        assert d["edited_at"]
        assert d["text"] == "TEST_5B_edit_me v2"

    def test_non_sender_edit_403(self, tokens, conv_ids):
        m = send_text(tokens["alice"], conv_ids["alice_bob"], "TEST_5B_edit_perm")
        r = requests.patch(
            f"{API}/messages/{m['id']}",
            json={"text": "hijack"},
            headers=auth(tokens["bob"]),
        )
        assert r.status_code == 403, r.text


# ====================================================================
# DELETE
# ====================================================================
class TestDelete:
    def test_delete_for_me(self, tokens, conv_ids):
        m = send_text(tokens["alice"], conv_ids["alice_bob"], "TEST_5B_del_me")
        r = requests.delete(
            f"{API}/messages/{m['id']}?scope=me",
            headers=auth(tokens["alice"]),
        )
        assert r.status_code == 200, r.text
        # alice no longer sees
        a_msgs = get_messages(tokens["alice"], conv_ids["alice_bob"])
        assert all(x["id"] != m["id"] for x in a_msgs), "alice still sees deleted-for-me msg"
        # bob still sees
        b_msgs = get_messages(tokens["bob"], conv_ids["alice_bob"])
        assert any(x["id"] == m["id"] for x in b_msgs), "bob should still see it"

    def test_delete_for_everyone_tombstone(self, tokens, conv_ids):
        m = send_text(tokens["alice"], conv_ids["alice_bob"], "TEST_5B_del_all")
        r = requests.delete(
            f"{API}/messages/{m['id']}?scope=all",
            headers=auth(tokens["alice"]),
        )
        assert r.status_code == 200, r.text
        b_msgs = get_messages(tokens["bob"], conv_ids["alice_bob"])
        tomb = next((x for x in b_msgs if x["id"] == m["id"]), None)
        assert tomb is not None, "bob should see tombstone"
        assert tomb.get("deleted_for_everyone") is True
        assert tomb.get("text") in ("", None)
        assert tomb.get("media") is None

    def test_delete_for_everyone_non_sender_403(self, tokens, conv_ids):
        m = send_text(tokens["alice"], conv_ids["alice_bob"], "TEST_5B_del_perm")
        r = requests.delete(
            f"{API}/messages/{m['id']}?scope=all",
            headers=auth(tokens["bob"]),
        )
        assert r.status_code == 403, r.text


# ====================================================================
# FORWARD
# ====================================================================
class TestForward:
    def test_forward_to_two_convs(self, tokens, conv_ids, users):
        m = send_text(tokens["alice"], conv_ids["alice_bob"], "TEST_5B_fwd_source")
        r = requests.post(
            f"{API}/messages/{m['id']}/forward",
            json={"conversation_ids": [conv_ids["alice_saved"], conv_ids["alice_charlie"]]},
            headers=auth(tokens["alice"]),
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["forwarded"] == 2
        assert len(data["messages"]) == 2
        for fwd in data["messages"]:
            assert fwd["forwarded_from"] is not None
            assert fwd["forwarded_from"]["original_message_id"] == m["id"]
            assert fwd["forwarded_from"]["original_sender_id"] == users["alice"]["id"]
            assert fwd["sender_id"] == users["alice"]["id"]
            assert fwd["text"] == "TEST_5B_fwd_source"

    def test_forward_skips_non_participant(self, tokens, conv_ids):
        # bob tries to forward to alice<->charlie (bob is not participant). Should silently skip.
        m = send_text(tokens["bob"], conv_ids["alice_bob"], "TEST_5B_fwd_skip")
        r = requests.post(
            f"{API}/messages/{m['id']}/forward",
            json={"conversation_ids": [conv_ids["alice_charlie"]]},
            headers=auth(tokens["bob"]),
        )
        assert r.status_code == 200, r.text
        assert r.json()["forwarded"] == 0


# ====================================================================
# PIN
# ====================================================================
class TestPin:
    def test_pin_sets_is_pinned_and_sort(self, tokens, conv_ids):
        # ensure clean start
        requests.delete(f"{API}/conversations/{conv_ids['alice_bob']}/pin", headers=auth(tokens["alice"]))
        r = requests.post(f"{API}/conversations/{conv_ids['alice_bob']}/pin", headers=auth(tokens["alice"]))
        assert r.status_code == 200, r.text
        assert r.json()["is_pinned"] is True
        convs = requests.get(f"{API}/conversations", headers=auth(tokens["alice"])).json()
        # Expect: saved first, then pinned DM (alice_bob), then unpinned
        kinds = [c["kind"] for c in convs]
        assert kinds[0] == "saved", f"saved must be first, got {kinds}"
        # alice_bob (pinned) must come before alice_charlie (unpinned)
        bob_idx = next(i for i, c in enumerate(convs) if c["id"] == conv_ids["alice_bob"])
        char_idx = next(i for i, c in enumerate(convs) if c["id"] == conv_ids["alice_charlie"])
        assert bob_idx < char_idx, f"pinned bob should be before charlie, got {convs}"
        bob_conv = convs[bob_idx]
        assert bob_conv.get("is_pinned") is True
        # cleanup
        requests.delete(f"{API}/conversations/{conv_ids['alice_bob']}/pin", headers=auth(tokens["alice"]))

    def test_pin_cap_5(self, tokens, users):
        # Create 6 DMs by signing up temp users and pin them all - simpler: pin existing + bulk-create via /conversations
        # Use POST /conversations with new ephemeral users via signup
        created_ids = []
        ephemeral = []
        try:
            for i in range(6):
                uname = f"pin5b_{i}_{os.urandom(3).hex()}"
                rs = requests.post(f"{API}/auth/signup", json={
                    "username": uname, "password": "password123", "display_name": uname,
                })
                assert rs.status_code in (200, 201), rs.text
                ephemeral.append(rs.json())
                conv = requests.post(f"{API}/conversations",
                                     json={"user_id": rs.json()["user"]["id"]},
                                     headers=auth(tokens["alice"])).json()
                created_ids.append(conv["id"])
            # Pin first 5 — all should succeed
            for cid in created_ids[:5]:
                r = requests.post(f"{API}/conversations/{cid}/pin", headers=auth(tokens["alice"]))
                assert r.status_code == 200, f"pin should succeed: {r.text}"
            # 6th must 400
            r6 = requests.post(f"{API}/conversations/{created_ids[5]}/pin", headers=auth(tokens["alice"]))
            assert r6.status_code == 400, f"6th pin should 400, got {r6.status_code} {r6.text}"
            assert "5" in r6.text or "pin" in r6.text.lower()
        finally:
            # unpin all
            for cid in created_ids[:5]:
                requests.delete(f"{API}/conversations/{cid}/pin", headers=auth(tokens["alice"]))


# ====================================================================
# MUTE
# ====================================================================
class TestMute:
    def test_mute_sets_is_muted(self, tokens, conv_ids):
        requests.delete(f"{API}/conversations/{conv_ids['alice_bob']}/mute", headers=auth(tokens["alice"]))
        r = requests.post(f"{API}/conversations/{conv_ids['alice_bob']}/mute", headers=auth(tokens["alice"]))
        assert r.status_code == 200, r.text
        assert r.json()["is_muted"] is True
        convs = requests.get(f"{API}/conversations", headers=auth(tokens["alice"])).json()
        bob = next(c for c in convs if c["id"] == conv_ids["alice_bob"])
        assert bob.get("is_muted") is True
        # unmute
        r2 = requests.delete(f"{API}/conversations/{conv_ids['alice_bob']}/mute", headers=auth(tokens["alice"]))
        assert r2.status_code == 200
        convs = requests.get(f"{API}/conversations", headers=auth(tokens["alice"])).json()
        bob = next(c for c in convs if c["id"] == conv_ids["alice_bob"])
        assert bob.get("is_muted") is False


# ====================================================================
# WEBSOCKET EVENTS
# ====================================================================
def ws_url(token):
    p = urlparse(BASE_URL)
    scheme = "wss" if p.scheme == "https" else "ws"
    return f"{scheme}://{p.netloc}/api/ws?token={token}"


async def collect_ws(token, want_types, timeout=8.0):
    """Connect and collect WS frames of given types until timeout."""
    collected = []
    try:
        async with websockets.connect(ws_url(token), open_timeout=10, close_timeout=2) as ws:
            try:
                while True:
                    raw = await asyncio.wait_for(ws.recv(), timeout=timeout)
                    try:
                        evt = json.loads(raw)
                    except Exception:
                        continue
                    if evt.get("type") in want_types:
                        collected.append(evt)
            except asyncio.TimeoutError:
                pass
    except Exception as e:
        print(f"ws err: {e}")
    return collected


class TestWebSocketEvents:
    @pytest.mark.asyncio
    async def test_message_edited_broadcast_to_peer(self, tokens, conv_ids):
        m = send_text(tokens["alice"], conv_ids["alice_bob"], "TEST_5B_ws_edit v1")

        async def edit_after():
            await asyncio.sleep(1.5)
            requests.patch(
                f"{API}/messages/{m['id']}",
                json={"text": "TEST_5B_ws_edit v2"},
                headers=auth(tokens["alice"]),
            )

        collector = asyncio.create_task(collect_ws(tokens["bob"], {"message_edited"}, timeout=5))
        await edit_after()
        events = await collector
        edits = [e for e in events if e.get("message_id") == m["id"]]
        assert edits, f"bob did not receive message_edited; got {events}"
        assert edits[0]["text"] == "TEST_5B_ws_edit v2"

    @pytest.mark.asyncio
    async def test_message_deleted_broadcast(self, tokens, conv_ids):
        m = send_text(tokens["alice"], conv_ids["alice_bob"], "TEST_5B_ws_del")

        async def del_after():
            await asyncio.sleep(1.5)
            requests.delete(f"{API}/messages/{m['id']}?scope=all", headers=auth(tokens["alice"]))

        collector = asyncio.create_task(collect_ws(tokens["bob"], {"message_deleted"}, timeout=5))
        await del_after()
        events = await collector
        dels = [e for e in events if e.get("message_id") == m["id"]]
        assert dels, f"bob did not receive message_deleted; got {events}"
        assert dels[0]["scope"] == "all"

    @pytest.mark.asyncio
    async def test_conversation_updated_pin(self, tokens, conv_ids):
        requests.delete(f"{API}/conversations/{conv_ids['alice_bob']}/pin", headers=auth(tokens["alice"]))

        async def pin_after():
            await asyncio.sleep(1.5)
            requests.post(f"{API}/conversations/{conv_ids['alice_bob']}/pin", headers=auth(tokens["alice"]))

        collector = asyncio.create_task(collect_ws(tokens["alice"], {"conversation_updated"}, timeout=5))
        await pin_after()
        events = await collector
        matches = [e for e in events if e.get("conversation_id") == conv_ids["alice_bob"]]
        assert matches, f"alice did not receive conversation_updated; got {events}"
        assert matches[-1]["is_pinned"] is True
        # cleanup
        requests.delete(f"{API}/conversations/{conv_ids['alice_bob']}/pin", headers=auth(tokens["alice"]))
