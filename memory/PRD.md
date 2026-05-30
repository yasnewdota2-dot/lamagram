# Glass Messenger — Product Requirements (PRD)

## Original problem statement
A real-time Telegram-style messenger (FastAPI + React + MongoDB) with a dark glassmorphism design, animated gradient blobs, electric blue + soft purple accents, bilingual EN / Persian (RTL). Username + password auth only. Phase 1 scope: auth + profile + design system.

## Tech stack (locked)
- Backend: FastAPI + Motor (async MongoDB) + JWT (HS256, 7-day) + bcrypt
- Frontend: React 19 + Tailwind + shadcn/ui + framer-motion + axios + react-router 7
- Storage: local FS at `/app/backend/uploads/`, served under `/api/uploads/`
- i18n: lightweight `src/lib/i18n.js` dictionary (EN/FA) + `dir` flip

## User personas
- **Solo user** signing up to chat (Phase 2): cares about a fast, beautiful signup, easily editing profile, switching language.
- **Persian-speaking user**: needs full RTL layout and Vazirmatn font.

## Architecture (Phase 1)
- `server.py` — single FastAPI app, all routes prefixed with `/api`
  - Auth: signup / login / me / logout
  - Users: PATCH `/users/me`, POST `/users/me/avatar`
  - Static: `/api/uploads/avatars/*`
  - Startup: unique index on `users.username`, seed alice/bob/charlie
- React app:
  - `lib/api.js` — axios instance + Bearer interceptor (`localStorage["auth_token"]`)
  - `lib/auth.jsx` — `AuthProvider` (`user`, `login`, `signup`, `logout`, `refresh`)
  - `lib/i18n.js` — `I18nProvider` with EN/FA dicts, sets `document.body.dir`
  - Pages: `Login`, `Signup`, `Home`, `Settings`
  - Components: `GlassBackground` (animated blobs + dot grain), `Avatar`, `LanguageToggle`

## What's implemented (2026-02 — Phase 1)
- [x] `POST /api/auth/signup` — bcrypt, JWT issued, returns `{access_token, user}`
- [x] `POST /api/auth/login` — wrong creds → 401
- [x] `GET /api/auth/me` — Bearer required
- [x] `POST /api/auth/logout`
- [x] `PATCH /api/users/me` — display_name, bio
- [x] `POST /api/users/me/avatar` — image only, max 100MB
- [x] Seed users (alice/bob/charlie · password123) on first boot
- [x] `/api/openapi.json` reachable
- [x] Dark glassmorphism UI w/ animated gradient blobs
- [x] EN/FA i18n with full RTL flip (`dir` + Vazirmatn font)
- [x] Pages: `/login`, `/signup`, `/`, `/settings`
- [x] Token persisted to `localStorage["auth_token"]`, hydration via `/auth/me`
- [x] `/app/memory/test_credentials.md` + `/app/memory/auth_testing.md` written
- [x] 25/25 backend tests + 14/14 frontend e2e flows pass

## Prioritized backlog

### P0 — next phase (Chat)
- WebSocket gateway: `/api/ws` with JWT auth handshake
- Conversation + message Mongo collections
- `GET /api/users/search?q=` (find users by @username)
- `POST /api/conversations` (1-1 + group)
- `GET /api/conversations`, `GET /api/conversations/{id}/messages`
- Real-time message send/receive, typing indicators, delivery + read receipts
- Chat list in sidebar, message thread UI, composer
- Persian messages render correctly (mixed LTR/RTL paragraphs)

### P1
- Online presence broadcast (replace static `is_online` flag)
- Image/file attachments in chat (reuse `/api/uploads`)
- Push-style toasts (use shadcn `sonner`)
- Search across conversations
- Per-conversation mute / pin

### P2
- Group admin actions, invite links
- End-to-end encryption hooks
- Emoji picker + sticker pack
- Voice notes (mic capture + audio playback)
- Dark/light theme switch (currently dark-only by design)
- Refresh tokens / token rotation

## Decisions log
- **No email / no OTP** — username + password only as per spec
- **localStorage Bearer token** (not httpOnly cookies) — explicitly required by spec
- **Single 7-day JWT, no refresh** — Phase 1 scope; revisit in Phase 2
- **Local filesystem uploads** — Phase 1 scope; will migrate to object storage when needed
- **i18n** — lightweight custom dictionary (no react-i18next dependency)
- **Fonts** — Inter (EN), Vazirmatn (FA), both loaded from Google Fonts

## Test credentials
See `/app/memory/test_credentials.md`. Primary: **alice / password123**.
