from dotenv import load_dotenv
from pathlib import Path

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

import os
import re
import uuid
import logging
import shutil
from datetime import datetime, timezone, timedelta
from typing import Optional

import bcrypt
import jwt
from fastapi import FastAPI, APIRouter, HTTPException, Depends, UploadFile, File, Request
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

@app.on_event("shutdown")
async def on_shutdown():
    mongo_client.close()
