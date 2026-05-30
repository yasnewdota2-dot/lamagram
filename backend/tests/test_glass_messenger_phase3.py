"""Glass Messenger Phase 3 — media upload backend tests.

Covers POST /api/messages/upload for image/video/file/voice kinds:
- Image upload extracts width/height (Pillow)
- File served at /api/uploads/media/{yyyy}/{mm}/{uuid}.{ext}
- Voice upload accepts duration_sec + waveform JSON array
- kind/mime mismatch -> 400
- non-participant -> 403, missing conversation -> 404
- last_message updated; WS broadcasts message_new + message_status (delivered)
- /api/openapi.json includes /api/messages/upload
- Phase 1/2 regression: text-message flow still works.
"""
import asyncio
import io
import json
import os
import struct
import time
import uuid
import zlib

import pytest
import requests
import websockets

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://neon-glass-app.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"
WS_URL = BASE_URL.replace("https://", "wss://").replace("http://", "ws://") + "/api/ws"


# -- helpers --------------------------------------------------------------
def _png_bytes(width: int = 32, height: int = 24) -> bytes:
    """Generate a tiny valid PNG (solid colour) without external deps."""
    def chunk(tag: bytes, data: bytes) -> bytes:
        return (struct.pack(">I", len(data)) + tag + data
                + struct.pack(">I", zlib.crc32(tag + data) & 0xffffffff))
    sig = b"\x89PNG\r\n\x1a\n"
    ihdr = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)  # RGB
    raw = b""
    for _ in range(height):
        raw += b"\x00" + (b"\x33\x88\xee" * width)
    idat = zlib.compress(raw)
    return sig + chunk(b"IHDR", ihdr) + chunk(b"IDAT", idat) + chunk(b"IEND", b"")


def _login(s, u, p="password123"):
    r = s.post(f"{API}/auth/login", json={"username": u, "password": p})
    assert r.status_code == 200, r.text
    d = r.json()
    return d["access_token"], d["user"]


# -- fixtures -------------------------------------------------------------
@pytest.fixture(scope="session")
def session():
    s = requests.Session()
    return s


@pytest.fixture(scope="session")
def alice(session):
    tok, user = _login(session, "alice")
    return {"token": tok, "user": user, "headers": {"Authorization": f"Bearer {tok}"}}


@pytest.fixture(scope="session")
def bob(session):
    tok, user = _login(session, "bob")
    return {"token": tok, "user": user, "headers": {"Authorization": f"Bearer {tok}"}}


@pytest.fixture(scope="session")
def charlie(session):
    tok, user = _login(session, "charlie")
    return {"token": tok, "user": user, "headers": {"Authorization": f"Bearer {tok}"}}


@pytest.fixture(scope="session")
def conv_ab(session, alice, bob):
    r = session.post(f"{API}/conversations",
                     json={"user_id": bob["user"]["id"]},
                     headers={**alice["headers"], "Content-Type": "application/json"})
    assert r.status_code == 200, r.text
    return r.json()


# -- tests ----------------------------------------------------------------
class TestOpenAPI:
    def test_openapi_has_upload_path(self, session):
        r = session.get(f"{API}/openapi.json")
        assert r.status_code == 200
        paths = r.json().get("paths", {})
        assert "/api/messages/upload" in paths, list(paths.keys())


class TestImageUpload:
    def test_image_upload_returns_media_with_dimensions(self, session, alice, conv_ab):
        png = _png_bytes(48, 36)
        files = {"file": ("test.png", png, "image/png")}
        data = {"conversation_id": conv_ab["id"], "kind": "image"}
        r = session.post(f"{API}/messages/upload", data=data, files=files, headers=alice["headers"])
        assert r.status_code == 200, r.text
        m = r.json()
        assert m["type"] == "image"
        assert m["sender_id"] == alice["user"]["id"]
        media = m["media"]
        assert media["mime"] == "image/png"
        assert media["size_bytes"] == len(png)
        assert media["file_name"] == "test.png"
        assert media.get("width") == 48
        assert media.get("height") == 36
        url = media["url"]
        assert url.startswith("/api/uploads/media/"), url
        # Persisted: GET messages list contains it
        r2 = session.get(f"{API}/conversations/{conv_ab['id']}/messages", headers=alice["headers"])
        assert r2.status_code == 200
        ids = [x["id"] for x in r2.json()]
        assert m["id"] in ids
        # Static serve works
        full = f"{BASE_URL}{url}"
        s = session.get(full)
        assert s.status_code == 200
        assert s.headers.get("content-type", "").startswith("image/")
        assert len(s.content) == len(png)

    def test_image_upload_kind_mime_mismatch_400(self, session, alice, conv_ab):
        files = {"file": ("foo.txt", b"hello", "text/plain")}
        data = {"conversation_id": conv_ab["id"], "kind": "image"}
        r = session.post(f"{API}/messages/upload", data=data, files=files, headers=alice["headers"])
        assert r.status_code == 400

    def test_image_upload_updates_last_message(self, session, alice, conv_ab):
        png = _png_bytes()
        files = {"file": ("preview.png", png, "image/png")}
        data = {"conversation_id": conv_ab["id"], "kind": "image"}
        r = session.post(f"{API}/messages/upload", data=data, files=files, headers=alice["headers"])
        assert r.status_code == 200
        # last_message should reflect type=image and media_label_key
        rc = session.get(f"{API}/conversations", headers=alice["headers"])
        convs = {c["id"]: c for c in rc.json()}
        lm = convs[conv_ab["id"]]["last_message"]
        assert lm is not None
        assert lm.get("type") == "image"
        assert lm.get("media_label_key") == "image"


class TestFileUpload:
    def test_file_upload_works(self, session, alice, conv_ab):
        body = b"PDF-LIKE-BYTES-" + os.urandom(64)
        files = {"file": ("report.pdf", body, "application/pdf")}
        data = {"conversation_id": conv_ab["id"], "kind": "file"}
        r = session.post(f"{API}/messages/upload", data=data, files=files, headers=alice["headers"])
        assert r.status_code == 200, r.text
        m = r.json()
        assert m["type"] == "file"
        assert m["media"]["file_name"] == "report.pdf"
        assert m["media"]["mime"] == "application/pdf"
        assert m["media"]["size_bytes"] == len(body)


class TestVoiceUpload:
    def test_voice_upload_with_duration_and_waveform(self, session, alice, conv_ab):
        body = b"OggS" + os.urandom(256)  # fake audio bytes; backend doesn't decode
        wf = [round(i / 39.0, 3) for i in range(40)]
        files = {"file": ("voice.ogg", body, "audio/ogg")}
        data = {
            "conversation_id": conv_ab["id"],
            "kind": "voice",
            "duration_sec": "3.4",
            "waveform": json.dumps(wf),
        }
        r = session.post(f"{API}/messages/upload", data=data, files=files, headers=alice["headers"])
        assert r.status_code == 200, r.text
        m = r.json()
        assert m["type"] == "voice"
        media = m["media"]
        assert media["mime"] == "audio/ogg"
        assert abs(media.get("duration_sec", 0) - 3.4) < 1e-3
        wave = media.get("waveform")
        assert isinstance(wave, list) and len(wave) == 40
        # values clamped to [0,1]
        assert all(0.0 <= float(x) <= 1.0 for x in wave)

    def test_voice_kind_with_non_audio_rejected(self, session, alice, conv_ab):
        files = {"file": ("nope.txt", b"hi", "text/plain")}
        data = {"conversation_id": conv_ab["id"], "kind": "voice"}
        r = session.post(f"{API}/messages/upload", data=data, files=files, headers=alice["headers"])
        assert r.status_code == 400


class TestPermissions:
    def test_non_participant_403(self, session, charlie, conv_ab):
        png = _png_bytes()
        files = {"file": ("c.png", png, "image/png")}
        data = {"conversation_id": conv_ab["id"], "kind": "image"}
        r = session.post(f"{API}/messages/upload", data=data, files=files, headers=charlie["headers"])
        assert r.status_code == 403

    def test_missing_conversation_404(self, session, alice):
        png = _png_bytes()
        files = {"file": ("x.png", png, "image/png")}
        data = {"conversation_id": "nonexistent-conv-xyz", "kind": "image"}
        r = session.post(f"{API}/messages/upload", data=data, files=files, headers=alice["headers"])
        assert r.status_code == 404

    def test_invalid_kind_400(self, session, alice, conv_ab):
        files = {"file": ("x.bin", b"x", "application/octet-stream")}
        data = {"conversation_id": conv_ab["id"], "kind": "exe"}
        r = session.post(f"{API}/messages/upload", data=data, files=files, headers=alice["headers"])
        assert r.status_code == 400

    def test_unauth_401(self, session, conv_ab):
        files = {"file": ("x.png", _png_bytes(), "image/png")}
        data = {"conversation_id": conv_ab["id"], "kind": "image"}
        r = session.post(f"{API}/messages/upload", data=data, files=files)
        assert r.status_code == 401


class TestWebSocketBroadcast:
    @pytest.mark.asyncio
    async def test_ws_message_new_and_status_on_upload(self, session, alice, bob, conv_ab):
        a_url = f"{WS_URL}?token={alice['token']}"
        b_url = f"{WS_URL}?token={bob['token']}"

        async def drain(ws, seconds=1.2):
            frames = []
            end = time.time() + seconds
            while time.time() < end:
                try:
                    raw = await asyncio.wait_for(ws.recv(), timeout=0.3)
                    frames.append(json.loads(raw))
                except asyncio.TimeoutError:
                    pass
            return frames

        async with websockets.connect(a_url, open_timeout=10) as a_ws, \
                   websockets.connect(b_url, open_timeout=10) as b_ws:
            await drain(a_ws, 1.2)
            await drain(b_ws, 1.2)

            # alice uploads image via REST while bob is WS-connected -> expect delivered
            png = _png_bytes()
            files = {"file": ("ws.png", png, "image/png")}
            data = {"conversation_id": conv_ab["id"], "kind": "image"}
            r = session.post(f"{API}/messages/upload", data=data, files=files, headers=alice["headers"])
            assert r.status_code == 200, r.text
            posted = r.json()
            assert posted["status"] == "delivered", posted

            # bob should receive message_new
            saw_new = False
            for _ in range(20):
                try:
                    raw = await asyncio.wait_for(b_ws.recv(), timeout=2)
                    msg = json.loads(raw)
                    if msg.get("type") == "message_new" and msg.get("message", {}).get("id") == posted["id"]:
                        m = msg["message"]
                        assert m["type"] == "image"
                        assert m["media"]["url"].startswith("/api/uploads/media/")
                        saw_new = True
                        break
                except asyncio.TimeoutError:
                    break
            assert saw_new, "bob did not receive message_new for media upload"


class TestTextRegression:
    def test_text_message_still_works(self, session, alice, conv_ab):
        text = f"TEST_phase3_{uuid.uuid4().hex[:6]}"
        r = session.post(f"{API}/conversations/{conv_ab['id']}/messages",
                         json={"text": text},
                         headers={**alice["headers"], "Content-Type": "application/json"})
        assert r.status_code == 200, r.text
        assert r.json()["text"] == text
