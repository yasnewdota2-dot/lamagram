from dotenv import load_dotenv
from pathlib import Path

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

import os
import re
import uuid
import logging
import asyncio
import shutil
from datetime import datetime, timezone, timedelta
from typing import Optional

import bcrypt
import jwt
from fastapi import FastAPI, APIRouter, HTTPException, Depends, UploadFile, File, Request, WebSocket, WebSocketDisconnect, Query
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
MAX_UPLOAD_BYTES = 100 * 1024 * 1024  # 100 MB

USERNAME_RE = re.compile(r'^[a-z0-9_]{3,20}$')

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

@api_router.post("/auth/signup")
async def signup(body: SignupRequest):
    existing = await db.users.find_one({"username": body.username})
    if existing:
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
    return public_user(current_user)

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

    @field_validator("text")
    @classmethod
    def _strip(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("Message text cannot be empty")
        return v

class CreateConversationRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")
    user_id: str

def public_message(m: dict) -> dict:
    return {
        "id": m["_id"],
        "conversation_id": m["conversation_id"],
        "sender_id": m["sender_id"],
        "type": m.get("type", "text"),
        "text": m.get("text", ""),
        "status": m.get("status", "sent"),
        "created_at": m["created_at"],
        "seen_at": m.get("seen_at"),
        "delivered_at": m.get("delivered_at"),
    }

async def public_conversation(c: dict, me_id: str) -> dict:
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
    return {
        "id": c["_id"],
        "participants": c["participants"],
        "other_user": other_pub,
        "last_message": c.get("last_message"),
        "last_message_at": c.get("last_message_at"),
        "created_at": c["created_at"],
        "unread_count": unread,
    }

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
@api_router.post("/conversations")
async def create_or_get_conversation(body: CreateConversationRequest, current_user: dict = Depends(get_current_user)):
    other_id = body.user_id
    if other_id == current_user["_id"]:
        raise HTTPException(400, "Cannot create a conversation with yourself")
    other = await db.users.find_one({"_id": other_id})
    if not other:
        raise HTTPException(404, "User not found")
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
    cursor = db.conversations.find({"participants": current_user["_id"]})
    docs = await cursor.to_list(500)
    out = [await public_conversation(c, current_user["_id"]) for c in docs]
    out.sort(key=lambda x: x.get("last_message_at") or x.get("created_at") or "", reverse=True)
    return out

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
    other_id = next((p for p in conv["participants"] if p != current_user["_id"]), None)
    now = datetime.now(timezone.utc).isoformat()
    initial_status = "delivered" if (other_id and manager.is_online(other_id)) else "sent"
    msg = {
        "_id": str(uuid.uuid4()),
        "conversation_id": conv_id,
        "sender_id": current_user["_id"],
        "type": "text",
        "text": body.text,
        "status": initial_status,
        "created_at": now,
        "seen_at": None,
        "delivered_at": now if initial_status == "delivered" else None,
        "deleted": False,
    }
    await db.messages.insert_one(msg)
    last = {"text": msg["text"], "sender_id": msg["sender_id"], "created_at": now, "type": "text"}
    await db.conversations.update_one(
        {"_id": conv_id},
        {"$set": {"last_message": last, "last_message_at": now}},
    )
    pm = public_message(msg)
    new_payload = {"type": "message_new", "message": pm, "conversation_id": conv_id}
    await manager.send_to_user(current_user["_id"], new_payload)
    if other_id:
        await manager.send_to_user(other_id, new_payload)
        if initial_status == "delivered":
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
    other_id = next((p for p in conv["participants"] if p != current_user["_id"]), None)
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
            await manager.send_to_user(current_user["_id"], payload)
            if other_id:
                await manager.send_to_user(other_id, payload)
    return {"updated": len(targets)}

# ---------------------------------------------------------------------------
# WebSocket — /api/ws
# ---------------------------------------------------------------------------
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
                if other_id:
                    await manager.send_to_user(other_id, {
                        "type": "typing",
                        "conversation_id": conv_id,
                        "user_id": user_id,
                        "is_typing": is_typing,
                    })
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
    await db.users.create_index("username", unique=True)
    await db.conversations.create_index("participants")
    await db.messages.create_index([("conversation_id", 1), ("created_at", 1)])
    await db.messages.create_index([("conversation_id", 1), ("status", 1)])

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

@app.on_event("shutdown")
async def on_shutdown():
    mongo_client.close()
