# Glass Messenger — Test Credentials

## Auth Type
- **JWT Bearer** via `POST /api/auth/login`
- Token storage on frontend: `localStorage` key = `auth_token`
- Header on protected calls: `Authorization: Bearer <token>`
- Token expiry: 7 days

## Seed Users (already created on first boot)
| Username | Password      | Display name |
|----------|---------------|--------------|
| alice    | password123   | Alice        |
| bob      | password123   | Bob          |
| charlie  | password123   | Charlie      |

> Primary test account: **alice / password123**

## Seed Conversations (created on first boot)
- alice ↔ bob: 4 sample messages, all status=seen
- alice ↔ charlie: 2 sample messages, all status=seen

## Real-time testing
Real-time features (live message delivery, ticks, typing, presence) require **two browser sessions** simultaneously. Suggested pair: log in as **alice** in one browser and **bob** in another (or use two incognito windows).

## How to obtain a token (curl)
```bash
BASE="${REACT_APP_BACKEND_URL:-http://localhost:8001}"
curl -s -X POST "$BASE/api/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"username":"alice","password":"password123"}'
```

## How to inject token in the UI (for Playwright / browser tests)
```js
// 1) Login via API to grab token, then:
localStorage.setItem("auth_token", "<jwt>");
// 2) Navigate to "/" — AuthProvider calls /api/auth/me on mount and hydrates user.
// 3) MessengerProvider auto-opens WebSocket and fetches conversations.
```

## WebSocket
- URL: `wss://<host>/api/ws?token=<jwt>`
- Server-pushed events: `ready`, `message_new`, `message_status`, `typing`, `presence`, `pong`
- Client→server events: `typing` (with `conversation_id`, `is_typing`), `ping`

## Endpoints
- `POST /api/auth/signup`, `POST /api/auth/login`, `GET /api/auth/me`, `POST /api/auth/logout`
- `PATCH /api/users/me`, `POST /api/users/me/avatar`
- `GET  /api/users/search?q=`, `GET /api/users/{id}`
- `POST /api/conversations` (idempotent), `GET /api/conversations`
- `GET  /api/conversations/{id}/messages?before=&limit=`
- `POST /api/conversations/{id}/messages`
- `POST /api/conversations/{id}/read`
- `GET  /api/openapi.json`
- WebSocket: `/api/ws`
- Static avatars: `GET /api/uploads/avatars/<filename>`
