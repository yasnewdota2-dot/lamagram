from dotenv import load_dotenv
from pathlib import Path

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

import os
import re
import uuid
import json
import logging
import asyncio
import shutil
from datetime import datetime, timezone, timedelta
from typing import Optional, List, Dict

import bcrypt
import jwt
from fastapi import FastAPI, APIRouter, HTTPException, Depends, UploadFile, File, Form, Request, WebSocket, WebSocketDisconnect, Query
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from fastapi.staticfiles import StaticFiles
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, Field, ConfigDict, field_validator

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
MONGO_URL = os.environ['MONGO_URL']
DB_NAME = os.environ['DB_NAME']
JWT_SECRET = os.environ['JWT_SECRET']
JWT_ALGORITHM = "HS256"
JWT_EXPIRE_DAYS = 7
UPLOAD_DIR = Path(os.environ.get('UPLOAD_DIR', str(ROOT_DIR / 'uploads')))
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
AVATAR_DIR = UPLOAD_DIR / 'avatars'
AVATAR_DIR.mkdir(parents=True, exist_ok=True)
MEDIA_DIR = UPLOAD_DIR / 'media'
MEDIA_DIR.mkdir(parents=True, exist_ok=True)
MAX_UPLOAD_BYTES = 100 * 1024 * 1024  # 100 MB

USERNAME_RE = re.compile(r'^[a-z0-9_]{3,32}$')

ALLOWED_MIMES = {
    "image": {"image/jpeg", "image/png", "image/webp", "image/gif"},
    "video": {"video/mp4", "video/webm", "video/quicktime"},
    "voice": {
        "audio/webm", "audio/ogg", "audio/mpeg", "audio/mp3",
        "audio/mp4", "audio/m4a", "audio/x-m4a", "audio/aac",
        "audio/wav", "audio/x-wav", "audio/wave", "audio/vnd.wav",
    },
}
MEDIA_EXT_MAP = {
    "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "image/gif": ".gif",
    "video/mp4": ".mp4", "video/webm": ".webm", "video/quicktime": ".mov",
    "audio/webm": ".webm", "audio/ogg": ".ogg",
    "audio/mpeg": ".mp3", "audio/mp3": ".mp3",
    "audio/mp4": ".m4a", "audio/m4a": ".m4a", "audio/x-m4a": ".m4a",
    "audio/wav": ".wav", "audio/x-wav": ".wav", "audio/wave": ".wav", "audio/vnd.wav": ".wav",
    "audio/aac": ".aac",
}

def normalize_mime(raw: str) -> str:
    """Strip codec parameters and whitespace: 'audio/webm;codecs=opus' -> 'audio/webm'."""
    if not raw:
        return ""
    return raw.split(";")[0].strip().lower()

# ---------------------------------------------------------------------------
# Database
# ---------------------------------------------------------------------------
mongo_client = AsyncIOMotorClient(MONGO_URL)
db = mongo_client[DB_NAME]

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger("glass-messenger")

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")

def verify_password(plain: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))
    except Exception:
        return False

def create_access_token(user_id: str, username: str) -> str:
    payload = {
        "sub": user_id,
        "username": username,
        "exp": datetime.now(timezone.utc) + timedelta(days=JWT_EXPIRE_DAYS),
        "iat": datetime.now(timezone.utc),
        "type": "access",
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)

def public_user(doc: dict) -> dict:
    return {
        "id": doc["_id"],
        "username": doc["username"],
        "display_name": doc.get("display_name", ""),
        "bio": doc.get("bio", ""),
        "avatar_url": doc.get("avatar_url"),
        "is_online": doc.get("is_online", False),
        "last_seen": doc.get("last_seen"),
        "created_at": doc.get("created_at"),
    }

# ---------------------------------------------------------------------------
# Pydantic Models
# ---------------------------------------------------------------------------
class SignupRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")
    username: str = Field(..., min_length=3, max_length=20)
    password: str = Field(..., min_length=6, max_length=128)
    display_name: str = Field(..., min_length=1, max_length=50)

    @field_validator("username")
    @classmethod
    def _username_format(cls, v: str) -> str:
        v = v.strip().lower()
        if not USERNAME_RE.match(v):
            raise ValueError("Username must be 3-20 chars: lowercase letters, numbers, underscores only")
        return v

    @field_validator("display_name")
    @classmethod
    def _strip_display(cls, v: str) -> str:
        return v.strip()

class LoginRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")
    username: str
    password: str

    @field_validator("username")
    @classmethod
    def _username_lower(cls, v: str) -> str:
        return v.strip().lower()

class UpdateProfileRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")
    display_name: Optional[str] = Field(None, min_length=1, max_length=50)
    bio: Optional[str] = Field(None, max_length=280)

# ---------------------------------------------------------------------------
# Auth dependency
# ---------------------------------------------------------------------------
bearer_scheme = HTTPBearer(auto_error=False)

async def get_current_user(credentials: Optional[HTTPAuthorizationCredentials] = Depends(bearer_scheme)) -> dict:
    if credentials is None or not credentials.credentials:
        raise HTTPException(status_code=401, detail="Not authenticated")
    token = credentials.credentials
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")
    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid token payload")
    user = await db.users.find_one({"_id": user_id})
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    return user

# ---------------------------------------------------------------------------
# App
# ---------------------------------------------------------------------------
app = FastAPI(title="Glass Messenger API", openapi_url="/api/openapi.json", docs_url="/api/docs")
api_router = APIRouter(prefix="/api")

# ---------------------------------------------------------------------------
# Routes — Auth
# ---------------------------------------------------------------------------
@api_router.get("/")
async def root():
    return {"message": "Glass Messenger API", "status": "ok"}

async def _name_taken(name: str, *, exclude_user_id: str = None, exclude_conv_id: str = None) -> bool:
    """Global names namespace: username and conv.handle share the same pool."""
    n = (name or "").strip().lower()
    if not n:
        return False
    uq = {"username": n}
    if exclude_user_id:
        uq["_id"] = {"$ne": exclude_user_id}
    if await db.users.find_one(uq):
        return True
    cq = {"handle": n}
    if exclude_conv_id:
        cq["_id"] = {"$ne": exclude_conv_id}
    if await db.conversations.find_one(cq):
        return True
    return False

@api_router.post("/auth/signup")
async def signup(body: SignupRequest):
    if await _name_taken(body.username):
        raise HTTPException(status_code=409, detail="Username already taken")
    now = datetime.now(timezone.utc).isoformat()
    user_doc = {
        "_id": str(uuid.uuid4()),
        "username": body.username,
        "password_hash": hash_password(body.password),
        "display_name": body.display_name,
        "bio": "",
        "avatar_url": None,
        "created_at": now,
        "last_seen": now,
        "is_online": True,
    }
    await db.users.insert_one(user_doc)
    # Auto-create Saved Messages for the new user
    saved_now = datetime.now(timezone.utc).isoformat()
    await db.conversations.insert_one({
        "_id": str(uuid.uuid4()),
        "kind": "saved",
        "participants": [user_doc["_id"]],
        "last_message": None,
        "last_message_at": None,
        "created_at": saved_now,
    })
    token = create_access_token(user_doc["_id"], user_doc["username"])
    return {"access_token": token, "token_type": "bearer", "user": public_user(user_doc)}

@api_router.post("/auth/login")
async def login(body: LoginRequest):
    user = await db.users.find_one({"username": body.username})
    if not user or not verify_password(body.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid username or password")
    now = datetime.now(timezone.utc).isoformat()
    await db.users.update_one(
        {"_id": user["_id"]},
        {"$set": {"last_seen": now, "is_online": True}},
    )
    user["last_seen"] = now
    user["is_online"] = True
    token = create_access_token(user["_id"], user["username"])
    return {"access_token": token, "token_type": "bearer", "user": public_user(user)}

@api_router.get("/auth/me")
async def me(current_user: dict = Depends(get_current_user)):
    pu = public_user(current_user)
    # Self-view: include own blocked list so the client can render block toggles.
    pu["blocked_users"] = list(current_user.get("blocked_users") or [])
    return pu

@api_router.post("/auth/logout")
async def logout(current_user: dict = Depends(get_current_user)):
    now = datetime.now(timezone.utc).isoformat()
    await db.users.update_one(
        {"_id": current_user["_id"]},
        {"$set": {"is_online": False, "last_seen": now}},
    )
    return {"success": True}

# ---------------------------------------------------------------------------
# Routes — Users
# ---------------------------------------------------------------------------
@api_router.patch("/users/me")
async def update_me(body: UpdateProfileRequest, current_user: dict = Depends(get_current_user)):
    updates = {}
    if body.display_name is not None:
        updates["display_name"] = body.display_name.strip()
    if body.bio is not None:
        updates["bio"] = body.bio.strip()
    if updates:
        await db.users.update_one({"_id": current_user["_id"]}, {"$set": updates})
    user = await db.users.find_one({"_id": current_user["_id"]})
    return public_user(user)

@api_router.post("/users/me/avatar")
async def upload_avatar(
    request: Request,
    file: UploadFile = File(...),
    current_user: dict = Depends(get_current_user),
):
    # Check size based on Content-Length if present
    cl = request.headers.get("content-length")
    if cl and int(cl) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="File too large (max 100MB)")

    ctype = (file.content_type or "").lower()
    if not ctype.startswith("image/"):
        raise HTTPException(status_code=400, detail="Avatar must be an image")
    ext_map = {
        "image/png": ".png",
        "image/jpeg": ".jpg",
        "image/jpg": ".jpg",
        "image/webp": ".webp",
        "image/gif": ".gif",
    }
    ext = ext_map.get(ctype, ".bin")
    file_id = uuid.uuid4().hex
    filename = f"{current_user['_id']}_{file_id}{ext}"
    dest = AVATAR_DIR / filename

    total = 0
    with dest.open("wb") as out:
        while True:
            chunk = await file.read(1024 * 1024)
            if not chunk:
                break
            total += len(chunk)
            if total > MAX_UPLOAD_BYTES:
                out.close()
                try:
                    dest.unlink()
                except Exception:
                    pass
                raise HTTPException(status_code=413, detail="File too large (max 100MB)")
            out.write(chunk)

    avatar_url = f"/api/uploads/avatars/{filename}"
    await db.users.update_one({"_id": current_user["_id"]}, {"$set": {"avatar_url": avatar_url}})

    # Best-effort: delete previous avatar file
    prev = current_user.get("avatar_url")
    if prev and prev != avatar_url and prev.startswith("/api/uploads/avatars/"):
        try:
            (AVATAR_DIR / Path(prev).name).unlink()
        except Exception:
            pass

    return {"avatar_url": avatar_url}

# ---------------------------------------------------------------------------
# Phase 2 — Chat: models, helpers, connection manager
# ---------------------------------------------------------------------------
class SendMessageRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")
    text: str = Field(..., min_length=1, max_length=4000)
    reply_to_message_id: Optional[str] = None

    @field_validator("text")
    @classmethod
    def _strip(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("Message text cannot be empty")
        return v

class EditMessageRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")
    text: str = Field(..., min_length=1, max_length=4000)

    @field_validator("text")
    @classmethod
    def _strip(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("Message text cannot be empty")
        return v

class ForwardMessageRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")
    conversation_ids: List[str] = Field(..., min_length=1, max_length=10)

class CreateConversationRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")
    user_id: str

EDIT_WINDOW_SECONDS = 48 * 60 * 60       # 48 hours
DELETE_ALL_WINDOW_SECONDS = 24 * 60 * 60  # 24 hours
MAX_PINNED_DMS_PER_USER = 5

def _text_preview(text: Optional[str], limit: int = 120) -> str:
    if not text:
        return ""
    t = text.strip()
    if len(t) <= limit:
        return t
    return t[: limit - 1].rstrip() + "…"

def public_message(m: dict) -> dict:
    if m.get("deleted_for_everyone"):
        return {
            "id": m["_id"],
            "conversation_id": m["conversation_id"],
            "sender_id": m["sender_id"],
            "type": "text",
            "text": "",
            "media": None,
            "status": m.get("status", "sent"),
            "created_at": m["created_at"],
            "seen_at": m.get("seen_at"),
            "delivered_at": m.get("delivered_at"),
            "reply_to": None,
            "forwarded_from": None,
            "edited": False,
            "edited_at": None,
            "deleted_for_everyone": True,
        }
    return {
        "id": m["_id"],
        "conversation_id": m["conversation_id"],
        "sender_id": m["sender_id"],
        "type": m.get("type", "text"),
        "text": m.get("text", ""),
        "media": m.get("media"),
        "status": m.get("status", "sent"),
        "created_at": m["created_at"],
        "seen_at": m.get("seen_at"),
        "delivered_at": m.get("delivered_at"),
        "reply_to": m.get("reply_to"),
        "forwarded_from": m.get("forwarded_from"),
        "edited": bool(m.get("edited")),
        "edited_at": m.get("edited_at"),
        "deleted_for_everyone": False,
        "starred_by": m.get("starred_by") or [],
        "reactions": m.get("reactions") or [],
        "pinned_in_conv": bool(m.get("pinned_in_conv")),
        "pinned_by_user_id": m.get("pinned_by_user_id"),
        "view_count": int(m.get("view_count") or 0),
    }

async def build_reply_snapshot(reply_to_message_id: str, conv_id: str) -> dict:
    src = await db.messages.find_one({"_id": reply_to_message_id})
    if not src or src.get("conversation_id") != conv_id:
        raise HTTPException(400, "reply_to_message_id is not in this conversation")
    if src.get("deleted_for_everyone"):
        raise HTTPException(400, "Cannot reply to a deleted message")
    src_type = src.get("type", "text")
    snap = {
        "message_id": src["_id"],
        "sender_id": src["sender_id"],
        "type": src_type,
        "text_preview": _text_preview(src.get("text", "")),
    }
    media = src.get("media") or {}
    if src_type == "file" and media.get("file_name"):
        snap["file_name"] = media["file_name"]
    return snap

async def public_conversation(c: dict, me_id: str) -> dict:
    kind = c.get("kind", "dm")
    group_pub = None
    if kind == "saved":
        me = await db.users.find_one({"_id": me_id})
        other_pub = public_user(me) if me else None
        unread = 0
    elif kind in ("group", "channel"):
        other_pub = None
        if kind == "channel":
            unread = 0  # channels: no per-user read tracking
        else:
            unread = await db.messages.count_documents({
                "conversation_id": c["_id"],
                "sender_id": {"$ne": me_id},
                "status": {"$ne": "seen"},
                "deleted": {"$ne": True},
            })
        group_pub = {
            "title": c.get("title", ""),
            "avatar_url": c.get("avatar_url"),
            "description": c.get("description"),
            "member_count": len(c.get("participants", [])),
            "is_admin": me_id in (c.get("admins") or []) or me_id == (c.get("owner_id") or c.get("created_by")),
            "is_owner": me_id == (c.get("owner_id") or c.get("created_by")),
            "owner_id": c.get("owner_id") or c.get("created_by"),
            "created_by": c.get("created_by"),
            # Phase 9D — admin custom titles + granular permissions snapshot for UI
            "admin_titles": c.get("admin_titles") or {},
            "admin_permissions": c.get("admin_permissions") or {},
        }
    else:
        other_id = next((p for p in c["participants"] if p != me_id), None)
        other = await db.users.find_one({"_id": other_id}) if other_id else None
        unread = await db.messages.count_documents({
            "conversation_id": c["_id"],
            "sender_id": {"$ne": me_id},
            "status": {"$ne": "seen"},
            "deleted": {"$ne": True},
        })
        other_pub = public_user(other) if other else None
        if other_pub and other_id:
            other_pub["is_online"] = manager.is_online(other_id) or bool(other.get("is_online"))
    is_admin = me_id in (c.get("admins") or [])
    payload = {
        "id": c["_id"],
        "kind": kind,
        "participants": c["participants"],
        "other_user": other_pub,
        "group": group_pub,
        "last_message": c.get("last_message"),
        "last_message_at": c.get("last_message_at"),
        "created_at": c["created_at"],
        "unread_count": unread,
        "is_public": bool(c.get("is_public", False)),
        "handle": c.get("handle"),
        "is_admin": is_admin,
        "posters_only": kind == "channel",
    }
    if is_admin and c.get("invite_token"):
        payload["invite_token"] = c.get("invite_token")
    return payload

class ConnectionManager:
    def __init__(self):
        self._conns: dict = {}
        self._lock = asyncio.Lock()

    async def connect(self, user_id: str, ws: WebSocket):
        async with self._lock:
            self._conns.setdefault(user_id, set()).add(ws)

    async def disconnect(self, user_id: str, ws: WebSocket):
        async with self._lock:
            if user_id in self._conns:
                self._conns[user_id].discard(ws)
                if not self._conns[user_id]:
                    self._conns.pop(user_id, None)

    def is_online(self, user_id: str) -> bool:
        return bool(self._conns.get(user_id))

    async def send_to_user(self, user_id: str, payload: dict):
        for ws in list(self._conns.get(user_id, set())):
            try:
                await ws.send_json(payload)
            except Exception:
                pass

manager = ConnectionManager()

async def get_partner_user_ids(user_id: str) -> set:
    convs = await db.conversations.find({"participants": user_id}).to_list(None)
    ids = set()
    for c in convs:
        for p in c["participants"]:
            if p != user_id:
                ids.add(p)
    return ids

async def broadcast_presence(user_id: str, is_online: bool, last_seen: str):
    payload = {"type": "presence", "user_id": user_id, "is_online": is_online, "last_seen": last_seen}
    for pid in await get_partner_user_ids(user_id):
        await manager.send_to_user(pid, payload)

# ---------------------------------------------------------------------------
# Routes — Users (search + by id)
# ---------------------------------------------------------------------------
@api_router.get("/users/search")
async def search_users(q: str = "", current_user: dict = Depends(get_current_user)):
    q = (q or "").strip()
    if not q:
        return []
    # Username-first search: '@xxx' → exact then prefix on username
    if q.startswith("@"):
        q2 = q[1:].strip().lower()
        if not q2:
            return []
        safe = re.escape(q2)
        cursor = db.users.find({
            "_id": {"$ne": current_user["_id"]},
            "username": {"$regex": f"^{safe}"},
        }).limit(20)
        docs = await cursor.to_list(20)
        docs.sort(key=lambda d: 0 if d["username"] == q2 else 1)
        out = []
        for d in docs:
            u = public_user(d)
            u["is_online"] = manager.is_online(d["_id"]) or bool(d.get("is_online"))
            out.append(u)
        return out

    safe_lower = re.escape(q.lower())
    safe_any = re.escape(q)
    cursor = db.users.find({
        "_id": {"$ne": current_user["_id"]},
        "$or": [
            {"username": {"$regex": f"^{safe_lower}"}},
            {"display_name": {"$regex": safe_any, "$options": "i"}},
        ],
    }).limit(20)
    docs = await cursor.to_list(20)
    out = []
    for d in docs:
        u = public_user(d)
        u["is_online"] = manager.is_online(d["_id"]) or bool(d.get("is_online"))
        out.append(u)
    return out

@api_router.get("/users/by-username/{username}")
async def get_user_by_username(username: str, current_user: dict = Depends(get_current_user)):
    u = await db.users.find_one({"username": username.strip().lower()})
    if not u:
        raise HTTPException(404, "User not found")
    pu = public_user(u)
    pu["is_online"] = manager.is_online(u["_id"]) or bool(u.get("is_online"))
    return pu

@api_router.get("/users/{user_id}")
async def get_user(user_id: str, current_user: dict = Depends(get_current_user)):
    u = await db.users.find_one({"_id": user_id})
    if not u:
        raise HTTPException(404, "User not found")
    pu = public_user(u)
    pu["is_online"] = manager.is_online(u["_id"]) or bool(u.get("is_online"))
    return pu

# ---------------------------------------------------------------------------
# Routes — Conversations & Messages
# ---------------------------------------------------------------------------
@api_router.post("/conversations/saved")
async def create_or_get_saved(current_user: dict = Depends(get_current_user)):
    me_id = current_user["_id"]
    existing = await db.conversations.find_one({"kind": "saved", "participants": [me_id]})
    if existing:
        return await public_conversation(existing, me_id)
    now = datetime.now(timezone.utc).isoformat()
    conv = {
        "_id": str(uuid.uuid4()),
        "kind": "saved",
        "participants": [me_id],
        "last_message": None,
        "last_message_at": None,
        "created_at": now,
    }
    await db.conversations.insert_one(conv)
    return await public_conversation(conv, me_id)

@api_router.post("/conversations")
async def create_or_get_conversation(body: CreateConversationRequest, current_user: dict = Depends(get_current_user)):
    other_id = body.user_id
    if other_id == current_user["_id"]:
        raise HTTPException(400, "Cannot create a conversation with yourself")
    other = await db.users.find_one({"_id": other_id})
    if not other:
        raise HTTPException(404, "User not found")
    # Block enforcement: cannot start a DM if either side has blocked the other.
    if other_id in (current_user.get("blocked_users") or []):
        raise HTTPException(403, "You have blocked this user")
    if current_user["_id"] in (other.get("blocked_users") or []):
        raise HTTPException(403, "Cannot start chat with this user")
    participants = sorted([current_user["_id"], other_id])
    existing = await db.conversations.find_one({"participants": participants})
    if existing:
        return await public_conversation(existing, current_user["_id"])
    now = datetime.now(timezone.utc).isoformat()
    conv = {
        "_id": str(uuid.uuid4()),
        "participants": participants,
        "last_message": None,
        "last_message_at": None,
        "created_at": now,
    }
    await db.conversations.insert_one(conv)
    return await public_conversation(conv, current_user["_id"])

@api_router.get("/conversations")
async def list_conversations(current_user: dict = Depends(get_current_user)):
    me_id = current_user["_id"]
    docs = await db.conversations.find({"participants": me_id}).to_list(500)
    if not docs:
        return []

    # Collect every "other" participant id across DMs in one pass
    other_ids = set()
    for c in docs:
        if c.get("kind") == "saved":
            continue
        for p in c.get("participants", []):
            if p != me_id:
                other_ids.add(p)

    # Batch fetch all other_user profiles in ONE query
    users_by_id = {}
    if other_ids:
        async for u in db.users.find({"_id": {"$in": list(other_ids)}}):
            users_by_id[u["_id"]] = u

    # Batch unread counts via single aggregation across all DM conv ids
    dm_conv_ids = [c["_id"] for c in docs if c.get("kind") != "saved"]
    unread_by_conv = {}
    if dm_conv_ids:
        pipeline = [
            {"$match": {
                "conversation_id": {"$in": dm_conv_ids},
                "sender_id": {"$ne": me_id},
                "status": {"$ne": "seen"},
                "deleted": {"$ne": True},
            }},
            {"$group": {"_id": "$conversation_id", "n": {"$sum": 1}}},
        ]
        async for row in db.messages.aggregate(pipeline):
            unread_by_conv[row["_id"]] = row["n"]

    # Need own profile once for saved conversation
    me_doc = None
    has_saved = any(c.get("kind") == "saved" for c in docs)
    if has_saved:
        me_doc = await db.users.find_one({"_id": me_id})

    out = []
    for c in docs:
        kind = c.get("kind", "dm")
        group_pub = None
        if kind == "saved":
            other_pub = public_user(me_doc) if me_doc else None
            unread = 0
        elif kind in ("group", "channel"):
            other_pub = None
            group_pub = {
                "title": c.get("title", ""),
                "avatar_url": c.get("avatar_url"),
                "description": c.get("description"),
                "member_count": len(c.get("participants", [])),
                "is_admin": me_id in (c.get("admins") or []),
                "created_by": c.get("created_by"),
            }
            unread = 0 if kind == "channel" else unread_by_conv.get(c["_id"], 0)
        else:
            other_id = next((p for p in c.get("participants", []) if p != me_id), None)
            other_doc = users_by_id.get(other_id) if other_id else None
            other_pub = public_user(other_doc) if other_doc else None
            if other_pub and other_id and other_doc:
                other_pub["is_online"] = manager.is_online(other_id) or bool(other_doc.get("is_online"))
            unread = unread_by_conv.get(c["_id"], 0)
        is_admin = me_id in (c.get("admins") or [])
        row = {
            "id": c["_id"],
            "kind": kind,
            "participants": c["participants"],
            "other_user": other_pub,
            "group": group_pub,
            "last_message": c.get("last_message"),
            "last_message_at": c.get("last_message_at"),
            "created_at": c["created_at"],
            "unread_count": unread,
            "is_pinned": me_id in (c.get("pinned_by") or []),
            "is_muted": me_id in (c.get("muted_by") or []),
            "is_public": bool(c.get("is_public", False)),
            "handle": c.get("handle"),
            "is_admin": is_admin,
            "posters_only": kind == "channel",
        }
        if is_admin and c.get("invite_token"):
            row["invite_token"] = c.get("invite_token")
        out.append(row)

    saved = [c for c in out if c.get("kind") == "saved"]
    dm = [c for c in out if c.get("kind") != "saved"]
    pinned_dm = [c for c in dm if c["is_pinned"]]
    unpinned_dm = [c for c in dm if not c["is_pinned"]]
    pinned_dm.sort(key=lambda x: x.get("last_message_at") or x.get("created_at") or "", reverse=True)
    unpinned_dm.sort(key=lambda x: x.get("last_message_at") or x.get("created_at") or "", reverse=True)
    return saved + pinned_dm + unpinned_dm

@api_router.get("/conversations/{conv_id}/messages")
async def get_messages(
    conv_id: str,
    before: Optional[str] = None,
    limit: int = 50,
    current_user: dict = Depends(get_current_user),
):
    limit = max(1, min(int(limit or 50), 100))
    conv = await db.conversations.find_one({"_id": conv_id})
    if not conv:
        raise HTTPException(404, "Conversation not found")
    if current_user["_id"] not in conv["participants"]:
        raise HTTPException(403, "Not a participant")
    query: dict = {"conversation_id": conv_id, "deleted": {"$ne": True}}
    me_id = current_user["_id"]
    query["deleted_for"] = {"$ne": me_id}
    if before:
        before_msg = await db.messages.find_one({"_id": before})
        if before_msg:
            query["created_at"] = {"$lt": before_msg["created_at"]}
    cursor = db.messages.find(query).sort("created_at", -1).limit(limit)
    docs = await cursor.to_list(limit)
    docs.reverse()
    return [public_message(m) for m in docs]

@api_router.post("/conversations/{conv_id}/messages")
async def post_message(conv_id: str, body: SendMessageRequest, current_user: dict = Depends(get_current_user)):
    conv = await db.conversations.find_one({"_id": conv_id})
    if not conv:
        raise HTTPException(404, "Conversation not found")
    if current_user["_id"] not in conv["participants"]:
        raise HTTPException(403, "Not a participant")
    # Channel posting: admins only
    if conv.get("kind") == "channel" and current_user["_id"] not in (conv.get("admins") or []):
        raise HTTPException(403, "Only admins can post in channels")
    other_id = next((p for p in conv["participants"] if p != current_user["_id"]), None)
    is_saved = conv.get("kind") == "saved"
    is_channel = conv.get("kind") == "channel"
    # Phase 8B: silent block enforcement in DMs (Telegram-style — no error leaks).
    # If the recipient has blocked the sender, accept the message into the sender's
    # own thread but do NOT broadcast or store-mirror to the blocked recipient.
    is_dm = conv.get("kind") in (None, "dm") and other_id is not None and not is_saved and not is_channel
    blocked_by_other = False
    if is_dm:
        other_user = await db.users.find_one({"_id": other_id})
        if other_user and current_user["_id"] in (other_user.get("blocked_users") or []):
            blocked_by_other = True
        elif other_id in (current_user.get("blocked_users") or []):
            # Sender has blocked recipient — explicit error (sender's own action)
            raise HTTPException(403, "You have blocked this user; unblock to send messages")
    now = datetime.now(timezone.utc).isoformat()
    if is_saved:
        initial_status = "seen"
    elif is_channel:
        initial_status = "sent"
    else:
        initial_status = "delivered" if (other_id and manager.is_online(other_id)) else "sent"
    reply_snap = None
    if body.reply_to_message_id:
        reply_snap = await build_reply_snapshot(body.reply_to_message_id, conv_id)
    msg = {
        "_id": str(uuid.uuid4()),
        "conversation_id": conv_id,
        "sender_id": current_user["_id"],
        "type": "text",
        "text": body.text,
        "status": initial_status,
        "created_at": now,
        "seen_at": now if is_saved else None,
        "delivered_at": now if initial_status in ("delivered", "seen") else None,
        "deleted": False,
        "reply_to": reply_snap,
        "forwarded_from": None,
        "edited": False,
        "edited_at": None,
        "deleted_for": [],
        "deleted_for_everyone": False,
    }
    await db.messages.insert_one(msg)
    last = {"text": msg["text"], "sender_id": msg["sender_id"], "created_at": now, "type": "text"}
    await db.conversations.update_one(
        {"_id": conv_id},
        {"$set": {"last_message": last, "last_message_at": now}},
    )
    pm = public_message(msg)
    new_payload = {"type": "message_new", "message": pm, "conversation_id": conv_id}
    if conv.get("kind") in ("group", "channel"):
        for pid in conv["participants"]:
            await manager.send_to_user(pid, new_payload)
    else:
        # DM / saved: always echo to sender; suppress broadcast to recipient
        # if recipient has blocked the sender (silent block — Telegram-style).
        await manager.send_to_user(current_user["_id"], new_payload)
        if other_id and not blocked_by_other:
            await manager.send_to_user(other_id, new_payload)
    # Status (delivered) broadcast — skip entirely for channels
    if not is_channel and other_id and initial_status == "delivered" and not blocked_by_other:
        status_payload = {
            "type": "message_status",
            "message_id": msg["_id"],
            "conversation_id": conv_id,
            "status": "delivered",
            "at": now,
        }
        await manager.send_to_user(current_user["_id"], status_payload)
        await manager.send_to_user(other_id, status_payload)
    return pm

@api_router.post("/conversations/{conv_id}/read")
async def mark_conversation_read(conv_id: str, current_user: dict = Depends(get_current_user)):
    conv = await db.conversations.find_one({"_id": conv_id})
    if not conv:
        raise HTTPException(404, "Conversation not found")
    if current_user["_id"] not in conv["participants"]:
        raise HTTPException(403, "Not a participant")
    # Phase 8C: channels track view counts instead of per-user seen status.
    if conv.get("kind") == "channel":
        me_id = current_user["_id"]
        unviewed = await db.messages.find({
            "conversation_id": conv_id,
            "sender_id": {"$ne": me_id},
            "deleted_for_everyone": {"$ne": True},
            "viewers": {"$ne": me_id},
        }, {"_id": 1}).to_list(500)
        if not unviewed:
            return {"updated": 0, "viewed": 0}
        ids = [m["_id"] for m in unviewed]
        await db.messages.update_many(
            {"_id": {"$in": ids}},
            {"$addToSet": {"viewers": me_id}, "$inc": {"view_count": 1}},
        )
        # Broadcast batch update to all channel participants
        payload = {
            "type": "message_views_updated",
            "conversation_id": conv_id,
            "message_ids": ids,
        }
        for pid in conv.get("participants") or []:
            await manager.send_to_user(pid, payload)
        return {"updated": 0, "viewed": len(ids)}
    now = datetime.now(timezone.utc).isoformat()
    targets = await db.messages.find({
        "conversation_id": conv_id,
        "sender_id": {"$ne": current_user["_id"]},
        "status": {"$ne": "seen"},
        "deleted": {"$ne": True},
    }).to_list(None)
    if targets:
        ids = [m["_id"] for m in targets]
        await db.messages.update_many(
            {"_id": {"$in": ids}},
            {"$set": {"status": "seen", "seen_at": now}},
        )
        for m in targets:
            payload = {
                "type": "message_status",
                "message_id": m["_id"],
                "conversation_id": conv_id,
                "status": "seen",
                "at": now,
            }
            for pid in conv["participants"]:
                await manager.send_to_user(pid, payload)
    return {"updated": len(targets)}

@api_router.post("/messages/upload")
async def upload_message_media(
    request: Request,
    conversation_id: str = Form(...),
    kind: str = Form(...),
    file: UploadFile = File(...),
    duration_sec: Optional[float] = Form(None),
    waveform: Optional[str] = Form(None),
    reply_to_message_id: Optional[str] = Form(None),
    current_user: dict = Depends(get_current_user),
):
    if kind not in ("image", "video", "file", "voice"):
        raise HTTPException(400, "Invalid kind")

    cl = request.headers.get("content-length")
    if cl and int(cl) > MAX_UPLOAD_BYTES + 1024:
        raise HTTPException(413, "File too large (max 100MB)")

    conv = await db.conversations.find_one({"_id": conversation_id})
    if not conv:
        raise HTTPException(404, "Conversation not found")
    if current_user["_id"] not in conv["participants"]:
        raise HTTPException(403, "Not a participant")
    if conv.get("kind") == "channel" and current_user["_id"] not in (conv.get("admins") or []):
        raise HTTPException(403, "Only admins can post in channels")

    ctype = normalize_mime(file.content_type) or "application/octet-stream"
    if kind == "image" and not ctype.startswith("image/"):
        raise HTTPException(400, "Unsupported image type")
    if kind == "video" and not ctype.startswith("video/"):
        raise HTTPException(400, "Unsupported video type")
    if kind == "voice" and not ctype.startswith("audio/"):
        raise HTTPException(400, "Unsupported voice type")
    if kind in ALLOWED_MIMES and ctype not in ALLOWED_MIMES[kind]:
        # We've already verified the broad category above; reject explicitly out-of-list mimes
        raise HTTPException(400, f"Unsupported {kind} mime: {ctype}")

    # Resolve extension
    ext = MEDIA_EXT_MAP.get(ctype)
    if not ext and file.filename and "." in file.filename:
        ext = "." + file.filename.rsplit(".", 1)[-1].lower()[:8]
    if not ext:
        ext = ".bin"

    now = datetime.now(timezone.utc)
    folder = MEDIA_DIR / f"{now.year:04d}" / f"{now.month:02d}"
    folder.mkdir(parents=True, exist_ok=True)
    file_id = uuid.uuid4().hex
    dest = folder / f"{file_id}{ext}"

    total = 0
    with dest.open("wb") as out:
        while True:
            chunk = await file.read(1024 * 1024)
            if not chunk:
                break
            total += len(chunk)
            if total > MAX_UPLOAD_BYTES:
                out.close()
                try:
                    dest.unlink()
                except Exception:
                    pass
                raise HTTPException(413, "File too large (max 100MB)")
            out.write(chunk)

    media_url = f"/api/uploads/media/{now.year:04d}/{now.month:02d}/{file_id}{ext}"
    media: dict = {
        "url": media_url,
        "mime": ctype,
        "size_bytes": total,
        "file_name": file.filename or f"upload{ext}",
    }

    # Image dimensions (best effort)
    if kind == "image":
        try:
            from PIL import Image
            with Image.open(dest) as im:
                media["width"], media["height"] = im.size
        except Exception:
            pass

    if kind == "voice":
        if duration_sec is not None:
            try:
                media["duration_sec"] = float(duration_sec)
            except Exception:
                pass
        if waveform:
            try:
                parsed = json.loads(waveform)
                if isinstance(parsed, list):
                    media["waveform"] = [max(0.0, min(1.0, float(x))) for x in parsed[:80]]
            except Exception:
                pass

    other_id = next((p for p in conv["participants"] if p != current_user["_id"]), None)
    is_saved = conv.get("kind") == "saved"
    now_iso = now.isoformat()
    if is_saved:
        initial_status = "seen"
    else:
        initial_status = "delivered" if (other_id and manager.is_online(other_id)) else "sent"
    reply_snap = None
    if reply_to_message_id:
        reply_snap = await build_reply_snapshot(reply_to_message_id, conversation_id)
    msg = {
        "_id": str(uuid.uuid4()),
        "conversation_id": conversation_id,
        "sender_id": current_user["_id"],
        "type": kind,
        "text": "",
        "media": media,
        "status": initial_status,
        "created_at": now_iso,
        "seen_at": now_iso if is_saved else None,
        "delivered_at": now_iso if initial_status in ("delivered", "seen") else None,
        "deleted": False,
        "reply_to": reply_snap,
        "forwarded_from": None,
        "edited": False,
        "edited_at": None,
        "deleted_for": [],
        "deleted_for_everyone": False,
    }
    await db.messages.insert_one(msg)

    # Last-message label (frontend will localize using type/file_name/duration)
    label_text_fallback = {
        "image": "Photo",
        "video": "Video",
        "file": media.get("file_name") or "File",
        "voice": f"Voice {int(media.get('duration_sec') or 0)}s",
    }[kind]
    last = {
        "text": label_text_fallback,
        "sender_id": msg["sender_id"],
        "created_at": now_iso,
        "type": kind,
        "media_label_key": kind,
        "file_name": media.get("file_name") if kind == "file" else None,
        "duration_sec": media.get("duration_sec") if kind == "voice" else None,
    }
    await db.conversations.update_one(
        {"_id": conversation_id},
        {"$set": {"last_message": last, "last_message_at": now_iso}},
    )

    pm = public_message(msg)
    new_payload = {"type": "message_new", "message": pm, "conversation_id": conversation_id}
    await manager.send_to_user(current_user["_id"], new_payload)
    if other_id:
        await manager.send_to_user(other_id, new_payload)
        if initial_status == "delivered":
            status_payload = {
                "type": "message_status",
                "message_id": msg["_id"],
                "conversation_id": conversation_id,
                "status": "delivered",
                "at": now_iso,
            }
            await manager.send_to_user(current_user["_id"], status_payload)
            await manager.send_to_user(other_id, status_payload)
    return pm

# ---------------------------------------------------------------------------
# Phase 5B — Edit, Delete, Forward, Pin, Mute
# ---------------------------------------------------------------------------

def _parse_iso(s: Optional[str]) -> Optional[datetime]:
    if not s:
        return None
    try:
        return datetime.fromisoformat(s)
    except Exception:
        return None

async def _format_last_message_for_conv(conv_id: str) -> Optional[dict]:
    """Return the last_message snapshot for a conversation after a delete-for-everyone
    or edit, by reading the newest live message (excludes globally-deleted messages from
    showing original content). Returns None if no live messages exist."""
    doc = await db.messages.find_one(
        {"conversation_id": conv_id, "deleted": {"$ne": True}},
        sort=[("created_at", -1)],
    )
    if not doc:
        return None
    if doc.get("deleted_for_everyone"):
        return {
            "text": "",
            "sender_id": doc["sender_id"],
            "created_at": doc["created_at"],
            "type": "deleted",
        }
    t = doc.get("type", "text")
    label = doc.get("text", "") if t == "text" else {
        "image": "Photo",
        "video": "Video",
        "file": (doc.get("media") or {}).get("file_name") or "File",
        "voice": f"Voice {int((doc.get('media') or {}).get('duration_sec') or 0)}s",
    }.get(t, "")
    last = {
        "text": label,
        "sender_id": doc["sender_id"],
        "created_at": doc["created_at"],
        "type": t,
    }
    if t in ("image", "video", "file", "voice"):
        last["media_label_key"] = t
        if t == "file":
            last["file_name"] = (doc.get("media") or {}).get("file_name")
        if t == "voice":
            last["duration_sec"] = (doc.get("media") or {}).get("duration_sec")
    return last

@api_router.patch("/messages/{message_id}")
async def edit_message(message_id: str, body: EditMessageRequest, current_user: dict = Depends(get_current_user)):
    msg = await db.messages.find_one({"_id": message_id})
    if not msg:
        raise HTTPException(404, "Message not found")
    if msg["sender_id"] != current_user["_id"]:
        raise HTTPException(403, "Only the sender can edit")
    if msg.get("type", "text") != "text":
        raise HTTPException(400, "Only text messages can be edited")
    if msg.get("deleted_for_everyone"):
        raise HTTPException(400, "Cannot edit a deleted message")
    created = _parse_iso(msg.get("created_at"))
    if created and (datetime.now(timezone.utc) - created).total_seconds() > EDIT_WINDOW_SECONDS:
        raise HTTPException(400, "Edit window (48h) has expired")
    now = datetime.now(timezone.utc).isoformat()
    await db.messages.update_one(
        {"_id": message_id},
        {"$set": {"text": body.text, "edited": True, "edited_at": now}},
    )
    msg["text"] = body.text
    msg["edited"] = True
    msg["edited_at"] = now
    conv_id = msg["conversation_id"]
    # Update conversation last_message if this is the most recent message
    conv = await db.conversations.find_one({"_id": conv_id})
    if conv and conv.get("last_message") and (conv.get("last_message_at") == msg["created_at"]):
        await db.conversations.update_one(
            {"_id": conv_id},
            {"$set": {"last_message": {**conv["last_message"], "text": body.text}}},
        )
    payload = {
        "type": "message_edited",
        "message_id": message_id,
        "conversation_id": conv_id,
        "text": body.text,
        "edited_at": now,
    }
    for pid in (conv or {}).get("participants", []):
        await manager.send_to_user(pid, payload)
    return public_message(msg)

@api_router.delete("/messages/{message_id}")
async def delete_message(
    message_id: str,
    scope: str = "me",
    current_user: dict = Depends(get_current_user),
):
    if scope not in ("me", "all"):
        raise HTTPException(400, "scope must be 'me' or 'all'")
    msg = await db.messages.find_one({"_id": message_id})
    if not msg:
        raise HTTPException(404, "Message not found")
    conv = await db.conversations.find_one({"_id": msg["conversation_id"]})
    if not conv or current_user["_id"] not in conv["participants"]:
        raise HTTPException(403, "Not a participant")

    if scope == "me":
        await db.messages.update_one(
            {"_id": message_id},
            {"$addToSet": {"deleted_for": current_user["_id"]}},
        )
        return {"ok": True, "scope": "me"}

    # scope == "all"
    is_sender = msg["sender_id"] == current_user["_id"]
    # Phase 9D: admins with can_delete_messages may delete other people's
    # messages for everyone in groups/channels. Sender retains the 24h window.
    is_perm_admin = (
        conv.get("kind") in ("group", "channel")
        and _has_perm(conv, current_user["_id"], "can_delete_messages")
    )
    if not is_sender and not is_perm_admin:
        raise HTTPException(403, "Only the sender or an admin can delete for everyone")
    if is_sender:
        created = _parse_iso(msg.get("created_at"))
        if created and (datetime.now(timezone.utc) - created).total_seconds() > DELETE_ALL_WINDOW_SECONDS:
            raise HTTPException(400, "Delete-for-everyone window (24h) has expired")
    # Best-effort media file cleanup
    media = msg.get("media") or {}
    media_url = media.get("url")
    if media_url and media_url.startswith("/api/uploads/"):
        try:
            rel = media_url[len("/api/uploads/"):]
            file_path = UPLOAD_DIR / rel
            file_path = file_path.resolve()
            if str(file_path).startswith(str(UPLOAD_DIR.resolve())) and file_path.exists():
                file_path.unlink()
        except Exception:
            pass
    await db.messages.update_one(
        {"_id": message_id},
        {"$set": {
            "deleted_for_everyone": True,
            "text": "",
            "media": None,
        }},
    )
    # Update conversation last_message if this was the latest
    if conv.get("last_message_at") == msg["created_at"]:
        new_last = await _format_last_message_for_conv(msg["conversation_id"])
        await db.conversations.update_one(
            {"_id": msg["conversation_id"]},
            {"$set": {
                "last_message": new_last,
                "last_message_at": (new_last or {}).get("created_at"),
            }},
        )
    payload = {
        "type": "message_deleted",
        "message_id": message_id,
        "conversation_id": msg["conversation_id"],
        "scope": "all",
    }
    for pid in conv.get("participants", []):
        await manager.send_to_user(pid, payload)
    return {"ok": True, "scope": "all"}

@api_router.post("/messages/{message_id}/forward")
async def forward_message(
    message_id: str,
    body: ForwardMessageRequest,
    current_user: dict = Depends(get_current_user),
):
    src = await db.messages.find_one({"_id": message_id})
    if not src:
        raise HTTPException(404, "Source message not found")
    if src.get("deleted_for_everyone"):
        raise HTTPException(400, "Cannot forward a deleted message")
    # Resolve original sender once
    orig_sender = await db.users.find_one({"_id": src["sender_id"]})
    orig_info = {
        "original_message_id": src["_id"],
        "original_sender_id": src["sender_id"],
        "original_sender_username": (orig_sender or {}).get("username"),
        "original_sender_display_name": (orig_sender or {}).get("display_name"),
    }
    # If the source itself was forwarded, preserve the original origin
    if src.get("forwarded_from"):
        orig_info = src["forwarded_from"]

    created = []
    for target_id in body.conversation_ids:
        conv = await db.conversations.find_one({"_id": target_id})
        if not conv or current_user["_id"] not in conv["participants"]:
            continue  # silently skip non-participant or unknown
        other_id = next((p for p in conv["participants"] if p != current_user["_id"]), None)
        is_saved = conv.get("kind") == "saved"
        now = datetime.now(timezone.utc).isoformat()
        if is_saved:
            initial_status = "seen"
        else:
            initial_status = "delivered" if (other_id and manager.is_online(other_id)) else "sent"
        msg = {
            "_id": str(uuid.uuid4()),
            "conversation_id": target_id,
            "sender_id": current_user["_id"],
            "type": src.get("type", "text"),
            "text": src.get("text", ""),
            "media": src.get("media"),  # reuse same media URL (no re-upload)
            "status": initial_status,
            "created_at": now,
            "seen_at": now if is_saved else None,
            "delivered_at": now if initial_status in ("delivered", "seen") else None,
            "deleted": False,
            "reply_to": None,
            "forwarded_from": orig_info,
            "edited": False,
            "edited_at": None,
            "deleted_for": [],
            "deleted_for_everyone": False,
        }
        await db.messages.insert_one(msg)
        # last_message label
        t = msg["type"]
        if t == "text":
            last_text = msg["text"]
        else:
            label = {
                "image": "Photo",
                "video": "Video",
                "file": (msg.get("media") or {}).get("file_name") or "File",
                "voice": f"Voice {int((msg.get('media') or {}).get('duration_sec') or 0)}s",
            }.get(t, "")
            last_text = label
        last = {
            "text": last_text,
            "sender_id": msg["sender_id"],
            "created_at": now,
            "type": t,
        }
        if t in ("image", "video", "file", "voice"):
            last["media_label_key"] = t
            if t == "file":
                last["file_name"] = (msg.get("media") or {}).get("file_name")
            if t == "voice":
                last["duration_sec"] = (msg.get("media") or {}).get("duration_sec")
        await db.conversations.update_one(
            {"_id": target_id},
            {"$set": {"last_message": last, "last_message_at": now}},
        )
        pm = public_message(msg)
        new_payload = {"type": "message_new", "message": pm, "conversation_id": target_id}
        for pid in conv["participants"]:
            await manager.send_to_user(pid, new_payload)
        created.append(pm)
    return {"forwarded": len(created), "messages": created}

async def _toggle_set_field(conv_id: str, me_id: str, field: str, add: bool, *, cap: Optional[int] = None) -> dict:
    conv = await db.conversations.find_one({"_id": conv_id})
    if not conv:
        raise HTTPException(404, "Conversation not found")
    if me_id not in conv["participants"]:
        raise HTTPException(403, "Not a participant")
    if add and cap is not None and conv.get("kind") != "saved":
        # Count user's currently pinned DMs (excluding saved)
        existing = await db.conversations.count_documents({
            "participants": me_id,
            "kind": {"$ne": "saved"},
            field: me_id,
            "_id": {"$ne": conv_id},
        })
        already_set = me_id in (conv.get(field) or [])
        if not already_set and existing >= cap:
            raise HTTPException(400, f"Up to {cap} pinned chats")
    op = "$addToSet" if add else "$pull"
    await db.conversations.update_one({"_id": conv_id}, {op: {field: me_id}})
    updated = await db.conversations.find_one({"_id": conv_id})
    is_pinned = me_id in (updated.get("pinned_by") or [])
    is_muted = me_id in (updated.get("muted_by") or [])
    payload = {
        "type": "conversation_updated",
        "conversation_id": conv_id,
        "is_pinned": is_pinned,
        "is_muted": is_muted,
    }
    await manager.send_to_user(me_id, payload)
    return {"id": conv_id, "is_pinned": is_pinned, "is_muted": is_muted}

@api_router.post("/conversations/{conv_id}/pin")
async def pin_conversation(conv_id: str, current_user: dict = Depends(get_current_user)):
    return await _toggle_set_field(conv_id, current_user["_id"], "pinned_by", add=True, cap=MAX_PINNED_DMS_PER_USER)

@api_router.delete("/conversations/{conv_id}/pin")
async def unpin_conversation(conv_id: str, current_user: dict = Depends(get_current_user)):
    return await _toggle_set_field(conv_id, current_user["_id"], "pinned_by", add=False)

@api_router.post("/conversations/{conv_id}/mute")
async def mute_conversation(conv_id: str, current_user: dict = Depends(get_current_user)):
    return await _toggle_set_field(conv_id, current_user["_id"], "muted_by", add=True)

@api_router.delete("/conversations/{conv_id}/mute")
async def unmute_conversation(conv_id: str, current_user: dict = Depends(get_current_user)):
    return await _toggle_set_field(conv_id, current_user["_id"], "muted_by", add=False)

class UpdateUsernameRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")
    username: str = Field(..., max_length=100)

@api_router.patch("/users/me/username")
async def update_username(body: UpdateUsernameRequest, current_user: dict = Depends(get_current_user)):
    new_un = (body.username or "").strip().lower()
    if not re.fullmatch(r"[a-z0-9_]{3,32}", new_un):
        raise HTTPException(400, "Invalid username format")
    if new_un == current_user["username"]:
        raise HTTPException(400, "Same as current username")
    existing = await db.users.find_one({"username": new_un, "_id": {"$ne": current_user["_id"]}})
    if existing:
        raise HTTPException(409, "Username already taken")
    if await db.conversations.find_one({"handle": new_un}):
        raise HTTPException(409, "Username already taken")
    await db.users.update_one({"_id": current_user["_id"]}, {"$set": {"username": new_un}})
    updated = await db.users.find_one({"_id": current_user["_id"]})
    pub = public_user(updated)
    # Broadcast user_updated to everyone sharing a conversation
    convs = await db.conversations.find({"participants": current_user["_id"]}, {"participants": 1}).to_list(2000)
    targets = set()
    for c in convs:
        for p in c.get("participants", []):
            if p != current_user["_id"]:
                targets.add(p)
    payload = {"type": "user_updated", "user": pub}
    for uid in targets:
        await manager.send_to_user(uid, payload)
    await manager.send_to_user(current_user["_id"], payload)
    return pub

# ---------------------------------------------------------------------------
# Phase 5C — Groups, Search, Starred
# ---------------------------------------------------------------------------

class CreateGroupRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")
    title: str = Field(..., min_length=3, max_length=50)
    participant_ids: List[str] = Field(default_factory=list, max_length=200)
    description: Optional[str] = Field(None, max_length=200)

class UpdateGroupRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")
    title: Optional[str] = Field(None, min_length=3, max_length=50)
    description: Optional[str] = Field(None, max_length=200)
    is_public: Optional[bool] = None
    handle: Optional[str] = None

class AddMembersRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")
    user_ids: List[str] = Field(..., min_length=1, max_length=50)

def _require_group_admin(conv: dict, me_id: str, perm: Optional[str] = None):
    if conv.get("kind") != "group":
        raise HTTPException(400, "Not a group conversation")
    if perm is not None:
        if not _has_perm(conv, me_id, perm):
            raise HTTPException(403, "You don't have permission for this action")
        return
    if me_id not in (conv.get("admins") or []) and not _is_owner(conv, me_id):
        raise HTTPException(403, "Admin only")

async def _broadcast_conv_to_all(conv_id: str, payload: dict):
    conv = await db.conversations.find_one({"_id": conv_id})
    if not conv:
        return
    for pid in conv.get("participants", []):
        await manager.send_to_user(pid, payload)

async def _public_group_members(conv: dict, q: Optional[str] = None, limit: int = 50, offset: int = 0) -> List[dict]:
    ids = conv.get("participants", [])
    if not ids:
        return []
    users = {u["_id"]: u async for u in db.users.find({"_id": {"$in": ids}})}
    admins = set(conv.get("admins") or [])
    owner_id = conv.get("owner_id") or conv.get("created_by")
    out = []
    qn = (q or "").strip().lower()
    for uid in ids:
        u = users.get(uid)
        if not u:
            continue
        if qn:
            dn = (u.get("display_name") or "").lower()
            un = (u.get("username") or "").lower()
            if qn not in dn and qn not in un:
                continue
        pu = public_user(u)
        pu["is_admin"] = uid in admins or uid == owner_id
        pu["is_owner"] = (uid == owner_id)
        pu["is_online"] = manager.is_online(uid) or bool(u.get("is_online"))
        # Phase 9D — surface custom title + per-admin permissions on listing
        if pu["is_admin"]:
            atitle = ((conv.get("admin_titles") or {}).get(uid) or "").strip()
            if atitle:
                pu["admin_title"] = atitle
            aperms = (conv.get("admin_permissions") or {}).get(uid)
            if aperms:
                pu["admin_permissions"] = aperms
        out.append(pu)
    # offset/limit slice (post-filter)
    return out[max(0, offset): max(0, offset) + max(1, min(int(limit), 200))]


async def _public_banned_members(conv: dict) -> List[dict]:
    ids = conv.get("banned_users") or []
    if not ids:
        return []
    users = {u["_id"]: u async for u in db.users.find({"_id": {"$in": ids}})}
    out = []
    for uid in ids:
        u = users.get(uid)
        if not u:
            continue
        pu = public_user(u)
        out.append(pu)
    return out

@api_router.post("/groups")
async def create_group(body: CreateGroupRequest, current_user: dict = Depends(get_current_user)):
    # Verify all participant users exist and are not the current user. Phase 9B
    # relaxed the minimum to 0 — solo groups are allowed (the creator can add
    # members later from the Group Info dialog).
    p_ids = [uid for uid in dict.fromkeys(body.participant_ids) if uid != current_user["_id"]]
    if p_ids:
        found = await db.users.find({"_id": {"$in": p_ids}}).to_list(len(p_ids))
        if len(found) != len(p_ids):
            raise HTTPException(400, "One or more participant_ids not found")
    participants = [current_user["_id"], *p_ids]
    now = datetime.now(timezone.utc).isoformat()
    conv = {
        "_id": str(uuid.uuid4()),
        "kind": "group",
        "participants": participants,
        "admins": [current_user["_id"]],
        "owner_id": current_user["_id"],
        "title": body.title.strip(),
        "description": (body.description or "").strip() or None,
        "avatar_url": None,
        "created_by": current_user["_id"],
        "created_at": now,
        "last_message": None,
        "last_message_at": None,
        "pinned_by": [],
        "muted_by": [],
        "banned_users": [],
        "admin_titles": {},
        "admin_permissions": {},
    }
    await db.conversations.insert_one(conv)
    pub = await public_conversation(conv, current_user["_id"])
    for pid in participants:
        await manager.send_to_user(pid, {"type": "conversation_new", "conversation": pub if pid == current_user["_id"] else None, "conversation_id": conv["_id"]})
    return pub

@api_router.patch("/groups/{conv_id}")
async def update_group(conv_id: str, body: UpdateGroupRequest, current_user: dict = Depends(get_current_user)):
    conv = await db.conversations.find_one({"_id": conv_id})
    if not conv:
        raise HTTPException(404, "Group not found")
    _require_group_admin(conv, current_user["_id"], perm="can_edit_info")
    patch = {}
    if body.title is not None:
        patch["title"] = body.title.strip()
    if body.description is not None:
        patch["description"] = body.description.strip() or None
    # Phase 6: handle + is_public
    if body.is_public is not None:
        patch["is_public"] = bool(body.is_public)
    if body.handle is not None:
        if body.handle == "":
            patch["handle"] = None
        else:
            h = body.handle.strip().lower()
            if not HANDLE_RE.match(h):
                raise HTTPException(400, "Invalid handle format")
            if await _name_taken(h, exclude_conv_id=conv_id):
                raise HTTPException(409, "Handle already taken")
            patch["handle"] = h
    # If going public, ensure final handle is set
    final_public = patch.get("is_public", conv.get("is_public", False))
    final_handle = patch.get("handle", conv.get("handle"))
    if final_public and not final_handle:
        raise HTTPException(400, "handle is required when going public")
    if patch:
        await db.conversations.update_one({"_id": conv_id}, {"$set": patch})
    updated = await db.conversations.find_one({"_id": conv_id})
    await _broadcast_conv_to_all(conv_id, {"type": "group_updated", "conversation_id": conv_id})
    return await public_conversation(updated, current_user["_id"])

@api_router.post("/groups/{conv_id}/avatar")
async def upload_group_avatar(conv_id: str, file: UploadFile = File(...), current_user: dict = Depends(get_current_user)):
    conv = await db.conversations.find_one({"_id": conv_id})
    if not conv:
        raise HTTPException(404, "Group not found")
    _require_group_admin(conv, current_user["_id"])
    if not file.content_type or file.content_type.split("/")[0] != "image":
        raise HTTPException(400, "Avatar must be an image")
    contents = await file.read()
    if len(contents) > 5 * 1024 * 1024:
        raise HTTPException(400, "Avatar too large (max 5MB)")
    ext = (file.filename or "img").rsplit(".", 1)[-1].lower() if "." in (file.filename or "") else "png"
    if ext not in ("png", "jpg", "jpeg", "webp"):
        ext = "png"
    fname = f"group_{conv_id}_{uuid.uuid4().hex}.{ext}"
    avatar_dir = UPLOAD_DIR / "avatars"
    avatar_dir.mkdir(parents=True, exist_ok=True)
    fpath = avatar_dir / fname
    with open(fpath, "wb") as f:
        f.write(contents)
    url = f"/api/uploads/avatars/{fname}"
    await db.conversations.update_one({"_id": conv_id}, {"$set": {"avatar_url": url}})
    await _broadcast_conv_to_all(conv_id, {"type": "group_updated", "conversation_id": conv_id})
    return {"avatar_url": url}

@api_router.post("/groups/{conv_id}/members")
async def add_group_members(conv_id: str, body: AddMembersRequest, current_user: dict = Depends(get_current_user)):
    conv = await db.conversations.find_one({"_id": conv_id})
    if not conv:
        raise HTTPException(404, "Group not found")
    _require_group_admin(conv, current_user["_id"], perm="can_invite")
    new_ids = [uid for uid in dict.fromkeys(body.user_ids) if uid not in conv["participants"]]
    if not new_ids:
        return await public_conversation(conv, current_user["_id"])
    found = await db.users.find({"_id": {"$in": new_ids}}).to_list(len(new_ids))
    if len(found) != len(new_ids):
        raise HTTPException(400, "One or more user_ids not found")
    await db.conversations.update_one({"_id": conv_id}, {"$addToSet": {"participants": {"$each": new_ids}}})
    updated = await db.conversations.find_one({"_id": conv_id})
    for pid in updated["participants"]:
        await manager.send_to_user(pid, {"type": "group_updated", "conversation_id": conv_id})
    return await public_conversation(updated, current_user["_id"])

@api_router.delete("/groups/{conv_id}/members/{user_id}")
async def remove_group_member(conv_id: str, user_id: str, current_user: dict = Depends(get_current_user)):
    conv = await db.conversations.find_one({"_id": conv_id})
    if not conv or conv.get("kind") != "group":
        raise HTTPException(404, "Group not found")
    me_id = current_user["_id"]
    if user_id not in conv["participants"]:
        raise HTTPException(404, "Member not in group")
    is_self = user_id == me_id
    is_admin = me_id in (conv.get("admins") or [])
    if not is_self and not is_admin:
        raise HTTPException(403, "Admin only")
    admins = list(conv.get("admins") or [])
    participants = list(conv["participants"])
    if is_self and user_id in admins and len(admins) == 1 and len(participants) > 1:
        raise HTTPException(400, "Promote another admin first")
    participants.remove(user_id)
    if user_id in admins:
        admins.remove(user_id)
    if not participants:
        # Auto-delete empty group
        await db.conversations.delete_one({"_id": conv_id})
        await manager.send_to_user(me_id, {"type": "conversation_deleted", "conversation_id": conv_id})
        return {"ok": True, "deleted": True}
    if not admins:
        # Promote first remaining participant
        admins.append(participants[0])
    await db.conversations.update_one(
        {"_id": conv_id},
        {"$set": {"participants": participants, "admins": admins}},
    )
    # Notify removed user + remaining
    await manager.send_to_user(user_id, {"type": "conversation_removed", "conversation_id": conv_id})
    for pid in participants:
        await manager.send_to_user(pid, {"type": "group_updated", "conversation_id": conv_id})
    return {"ok": True, "deleted": False}

@api_router.post("/groups/{conv_id}/admins/{user_id}")
async def promote_admin(conv_id: str, user_id: str, current_user: dict = Depends(get_current_user)):
    conv = await db.conversations.find_one({"_id": conv_id})
    if not conv:
        raise HTTPException(404, "Group not found")
    _require_group_admin(conv, current_user["_id"])
    if user_id not in conv["participants"]:
        raise HTTPException(400, "User is not a member")
    await db.conversations.update_one({"_id": conv_id}, {"$addToSet": {"admins": user_id}})
    await _broadcast_conv_to_all(conv_id, {"type": "group_updated", "conversation_id": conv_id})
    return {"ok": True}

@api_router.delete("/groups/{conv_id}/admins/{user_id}")
async def demote_admin(conv_id: str, user_id: str, current_user: dict = Depends(get_current_user)):
    conv = await db.conversations.find_one({"_id": conv_id})
    if not conv:
        raise HTTPException(404, "Group not found")
    _require_group_admin(conv, current_user["_id"], perm="can_promote")
    admins = conv.get("admins") or []
    if user_id == current_user["_id"] and len(admins) == 1:
        raise HTTPException(400, "Cannot demote yourself as the only admin")
    if user_id not in admins:
        return {"ok": True}
    await db.conversations.update_one({"_id": conv_id}, {"$pull": {"admins": user_id}})
    await _broadcast_conv_to_all(conv_id, {"type": "group_updated", "conversation_id": conv_id})
    return {"ok": True}

@api_router.get("/groups/{conv_id}/members")
async def list_group_members(
    conv_id: str,
    q: Optional[str] = None,
    limit: int = 50,
    offset: int = 0,
    current_user: dict = Depends(get_current_user),
):
    conv = await db.conversations.find_one({"_id": conv_id})
    if not conv or conv.get("kind") != "group":
        raise HTTPException(404, "Group not found")
    if current_user["_id"] not in conv["participants"]:
        raise HTTPException(403, "Not a participant")
    return await _public_group_members(conv, q=q, limit=limit, offset=offset)


@api_router.get("/channels/{conv_id}/members")
async def list_channel_members(
    conv_id: str,
    q: Optional[str] = None,
    limit: int = 50,
    offset: int = 0,
    current_user: dict = Depends(get_current_user),
):
    conv = await db.conversations.find_one({"_id": conv_id})
    if not conv or conv.get("kind") != "channel":
        raise HTTPException(404, "Channel not found")
    if current_user["_id"] not in conv["participants"]:
        raise HTTPException(403, "Not a participant")
    return await _public_group_members(conv, q=q, limit=limit, offset=offset)


# ---------- Phase 8D — Ban / Transfer ownership (groups + channels) ----------
async def _require_admin(conv: dict, user_id: str, kind_label: str, perm: Optional[str] = None):
    if perm is not None:
        if not _has_perm(conv, user_id, perm):
            raise HTTPException(403, "You don't have permission for this action")
        return
    if user_id not in (conv.get("admins") or []) and user_id != (conv.get("owner_id") or conv.get("created_by")):
        raise HTTPException(403, f"Only admins can perform this action")


async def _do_ban(conv_id: str, target_id: str, kind: str, current_user: dict):
    conv = await db.conversations.find_one({"_id": conv_id})
    if not conv or conv.get("kind") != kind:
        raise HTTPException(404, f"{kind.capitalize()} not found")
    await _require_admin(conv, current_user["_id"], kind, perm="can_ban")
    owner_id = conv.get("owner_id") or conv.get("created_by")
    if target_id == current_user["_id"]:
        raise HTTPException(400, "Cannot ban yourself")
    target = await db.users.find_one({"_id": target_id})
    if not target:
        raise HTTPException(404, "User not found")
    await db.conversations.update_one(
        {"_id": conv_id},
        {
            "$addToSet": {"banned_users": target_id},
            "$pull": {"participants": target_id, "admins": target_id},
        },
    )
    fresh = await db.conversations.find_one({"_id": conv_id})
    payload = {"type": "member_banned", "conversation_id": conv_id, "user_id": target_id}
    for pid in fresh.get("participants") or []:
        await manager.send_to_user(pid, payload)
    # Also notify the banned user so their client can drop the conv
    await manager.send_to_user(target_id, {"type": "conversation_removed", "conversation_id": conv_id})
    return {"ok": True, "banned_users": fresh.get("banned_users") or []}


async def _do_unban(conv_id: str, target_id: str, kind: str, current_user: dict):
    conv = await db.conversations.find_one({"_id": conv_id})
    if not conv or conv.get("kind") != kind:
        raise HTTPException(404, f"{kind.capitalize()} not found")
    await _require_admin(conv, current_user["_id"], kind)
    await db.conversations.update_one(
        {"_id": conv_id}, {"$pull": {"banned_users": target_id}}
    )
    fresh = await db.conversations.find_one({"_id": conv_id})
    return {"ok": True, "banned_users": fresh.get("banned_users") or []}


async def _do_transfer(conv_id: str, target_id: str, kind: str, current_user: dict):
    conv = await db.conversations.find_one({"_id": conv_id})
    if not conv or conv.get("kind") != kind:
        raise HTTPException(404, f"{kind.capitalize()} not found")
    owner_id = conv.get("owner_id") or conv.get("created_by")
    if current_user["_id"] != owner_id:
        raise HTTPException(403, "Only the owner can transfer ownership")
    if target_id == owner_id:
        raise HTTPException(400, "Target is already owner")
    if target_id not in (conv.get("participants") or []):
        raise HTTPException(400, "Target is not a member")
    if target_id not in (conv.get("admins") or []):
        raise HTTPException(400, "Target must be an admin first")
    # Set new owner; keep previous owner as admin (idempotent via $addToSet).
    await db.conversations.update_one(
        {"_id": conv_id},
        {
            "$set": {"owner_id": target_id},
            "$addToSet": {"admins": owner_id},
        },
    )
    fresh = await db.conversations.find_one({"_id": conv_id})
    payload = {
        "type": "owner_transferred",
        "conversation_id": conv_id,
        "new_owner_id": target_id,
        "previous_owner_id": owner_id,
    }
    for pid in fresh.get("participants") or []:
        await manager.send_to_user(pid, payload)
    return {"ok": True, "owner_id": target_id}


async def _list_banned(conv_id: str, kind: str, current_user: dict):
    conv = await db.conversations.find_one({"_id": conv_id})
    if not conv or conv.get("kind") != kind:
        raise HTTPException(404, f"{kind.capitalize()} not found")
    await _require_admin(conv, current_user["_id"], kind)
    return await _public_banned_members(conv)


@api_router.post("/groups/{conv_id}/ban/{user_id}")
async def group_ban(conv_id: str, user_id: str, current_user: dict = Depends(get_current_user)):
    return await _do_ban(conv_id, user_id, "group", current_user)

@api_router.delete("/groups/{conv_id}/ban/{user_id}")
async def group_unban(conv_id: str, user_id: str, current_user: dict = Depends(get_current_user)):
    return await _do_unban(conv_id, user_id, "group", current_user)

@api_router.get("/groups/{conv_id}/banned")
async def group_banned(conv_id: str, current_user: dict = Depends(get_current_user)):
    return await _list_banned(conv_id, "group", current_user)

@api_router.post("/groups/{conv_id}/transfer-owner/{user_id}")
async def group_transfer(conv_id: str, user_id: str, current_user: dict = Depends(get_current_user)):
    return await _do_transfer(conv_id, user_id, "group", current_user)

@api_router.post("/channels/{conv_id}/ban/{user_id}")
async def channel_ban(conv_id: str, user_id: str, current_user: dict = Depends(get_current_user)):
    return await _do_ban(conv_id, user_id, "channel", current_user)

@api_router.delete("/channels/{conv_id}/ban/{user_id}")
async def channel_unban(conv_id: str, user_id: str, current_user: dict = Depends(get_current_user)):
    return await _do_unban(conv_id, user_id, "channel", current_user)

@api_router.get("/channels/{conv_id}/banned")
async def channel_banned(conv_id: str, current_user: dict = Depends(get_current_user)):
    return await _list_banned(conv_id, "channel", current_user)

@api_router.post("/channels/{conv_id}/transfer-owner/{user_id}")
async def channel_transfer(conv_id: str, user_id: str, current_user: dict = Depends(get_current_user)):
    return await _do_transfer(conv_id, user_id, "channel", current_user)


# --- Search ---

@api_router.get("/conversations/{conv_id}/messages/search")
async def search_in_conversation(
    conv_id: str,
    q: str,
    limit: int = 20,
    current_user: dict = Depends(get_current_user),
):
    conv = await db.conversations.find_one({"_id": conv_id})
    if not conv:
        raise HTTPException(404, "Conversation not found")
    if current_user["_id"] not in conv["participants"]:
        raise HTTPException(403, "Not a participant")
    q = (q or "").strip()
    if not q:
        return []
    limit = max(1, min(int(limit), 100))
    cur = db.messages.find({
        "conversation_id": conv_id,
        "type": "text",
        "deleted_for_everyone": {"$ne": True},
        "deleted_for": {"$ne": current_user["_id"]},
        "text": {"$regex": re.escape(q), "$options": "i"},
    }).sort("created_at", -1).limit(limit)
    docs = await cur.to_list(limit)
    return [public_message(m) for m in docs]

@api_router.get("/messages/search")
async def search_messages_global(
    q: str,
    limit: int = 20,
    current_user: dict = Depends(get_current_user),
):
    q = (q or "").strip()
    if not q:
        return []
    limit = max(1, min(int(limit), 100))
    convs = await db.conversations.find(
        {"participants": current_user["_id"]}, {"_id": 1, "kind": 1, "title": 1, "participants": 1}
    ).to_list(1000)
    if not convs:
        return []
    conv_ids = [c["_id"] for c in convs]
    cur = db.messages.find({
        "conversation_id": {"$in": conv_ids},
        "type": "text",
        "deleted_for_everyone": {"$ne": True},
        "deleted_for": {"$ne": current_user["_id"]},
        "text": {"$regex": re.escape(q), "$options": "i"},
    }).sort("created_at", -1).limit(limit)
    docs = await cur.to_list(limit)
    return [public_message(m) for m in docs]

# --- Starred ---

@api_router.post("/messages/{message_id}/star")
async def star_message(message_id: str, current_user: dict = Depends(get_current_user)):
    msg = await db.messages.find_one({"_id": message_id})
    if not msg:
        raise HTTPException(404, "Message not found")
    if msg.get("deleted_for_everyone"):
        raise HTTPException(400, "Cannot star a deleted message")
    conv = await db.conversations.find_one({"_id": msg["conversation_id"]})
    if not conv or current_user["_id"] not in conv["participants"]:
        raise HTTPException(403, "Not a participant")
    await db.messages.update_one({"_id": message_id}, {"$addToSet": {"starred_by": current_user["_id"]}})
    return {"ok": True, "starred": True}

@api_router.delete("/messages/{message_id}/star")
async def unstar_message(message_id: str, current_user: dict = Depends(get_current_user)):
    await db.messages.update_one({"_id": message_id}, {"$pull": {"starred_by": current_user["_id"]}})
    return {"ok": True, "starred": False}

@api_router.get("/messages/starred")
async def list_starred(
    limit: int = 50,
    before: Optional[str] = None,
    current_user: dict = Depends(get_current_user),
):
    limit = max(1, min(int(limit), 100))
    query = {
        "starred_by": current_user["_id"],
        "deleted_for_everyone": {"$ne": True},
        "deleted_for": {"$ne": current_user["_id"]},
    }
    if before:
        b = await db.messages.find_one({"_id": before})
        if b:
            query["created_at"] = {"$lt": b["created_at"]}
    cur = db.messages.find(query).sort("created_at", -1).limit(limit)
    docs = await cur.to_list(limit)
    return [public_message(m) for m in docs]

# --- Reactions ---

class ReactionRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")
    emoji: str = Field(..., min_length=1, max_length=16)

@api_router.post("/messages/{message_id}/reactions")
async def toggle_reaction(message_id: str, body: ReactionRequest, current_user: dict = Depends(get_current_user)):
    msg = await db.messages.find_one({"_id": message_id})
    if not msg:
        raise HTTPException(404, "Message not found")
    if msg.get("deleted_for_everyone"):
        raise HTTPException(400, "Cannot react to a deleted message")
    conv = await db.conversations.find_one({"_id": msg["conversation_id"]})
    if not conv or current_user["_id"] not in conv["participants"]:
        raise HTTPException(403, "Not a participant")
    emoji = body.emoji.strip()
    reactions = list(msg.get("reactions") or [])
    existing_idx = next(
        (i for i, r in enumerate(reactions) if r.get("user_id") == current_user["_id"] and r.get("emoji") == emoji),
        -1,
    )
    if existing_idx >= 0:
        reactions.pop(existing_idx)
    else:
        reactions.append({"user_id": current_user["_id"], "emoji": emoji})
    await db.messages.update_one({"_id": message_id}, {"$set": {"reactions": reactions}})
    payload = {
        "type": "message_reaction",
        "message_id": message_id,
        "conversation_id": msg["conversation_id"],
        "reactions": reactions,
    }
    for pid in conv.get("participants", []):
        await manager.send_to_user(pid, payload)
    return {"ok": True, "reactions": reactions}

# ---------------------------------------------------------------------------
# WebSocket — /api/ws
# ---------------------------------------------------------------------------
# === Phase 6: Channels ===

HANDLE_RE = re.compile(r"^[a-z0-9_]{3,32}$")

class CreateChannelRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")
    title: str = Field(..., min_length=3, max_length=50)
    description: Optional[str] = Field(None, max_length=500)
    is_public: bool = False
    handle: Optional[str] = None
    participant_ids: Optional[list[str]] = None

class UpdateChannelRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")
    title: Optional[str] = Field(None, min_length=3, max_length=50)
    description: Optional[str] = Field(None, max_length=500)
    is_public: Optional[bool] = None
    handle: Optional[str] = None

@api_router.post("/channels")
async def create_channel(body: CreateChannelRequest, current_user: dict = Depends(get_current_user)):
    title = body.title.strip()
    desc = (body.description or "").strip()
    is_public = bool(body.is_public)
    handle = (body.handle or "").strip().lower() or None
    if is_public:
        if not handle:
            raise HTTPException(400, "handle is required for public channels")
    if handle is not None:
        if not HANDLE_RE.match(handle):
            raise HTTPException(400, "Invalid handle format")
        if await _name_taken(handle):
            raise HTTPException(409, "Handle already taken")
    participants = list({current_user["_id"], *(body.participant_ids or [])})
    invite_token = None if is_public else str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    doc = {
        "_id": str(uuid.uuid4()),
        "kind": "channel",
        "title": title,
        "description": desc,
        "avatar_url": None,
        "participants": participants,
        "admins": [current_user["_id"]],
        "created_by": current_user["_id"],
        "created_at": now,
        "last_message": None,
        "last_message_at": None,
        "pinned_by": [],
        "muted_by": [],
        "is_public": is_public,
        "handle": handle,
        "invite_token": invite_token,
    }
    await db.conversations.insert_one(doc)
    pub = await public_conversation(doc, current_user["_id"])
    # Broadcast new conversation to participants
    for pid in participants:
        await manager.send_to_user(pid, {"type": "conversation_new", "conversation": pub})
    return pub

@api_router.patch("/channels/{conv_id}")
async def update_channel(conv_id: str, body: UpdateChannelRequest, current_user: dict = Depends(get_current_user)):
    conv = await db.conversations.find_one({"_id": conv_id})
    if not conv or conv.get("kind") != "channel":
        raise HTTPException(404, "Channel not found")
    if not _has_perm(conv, current_user["_id"], "can_edit_info"):
        raise HTTPException(403, "You don't have permission for this action")
    updates = {}
    if body.title is not None:
        updates["title"] = body.title.strip()
    if body.description is not None:
        updates["description"] = body.description.strip()
    if body.is_public is not None:
        updates["is_public"] = bool(body.is_public)
    if body.handle is not None:
        if body.handle == "":
            updates["handle"] = None
        else:
            h = body.handle.strip().lower()
            if not HANDLE_RE.match(h):
                raise HTTPException(400, "Invalid handle format")
            if await _name_taken(h, exclude_conv_id=conv_id):
                raise HTTPException(409, "Handle already taken")
            updates["handle"] = h
    final_public = updates.get("is_public", conv.get("is_public", False))
    final_handle = updates.get("handle", conv.get("handle"))
    if final_public and not final_handle:
        raise HTTPException(400, "handle is required when going public")
    if updates:
        await db.conversations.update_one({"_id": conv_id}, {"$set": updates})
        conv.update(updates)
    pub = await public_conversation(conv, current_user["_id"])
    for pid in conv["participants"]:
        await manager.send_to_user(pid, {"type": "conversation_updated", "conversation": pub})
    return pub

@api_router.post("/channels/{conv_id}/avatar")
async def upload_channel_avatar(
    conv_id: str,
    file: UploadFile = File(...),
    current_user: dict = Depends(get_current_user),
):
    conv = await db.conversations.find_one({"_id": conv_id})
    if not conv or conv.get("kind") != "channel":
        raise HTTPException(404, "Channel not found")
    if current_user["_id"] not in (conv.get("admins") or []):
        raise HTTPException(403, "Admin only")
    if not file.content_type or file.content_type.split("/")[0] != "image":
        raise HTTPException(400, "Avatar must be an image")
    contents = await file.read()
    if len(contents) > 5 * 1024 * 1024:
        raise HTTPException(400, "Avatar too large (max 5MB)")
    ext = (file.filename or "img").rsplit(".", 1)[-1].lower() if "." in (file.filename or "") else "png"
    if ext not in ("png", "jpg", "jpeg", "webp"):
        ext = "png"
    fname = f"channel_{conv_id}_{uuid.uuid4().hex}.{ext}"
    avatar_dir = UPLOAD_DIR / "avatars"
    avatar_dir.mkdir(parents=True, exist_ok=True)
    fpath = avatar_dir / fname
    with open(fpath, "wb") as f:
        f.write(contents)
    rel_url = f"/api/uploads/avatars/{fname}"
    await db.conversations.update_one({"_id": conv_id}, {"$set": {"avatar_url": rel_url}})
    conv["avatar_url"] = rel_url
    pub = await public_conversation(conv, current_user["_id"])
    for pid in conv["participants"]:
        await manager.send_to_user(pid, {"type": "conversation_updated", "conversation": pub})
    return pub

@api_router.post("/channels/{conv_id}/admins/{user_id}")
async def promote_channel_admin(conv_id: str, user_id: str, current_user: dict = Depends(get_current_user)):
    conv = await db.conversations.find_one({"_id": conv_id})
    if not conv or conv.get("kind") != "channel":
        raise HTTPException(404, "Channel not found")
    if not _has_perm(conv, current_user["_id"], "can_promote"):
        raise HTTPException(403, "You don't have permission for this action")
    if user_id not in conv["participants"]:
        raise HTTPException(400, "User is not a participant")
    await db.conversations.update_one({"_id": conv_id}, {"$addToSet": {"admins": user_id}})
    return {"ok": True}

@api_router.delete("/channels/{conv_id}/admins/{user_id}")
async def demote_channel_admin(conv_id: str, user_id: str, current_user: dict = Depends(get_current_user)):
    conv = await db.conversations.find_one({"_id": conv_id})
    if not conv or conv.get("kind") != "channel":
        raise HTTPException(404, "Channel not found")
    if not _has_perm(conv, current_user["_id"], "can_promote"):
        raise HTTPException(403, "You don't have permission for this action")
    if conv.get("created_by") == user_id:
        raise HTTPException(400, "Cannot demote the channel creator")
    await db.conversations.update_one({"_id": conv_id}, {"$pull": {"admins": user_id}})
    return {"ok": True}

# ---------- Phase 9D — PATCH admin title + permissions ----------
class UpdateAdminRoleRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")
    title: Optional[str] = Field(default=None, max_length=16)
    permissions: Optional[Dict[str, bool]] = None


async def _patch_admin_role(conv_id: str, expected_kind: str, target_id: str, body: UpdateAdminRoleRequest, current_user: dict):
    conv = await db.conversations.find_one({"_id": conv_id})
    if not conv or conv.get("kind") != expected_kind:
        raise HTTPException(404, f"{expected_kind.title()} not found")
    # Owner OR an admin with can_promote may edit other admin roles.
    if not _is_owner(conv, current_user["_id"]) and not _has_perm(conv, current_user["_id"], "can_promote"):
        raise HTTPException(403, "You don't have permission for this action")
    if _is_owner(conv, target_id):
        raise HTTPException(400, "Owner's role cannot be edited")
    if target_id not in (conv.get("admins") or []):
        raise HTTPException(400, "Target user is not an admin")

    set_ops: dict = {}
    if body.title is not None:
        t = body.title.strip()
        if t:
            set_ops[f"admin_titles.{target_id}"] = t[:ADMIN_TITLE_MAX]
        else:
            # Clearing the title: delete the key
            await db.conversations.update_one(
                {"_id": conv_id},
                {"$unset": {f"admin_titles.{target_id}": ""}},
            )
    if body.permissions is not None:
        cleaned = {k: bool(v) for k, v in body.permissions.items() if k in ADMIN_PERM_KEYS}
        set_ops[f"admin_permissions.{target_id}"] = cleaned
    if set_ops:
        await db.conversations.update_one({"_id": conv_id}, {"$set": set_ops})
    await _broadcast_conv_to_all(conv_id, {
        "type": "group_updated",
        "conversation_id": conv_id,
    })
    fresh = await db.conversations.find_one({"_id": conv_id})
    titles = fresh.get("admin_titles") or {}
    perms = fresh.get("admin_permissions") or {}
    return {
        "ok": True,
        "user_id": target_id,
        "title": titles.get(target_id),
        "permissions": perms.get(target_id) or {},
    }


@api_router.patch("/groups/{conv_id}/admins/{user_id}")
async def patch_group_admin_role(conv_id: str, user_id: str, body: UpdateAdminRoleRequest, current_user: dict = Depends(get_current_user)):
    return await _patch_admin_role(conv_id, "group", user_id, body, current_user)


@api_router.patch("/channels/{conv_id}/admins/{user_id}")
async def patch_channel_admin_role(conv_id: str, user_id: str, body: UpdateAdminRoleRequest, current_user: dict = Depends(get_current_user)):
    return await _patch_admin_role(conv_id, "channel", user_id, body, current_user)



@api_router.delete("/channels/{conv_id}/members/{user_id}")
async def remove_channel_member(conv_id: str, user_id: str, current_user: dict = Depends(get_current_user)):
    conv = await db.conversations.find_one({"_id": conv_id})
    if not conv or conv.get("kind") != "channel":
        raise HTTPException(404, "Channel not found")
    is_self = user_id == current_user["_id"]
    is_admin = current_user["_id"] in (conv.get("admins") or [])
    if not (is_self or is_admin):
        raise HTTPException(403, "Admin only or self")
    if conv.get("created_by") == user_id and not is_self:
        raise HTTPException(400, "Cannot remove the channel creator")
    await db.conversations.update_one(
        {"_id": conv_id},
        {"$pull": {"participants": user_id, "admins": user_id}},
    )
    return {"ok": True}

# === Phase 6: Join / Discover / Invite ===

class JoinRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")
    handle: Optional[str] = None
    invite_token: Optional[str] = None

def _discover_item(c: dict) -> dict:
    return {
        "id": c["_id"],
        "kind": c.get("kind"),
        "title": c.get("title", ""),
        "avatar_url": c.get("avatar_url"),
        "handle": c.get("handle"),
        "description": c.get("description"),
        "member_count": len(c.get("participants", [])),
    }

async def _add_participant_and_broadcast(conv: dict, user: dict) -> dict:
    """Add user to conv.participants if not already; broadcast conversation_new to self
    and member_joined to existing participants. Returns updated public conversation."""
    uid = user["_id"]
    conv_id = conv["_id"]
    already = uid in conv["participants"]
    if not already:
        await db.conversations.update_one(
            {"_id": conv_id},
            {"$addToSet": {"participants": uid}},
        )
        conv["participants"] = list({*conv["participants"], uid})
    pub = await public_conversation(conv, uid)
    pub["is_member"] = True
    # WS broadcasts
    await manager.send_to_user(uid, {"type": "conversation_new", "conversation": pub})
    if not already:
        member_payload = {
            "type": "member_joined",
            "conversation_id": conv_id,
            "user": public_user(user),
        }
        for pid in conv["participants"]:
            if pid != uid:
                await manager.send_to_user(pid, member_payload)
    return pub

@api_router.post("/conversations/join")
async def join_conversation(body: JoinRequest, current_user: dict = Depends(get_current_user)):
    handle_in = (body.handle or "").strip().lower() or None
    token_in = (body.invite_token or "").strip() or None
    if (handle_in and token_in) or (not handle_in and not token_in):
        raise HTTPException(400, "Provide exactly one of handle or invite_token")
    if handle_in:
        conv = await db.conversations.find_one({"handle": handle_in, "is_public": True})
        if not conv or conv.get("kind") not in ("group", "channel"):
            raise HTTPException(404, "Public conversation not found")
    else:
        conv = await db.conversations.find_one({"invite_token": token_in})
        if not conv or conv.get("kind") not in ("group", "channel"):
            raise HTTPException(404, "Invite not found")
    if conv.get("kind") in ("dm", "saved"):
        raise HTTPException(400, "DMs and Saved Messages are not joinable")
    # Phase 8D: banned users cannot rejoin via link or handle.
    if current_user["_id"] in (conv.get("banned_users") or []):
        label = "channel" if conv.get("kind") == "channel" else "group"
        raise HTTPException(403, f"You are banned from this {label}")
    return await _add_participant_and_broadcast(conv, current_user)

@api_router.get("/discover")
async def discover(q: str = "", limit: int = 20, current_user: dict = Depends(get_current_user)):
    limit = max(1, min(limit, 50))
    me_id = current_user["_id"]
    base = {"is_public": True, "kind": {"$in": ["group", "channel"]}}
    if not q.strip():
        cursor = db.conversations.find(base)
        docs = await cursor.to_list(200)
        docs.sort(key=lambda c: -len(c.get("participants", [])))
        out = [_discover_item(c) for c in docs if me_id not in c.get("participants", [])][:limit]
        return out
    qn = q.strip().lower()
    safe = re.escape(qn)
    # Token-based: split into words, match ANY token in title OR handle.
    tokens = [tok for tok in re.split(r"\s+", qn) if tok]
    or_clauses = [
        {"handle": qn},
        {"handle": {"$regex": safe, "$options": "i"}},     # substring on handle (was prefix)
        {"title": {"$regex": safe, "$options": "i"}},
    ]
    for tok in tokens:
        safe_tok = re.escape(tok)
        or_clauses.append({"title": {"$regex": safe_tok, "$options": "i"}})
        or_clauses.append({"handle": {"$regex": safe_tok, "$options": "i"}})
    cursor = db.conversations.find({**base, "$or": or_clauses})
    docs = await cursor.to_list(200)
    # Rank: handle exact > handle prefix > title match
    def rank(c):
        h = (c.get("handle") or "").lower()
        t = (c.get("title") or "").lower()
        if h == qn: return 0
        if h.startswith(qn): return 1
        if qn in t: return 2
        return 3
    docs.sort(key=lambda c: (rank(c), -len(c.get("participants", []))))
    # Phase 11 — when the user provides a specific query, always show matching
    # public chats even if the user is already a member (so they can find their
    # own groups/channels via handle/title search). The "popular" empty-query
    # path keeps the not-yet-joined filter to surface fresh discovery items.
    out = [_discover_item(c) for c in docs][:limit]
    return out

@api_router.get("/conversations/by-handle/{handle}")
async def conversation_by_handle(handle: str, current_user: dict = Depends(get_current_user)):
    h = handle.strip().lower()
    conv = await db.conversations.find_one({"handle": h, "is_public": True})
    if not conv or conv.get("kind") not in ("group", "channel"):
        raise HTTPException(404, "Public conversation not found")
    item = _discover_item(conv)
    item["is_member"] = current_user["_id"] in conv.get("participants", [])
    return item

# -------- Invite-link endpoints (groups + channels share helpers) --------

async def _rotate_invite(conv_id: str, expected_kind: str, current_user: dict) -> dict:
    conv = await db.conversations.find_one({"_id": conv_id})
    if not conv or conv.get("kind") != expected_kind:
        raise HTTPException(404, f"{expected_kind.title()} not found")
    if not _has_perm(conv, current_user["_id"], "can_invite"):
        raise HTTPException(403, "You don't have permission for this action")
    token = str(uuid.uuid4())
    await db.conversations.update_one({"_id": conv_id}, {"$set": {"invite_token": token}})
    return {"invite_token": token, "invite_path": f"/join/{token}"}

async def _revoke_invite(conv_id: str, expected_kind: str, current_user: dict) -> dict:
    conv = await db.conversations.find_one({"_id": conv_id})
    if not conv or conv.get("kind") != expected_kind:
        raise HTTPException(404, f"{expected_kind.title()} not found")
    if not _has_perm(conv, current_user["_id"], "can_invite"):
        raise HTTPException(403, "You don't have permission for this action")
    await db.conversations.update_one({"_id": conv_id}, {"$set": {"invite_token": None}})
    return {"ok": True}

@api_router.post("/groups/{conv_id}/invite-link")
async def group_invite_create(conv_id: str, current_user: dict = Depends(get_current_user)):
    return await _rotate_invite(conv_id, "group", current_user)

@api_router.delete("/groups/{conv_id}/invite-link")
async def group_invite_revoke(conv_id: str, current_user: dict = Depends(get_current_user)):
    return await _revoke_invite(conv_id, "group", current_user)

@api_router.post("/channels/{conv_id}/invite-link")
async def channel_invite_create(conv_id: str, current_user: dict = Depends(get_current_user)):
    return await _rotate_invite(conv_id, "channel", current_user)

# ---------------------------------------------------------------------------
# Phase 8C — Pin messages in conversations + channel view counts
# ---------------------------------------------------------------------------
PIN_LIMIT = 5

# ---------------------------------------------------------------------------
# Phase 9D — Admin custom titles + granular permissions
# ---------------------------------------------------------------------------
ADMIN_PERM_KEYS = (
    "can_ban",
    "can_promote",
    "can_pin",
    "can_edit_info",
    "can_delete_messages",
    "can_invite",
)
ADMIN_TITLE_MAX = 16


def _is_owner(conv: dict, uid: str) -> bool:
    return uid == (conv.get("owner_id") or conv.get("created_by"))


def _is_admin(conv: dict, uid: str) -> bool:
    return uid in (conv.get("admins") or []) or _is_owner(conv, uid)


def _has_perm(conv: dict, uid: str, perm: str) -> bool:
    """Return True if `uid` may perform `perm` in `conv`.

    Owner: always True. Admins with no `admin_permissions` entry inherit ALL
    permissions (backward compat for legacy data). Otherwise the per-flag
    boolean is honored; a missing flag defaults to True for the same legacy
    reason.
    """
    if not _is_admin(conv, uid):
        return False
    if _is_owner(conv, uid):
        return True
    perms_map = conv.get("admin_permissions") or {}
    perms = perms_map.get(uid)
    if not perms:
        return True
    return bool(perms.get(perm, False))


def _can_pin(conv: dict, user_id: str) -> bool:
    kind = conv.get("kind")
    if kind in ("group", "channel"):
        # Phase 9D — honor granular admin permission can_pin
        return _has_perm(conv, user_id, "can_pin")
    # dm / saved: any participant
    return user_id in (conv.get("participants") or [])


class LocationRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")
    lat: float = Field(..., ge=-90, le=90)
    lng: float = Field(..., ge=-180, le=180)
    address: Optional[str] = Field(default=None, max_length=200)


@api_router.post("/conversations/{conv_id}/location")
async def post_location(conv_id: str, body: LocationRequest, current_user: dict = Depends(get_current_user)):
    conv = await db.conversations.find_one({"_id": conv_id})
    if not conv:
        raise HTTPException(404, "Conversation not found")
    if current_user["_id"] not in conv["participants"]:
        raise HTTPException(403, "Not a participant")
    if conv.get("kind") == "channel" and current_user["_id"] not in (conv.get("admins") or []):
        raise HTTPException(403, "Only admins can post in channels")
    now = datetime.now(timezone.utc).isoformat()
    other_id = next((p for p in conv["participants"] if p != current_user["_id"]), None)
    is_channel = conv.get("kind") == "channel"
    is_dm = conv.get("kind") in (None, "dm") and other_id is not None and conv.get("kind") != "saved" and not is_channel
    initial_status = "sent"
    if is_dm and other_id and manager.is_online(other_id):
        initial_status = "delivered"
    msg = {
        "_id": str(uuid.uuid4()),
        "conversation_id": conv_id,
        "sender_id": current_user["_id"],
        "type": "location",
        "text": None,
        "media": {"lat": body.lat, "lng": body.lng, "address": body.address},
        "status": initial_status,
        "created_at": now,
        "delivered_at": now if initial_status == "delivered" else None,
        "deleted_for_everyone": False,
        "starred_by": [],
        "reactions": [],
        "pinned_in_conv": False,
    }
    await db.messages.insert_one(msg)
    pm = public_message(msg)
    new_payload = {"type": "message_new", "message": pm, "conversation_id": conv_id}
    if conv.get("kind") in ("group", "channel"):
        for pid in conv["participants"]:
            await manager.send_to_user(pid, new_payload)
    else:
        await manager.send_to_user(current_user["_id"], new_payload)
        if other_id:
            await manager.send_to_user(other_id, new_payload)
    return pm


@api_router.post("/messages/{message_id}/pin")
async def pin_message(message_id: str, current_user: dict = Depends(get_current_user)):
    msg = await db.messages.find_one({"_id": message_id})
    if not msg:
        raise HTTPException(404, "Message not found")
    conv_id = msg["conversation_id"]
    conv = await db.conversations.find_one({"_id": conv_id})
    if not conv:
        raise HTTPException(404, "Conversation not found")
    if current_user["_id"] not in (conv.get("participants") or []):
        raise HTTPException(403, "Not a participant")
    if not _can_pin(conv, current_user["_id"]):
        raise HTTPException(403, "Only admins can pin in this conversation")
    if msg.get("deleted_for_everyone"):
        raise HTTPException(400, "Cannot pin a deleted message")
    pinned = list(conv.get("pinned_message_ids") or [])
    if message_id in pinned:
        return public_message(msg)
    pinned.append(message_id)
    popped = None
    if len(pinned) > PIN_LIMIT:
        popped = pinned.pop(0)
    await db.conversations.update_one({"_id": conv_id}, {"$set": {"pinned_message_ids": pinned}})
    await db.messages.update_one({"_id": message_id}, {"$set": {"pinned_in_conv": True}})
    if popped:
        await db.messages.update_one({"_id": popped}, {"$set": {"pinned_in_conv": False}})
    fresh = await db.messages.find_one({"_id": message_id})
    pm = public_message(fresh)
    payload = {
        "type": "message_pinned",
        "conversation_id": conv_id,
        "message": pm,
        "popped_message_id": popped,
        "pinned_message_ids": pinned,
    }
    for pid in conv.get("participants") or []:
        await manager.send_to_user(pid, payload)
    return pm


@api_router.delete("/messages/{message_id}/pin")
async def unpin_message(message_id: str, current_user: dict = Depends(get_current_user)):
    msg = await db.messages.find_one({"_id": message_id})
    if not msg:
        raise HTTPException(404, "Message not found")
    conv_id = msg["conversation_id"]
    conv = await db.conversations.find_one({"_id": conv_id})
    if not conv:
        raise HTTPException(404, "Conversation not found")
    if current_user["_id"] not in (conv.get("participants") or []):
        raise HTTPException(403, "Not a participant")
    if not _can_pin(conv, current_user["_id"]):
        raise HTTPException(403, "Only admins can unpin in this conversation")
    pinned = [pid for pid in (conv.get("pinned_message_ids") or []) if pid != message_id]
    await db.conversations.update_one({"_id": conv_id}, {"$set": {"pinned_message_ids": pinned}})
    await db.messages.update_one({"_id": message_id}, {"$set": {"pinned_in_conv": False, "pinned_by_user_id": None}})
    payload = {
        "type": "message_unpinned",
        "conversation_id": conv_id,
        "message_id": message_id,
        "pinned_message_ids": pinned,
    }
    for pid in conv.get("participants") or []:
        await manager.send_to_user(pid, payload)
    return {"ok": True, "pinned_message_ids": pinned}


@api_router.get("/conversations/{conv_id}/pinned")
async def list_pinned(conv_id: str, current_user: dict = Depends(get_current_user)):
    conv = await db.conversations.find_one({"_id": conv_id})
    if not conv:
        raise HTTPException(404, "Conversation not found")
    if current_user["_id"] not in (conv.get("participants") or []):
        raise HTTPException(403, "Not a participant")
    ids = list(conv.get("pinned_message_ids") or [])
    if not ids:
        return []
    docs = await db.messages.find({"_id": {"$in": ids}}).to_list(PIN_LIMIT + 5)
    by_id = {d["_id"]: d for d in docs}
    out = []
    # Preserve insertion order; newest pin last → reverse to newest-first per spec.
    for mid in reversed(ids):
        if mid in by_id:
            out.append(public_message(by_id[mid]))
    return out


@api_router.delete("/channels/{conv_id}/invite-link")
async def channel_invite_revoke(conv_id: str, current_user: dict = Depends(get_current_user)):
    return await _revoke_invite(conv_id, "channel", current_user)

# ---------------------------------------------------------------------------
# Phase 8B — Conversation delete, block & report
# ---------------------------------------------------------------------------
@api_router.delete("/conversations/{conv_id}")
async def delete_conversation(conv_id: str, current_user: dict = Depends(get_current_user)):
    """Delete a DM or Saved Messages conversation.
    DM: deletes the conv + all its messages for BOTH sides and broadcasts
        `conversation_removed` to the other participant.
    Saved: clears the saved conv + its messages (lazily recreated on next save).
    Groups / Channels use the existing leave / delete endpoints.
    """
    conv = await db.conversations.find_one({"_id": conv_id})
    if not conv:
        raise HTTPException(404, "Conversation not found")
    me_id = current_user["_id"]
    if me_id not in conv["participants"]:
        raise HTTPException(403, "Not a participant")
    kind = conv.get("kind")
    if kind in ("group", "channel"):
        raise HTTPException(400, "Use group/channel leave or admin delete instead")
    other_id = next((p for p in conv["participants"] if p != me_id), None)
    await db.messages.delete_many({"conversation_id": conv_id})
    await db.conversations.delete_one({"_id": conv_id})
    payload = {"type": "conversation_removed", "conversation_id": conv_id}
    await manager.send_to_user(me_id, payload)
    if other_id and kind == "dm":
        await manager.send_to_user(other_id, payload)
    return {"ok": True}


class ReportRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")
    reason: Optional[str] = Field(default=None, max_length=500)


@api_router.post("/users/{user_id}/block")
async def block_user(user_id: str, current_user: dict = Depends(get_current_user)):
    if user_id == current_user["_id"]:
        raise HTTPException(400, "Cannot block yourself")
    target = await db.users.find_one({"_id": user_id})
    if not target:
        raise HTTPException(404, "User not found")
    await db.users.update_one(
        {"_id": current_user["_id"]},
        {"$addToSet": {"blocked_users": user_id}},
    )
    return {"ok": True, "blocked_user_id": user_id}


@api_router.delete("/users/{user_id}/block")
async def unblock_user(user_id: str, current_user: dict = Depends(get_current_user)):
    await db.users.update_one(
        {"_id": current_user["_id"]},
        {"$pull": {"blocked_users": user_id}},
    )
    return {"ok": True, "unblocked_user_id": user_id}


@api_router.get("/users/me/blocked")
async def list_blocked_users(current_user: dict = Depends(get_current_user)):
    blocked_ids = current_user.get("blocked_users") or []
    if not blocked_ids:
        return []
    docs = await db.users.find({"_id": {"$in": blocked_ids}}).to_list(500)
    return [
        {
            "id": d["_id"],
            "username": d.get("username"),
            "display_name": d.get("display_name"),
            "avatar_url": d.get("avatar_url"),
        }
        for d in docs
    ]


@api_router.post("/users/{user_id}/report")
async def report_user(user_id: str, body: ReportRequest, current_user: dict = Depends(get_current_user)):
    if user_id == current_user["_id"]:
        raise HTTPException(400, "Cannot report yourself")
    target = await db.users.find_one({"_id": user_id})
    if not target:
        raise HTTPException(404, "User not found")
    now = datetime.now(timezone.utc).isoformat()
    await db.reports.insert_one({
        "_id": str(uuid.uuid4()),
        "reporter_id": current_user["_id"],
        "target_id": user_id,
        "reason": (body.reason or "").strip()[:500] or None,
        "created_at": now,
    })
    return {"ok": True}


@api_router.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket, token: Optional[str] = Query(default=None)):
    # Resolve token: prefer query param, fallback to Authorization header
    if not token:
        auth = websocket.headers.get("authorization", "")
        if auth.lower().startswith("bearer "):
            token = auth[7:]
    if not token:
        await websocket.close(code=4401)
        return
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        user_id = payload.get("sub")
    except Exception:
        await websocket.close(code=4401)
        return
    user = await db.users.find_one({"_id": user_id}) if user_id else None
    if not user:
        await websocket.close(code=4401)
        return

    await websocket.accept()
    await manager.connect(user_id, websocket)
    now = datetime.now(timezone.utc).isoformat()
    await db.users.update_one({"_id": user_id}, {"$set": {"is_online": True, "last_seen": now}})
    await broadcast_presence(user_id, True, now)

    # Confirm connection to this client
    try:
        await websocket.send_json({"type": "ready", "user_id": user_id, "at": now})
    except Exception:
        pass

    # Mark previously-sent (undelivered) messages as delivered
    try:
        convs = await db.conversations.find({"participants": user_id}).to_list(None)
        conv_ids = [c["_id"] for c in convs]
        if conv_ids:
            undelivered = await db.messages.find({
                "conversation_id": {"$in": conv_ids},
                "sender_id": {"$ne": user_id},
                "status": "sent",
            }).to_list(500)
            if undelivered:
                ids = [m["_id"] for m in undelivered]
                await db.messages.update_many(
                    {"_id": {"$in": ids}},
                    {"$set": {"status": "delivered", "delivered_at": now}},
                )
                for m in undelivered:
                    p = {
                        "type": "message_status",
                        "message_id": m["_id"],
                        "conversation_id": m["conversation_id"],
                        "status": "delivered",
                        "at": now,
                    }
                    await manager.send_to_user(user_id, p)
                    await manager.send_to_user(m["sender_id"], p)
    except Exception as e:
        logger.exception(f"deliver-on-connect failed: {e}")

    try:
        while True:
            data = await websocket.receive_json()
            mtype = data.get("type")
            if mtype == "ping":
                await websocket.send_json({"type": "pong"})
            elif mtype == "typing":
                conv_id = data.get("conversation_id")
                is_typing = bool(data.get("is_typing"))
                if not conv_id:
                    continue
                conv = await db.conversations.find_one({"_id": conv_id})
                if not conv or user_id not in conv["participants"]:
                    continue
                other_id = next((p for p in conv["participants"] if p != user_id), None)
                # Channels: only admins can post, only members watch typing of admins.
                # For DMs there's a single peer; for groups we must fan out to every
                # non-sender participant so headers can render typing names properly.
                payload = {
                    "type": "typing",
                    "conversation_id": conv_id,
                    "user_id": user_id,
                    "is_typing": is_typing,
                }
                kind = conv.get("kind") or "dm"
                if kind == "group":
                    for pid in conv["participants"]:
                        if pid != user_id:
                            await manager.send_to_user(pid, payload)
                elif other_id:
                    await manager.send_to_user(other_id, payload)
    except WebSocketDisconnect:
        pass
    except Exception as e:
        logger.exception(f"ws error: {e}")
    finally:
        await manager.disconnect(user_id, websocket)
        if not manager.is_online(user_id):
            now2 = datetime.now(timezone.utc).isoformat()
            await db.users.update_one({"_id": user_id}, {"$set": {"is_online": False, "last_seen": now2}})
            await broadcast_presence(user_id, False, now2)

# ---------------------------------------------------------------------------
# Mount router & static
# ---------------------------------------------------------------------------
app.include_router(api_router)
app.mount("/api/uploads", StaticFiles(directory=str(UPLOAD_DIR)), name="uploads")

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# Startup: indexes + seed
# ---------------------------------------------------------------------------
SEED_USERS = [
    {"username": "alice", "password": "password123", "display_name": "Alice", "bio": "Hey there!"},
    {"username": "bob", "password": "password123", "display_name": "Bob", "bio": "Living the dream"},
    {"username": "charlie", "password": "password123", "display_name": "Charlie", "bio": "Coffee addict"},
]

@app.on_event("startup")
async def on_startup():
    # Phase 6 migration: backfill is_public/handle/invite_token on conversations
    res_p6 = await db.conversations.update_many(
        {"is_public": {"$exists": False}},
        {"$set": {"is_public": False, "handle": None, "invite_token": None}},
    )
    if res_p6.modified_count:
        logger.info(f"Migration (Phase 6): backfilled {res_p6.modified_count} conversation rows with is_public/handle/invite_token")
    # Ensure index on conversations.handle (unique, partial — only string handles)
    try:
        try:
            await db.conversations.drop_index("handle_1")
        except Exception:
            pass
        try:
            await db.conversations.drop_index("handle_unique_str")
        except Exception:
            pass
        await db.conversations.create_index(
            "handle",
            unique=True,
            partialFilterExpression={"handle": {"$type": "string"}},
            name="handle_unique_str",
        )
    except Exception as _e:
        logger.warning(f"handle index create skipped: {_e}")
    await db.users.create_index("username", unique=True)
    await db.conversations.create_index("participants")
    await db.messages.create_index([("conversation_id", 1), ("created_at", 1)])
    await db.messages.create_index([("conversation_id", 1), ("status", 1)])
    # Phase 8B: backfill blocked_users on users
    try:
        res_p8 = await db.users.update_many(
            {"blocked_users": {"$exists": False}},
            {"$set": {"blocked_users": []}},
        )
        if res_p8.modified_count:
            logger.info(f"Migration (Phase 8B): backfilled {res_p8.modified_count} users with blocked_users=[]")
    except Exception as _e:
        logger.warning(f"blocked_users backfill skipped: {_e}")

    # Phase 8C: backfill pinned_message_ids on conversations + pinned_in_conv on messages
    try:
        res_p8c1 = await db.conversations.update_many(
            {"pinned_message_ids": {"$exists": False}},
            {"$set": {"pinned_message_ids": []}},
        )
        res_p8c2 = await db.messages.update_many(
            {"pinned_in_conv": {"$exists": False}},
            {"$set": {"pinned_in_conv": False}},
        )
        if res_p8c1.modified_count or res_p8c2.modified_count:
            logger.info(
                f"Migration (Phase 8C): backfilled "
                f"{res_p8c1.modified_count} conversations + "
                f"{res_p8c2.modified_count} messages with pinned defaults"
            )
    except Exception as _e:
        logger.warning(f"pinned backfill skipped: {_e}")

    # Phase 8D: backfill owner_id (← created_by) + banned_users=[] on groups & channels
    try:
        res_p8d1 = await db.conversations.update_many(
            {"kind": {"$in": ["group", "channel"]}, "banned_users": {"$exists": False}},
            {"$set": {"banned_users": []}},
        )
        # Set owner_id where missing: fall back to created_by
        async for c in db.conversations.find({"kind": {"$in": ["group", "channel"]}, "owner_id": {"$exists": False}}):
            owner = c.get("created_by")
            if owner:
                await db.conversations.update_one({"_id": c["_id"]}, {"$set": {"owner_id": owner}})
        if res_p8d1.modified_count:
            logger.info(f"Migration (Phase 8D): backfilled banned_users=[] on {res_p8d1.modified_count} groups/channels")
    except Exception as _e:
        logger.warning(f"phase8D backfill skipped: {_e}")

    # Phase 9D: backfill admin_titles and admin_permissions on groups & channels
    try:
        res_p9d = await db.conversations.update_many(
            {
                "kind": {"$in": ["group", "channel"]},
                "$or": [
                    {"admin_titles": {"$exists": False}},
                    {"admin_permissions": {"$exists": False}},
                ],
            },
            {"$set": {"admin_titles": {}, "admin_permissions": {}}},
        )
        if res_p9d.modified_count:
            logger.info(f"Migration (Phase 9D): backfilled admin_titles/admin_permissions on {res_p9d.modified_count} groups/channels")
    except Exception as _e:
        logger.warning(f"phase9D backfill skipped: {_e}")

    count = await db.users.count_documents({})
    if count == 0:
        now = datetime.now(timezone.utc).isoformat()
        docs = []
        for s in SEED_USERS:
            docs.append({
                "_id": str(uuid.uuid4()),
                "username": s["username"],
                "password_hash": hash_password(s["password"]),
                "display_name": s["display_name"],
                "bio": s["bio"],
                "avatar_url": None,
                "created_at": now,
                "last_seen": now,
                "is_online": False,
            })
        await db.users.insert_many(docs)
        logger.info(f"Seeded {len(docs)} demo users: alice/bob/charlie")
    else:
        logger.info(f"Users collection already has {count} users; skipping seed")

    # Seed demo conversations (only if conversations collection is empty)
    conv_count = await db.conversations.count_documents({})
    if conv_count == 0:
        alice = await db.users.find_one({"username": "alice"})
        bob = await db.users.find_one({"username": "bob"})
        charlie = await db.users.find_one({"username": "charlie"})
        if alice and bob and charlie:
            base = datetime.now(timezone.utc) - timedelta(minutes=60)

            async def _seed_pair(user_a: dict, user_b: dict, lines: list):
                conv_id = str(uuid.uuid4())
                msg_docs = []
                last_text = last_sender = last_time = None
                for i, (sender, text) in enumerate(lines):
                    ts = (base + timedelta(minutes=i * 8)).isoformat()
                    msg_docs.append({
                        "_id": str(uuid.uuid4()),
                        "conversation_id": conv_id,
                        "sender_id": sender["_id"],
                        "type": "text",
                        "text": text,
                        "status": "seen",
                        "created_at": ts,
                        "seen_at": ts,
                        "delivered_at": ts,
                        "deleted": False,
                    })
                    last_text, last_sender, last_time = text, sender["_id"], ts
                await db.conversations.insert_one({
                    "_id": conv_id,
                    "participants": sorted([user_a["_id"], user_b["_id"]]),
                    "last_message": {
                        "text": last_text,
                        "sender_id": last_sender,
                        "created_at": last_time,
                        "type": "text",
                    },
                    "last_message_at": last_time,
                    "created_at": msg_docs[0]["created_at"],
                })
                await db.messages.insert_many(msg_docs)

            await _seed_pair(alice, bob, [
                (alice, "Hey Bob! Just trying out Glass."),
                (bob, "Looks slick — loving the dark aesthetic."),
                (alice, "Right? The blur on these panels is chef's kiss."),
                (bob, "Catch you later — coffee run."),
            ])
            await _seed_pair(alice, charlie, [
                (charlie, "Coffee tonight?"),
                (alice, "Always."),
            ])
            logger.info("Seeded 2 demo conversations (alice↔bob, alice↔charlie)")

    # Migration: ensure every user has a Saved Messages conversation
    existing_saved = await db.conversations.find(
        {"kind": "saved"}, {"participants": 1}
    ).to_list(None)
    saved_user_ids = set()
    for c in existing_saved:
        ps = c.get("participants") or []
        if ps:
            saved_user_ids.add(ps[0])
    now_iso = datetime.now(timezone.utc).isoformat()
    created = 0
    async for u in db.users.find({}, {"_id": 1}):
        if u["_id"] not in saved_user_ids:
            await db.conversations.insert_one({
                "_id": str(uuid.uuid4()),
                "kind": "saved",
                "participants": [u["_id"]],
                "last_message": None,
                "last_message_at": None,
                "created_at": now_iso,
            })
            created += 1
    if created:
        logger.info(f"Migration: created {created} Saved Messages conversations")

    # Migration: ensure existing Saved Messages messages have status="seen"
    saved_conv_ids = [
        c["_id"] async for c in db.conversations.find({"kind": "saved"}, {"_id": 1})
    ]
    if saved_conv_ids:
        migration_now = datetime.now(timezone.utc).isoformat()
        res = await db.messages.update_many(
            {
                "conversation_id": {"$in": saved_conv_ids},
                "status": {"$ne": "seen"},
            },
            {"$set": {"status": "seen", "seen_at": migration_now, "delivered_at": migration_now}},
        )
        if res.modified_count:
            logger.info(f"Migration: marked {res.modified_count} saved-message rows as seen")

    # Phase 5B migration — backfill new fields on messages + conversations
    msg_backfill = await db.messages.update_many(
        {"deleted_for": {"$exists": False}},
        {"$set": {
            "reply_to": None,
            "forwarded_from": None,
            "edited": False,
            "edited_at": None,
            "deleted_for": [],
            "deleted_for_everyone": False,
        }},
    )
    if msg_backfill.modified_count:
        logger.info(f"Migration (Phase 5B): backfilled {msg_backfill.modified_count} message rows")
    conv_backfill = await db.conversations.update_many(
        {"pinned_by": {"$exists": False}},
        {"$set": {"pinned_by": [], "muted_by": []}},
    )
    if conv_backfill.modified_count:
        logger.info(f"Migration (Phase 5B): backfilled {conv_backfill.modified_count} conversation rows")

    # Phase 5C migration — starred_by + reactions on messages
    p5c_msg = await db.messages.update_many(
        {"starred_by": {"$exists": False}},
        {"$set": {"starred_by": [], "reactions": []}},
    )
    if p5c_msg.modified_count:
        logger.info(f"Migration (Phase 5C): backfilled {p5c_msg.modified_count} messages with starred_by/reactions")

@app.on_event("shutdown")
async def on_shutdown():
    mongo_client.close()
