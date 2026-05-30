# Glass Messenger — Auth Testing Notes

## Flow
1. Signup or Login → returns `{access_token, user}`.
2. Client stores `access_token` in `localStorage["auth_token"]`.
3. Axios interceptor (`/app/frontend/src/lib/api.js`) attaches `Authorization: Bearer <token>` to every request.
4. `AuthProvider` (`/app/frontend/src/lib/auth.jsx`) calls `GET /api/auth/me` on mount; populates `user`.
5. Protected routes (`/`, `/settings`) redirect to `/login` if no user.

## Backend specifics
- Passwords hashed with `bcrypt.hashpw` (cost = default).
- JWT (`HS256`, 7-day expiry) signed with `JWT_SECRET` from `backend/.env`.
- Username regex: `^[a-z0-9_]{3,20}$` (enforced at signup).
- Unique index on `users.username`.
- Avatar uploads saved under `/app/backend/uploads/avatars/`; served at `/api/uploads/avatars/<filename>`.
- Max upload: 100 MB. Image content-type only.

## Quick curl drill
```bash
BASE="${REACT_APP_BACKEND_URL:-http://localhost:8001}"

# Login
TOKEN=$(curl -s -X POST "$BASE/api/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"username":"alice","password":"password123"}' | python3 -c "import sys,json;print(json.load(sys.stdin)['access_token'])")

# Me
curl -s "$BASE/api/auth/me" -H "Authorization: Bearer $TOKEN"

# Update profile
curl -s -X PATCH "$BASE/api/users/me" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"bio":"hello from curl"}'
```
