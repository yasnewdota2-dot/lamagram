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

## What's implemented (2026-02 — Phase 2 — Real-time 1:1 Chat)
- [x] Mongo collections: `conversations` (sorted participants, embedded last_message), `messages` (status: sent/delivered/seen)
- [x] REST: `GET /api/users/search?q=`, `GET /api/users/{id}`
- [x] REST: `POST /api/conversations` (idempotent), `GET /api/conversations` (with `other_user`, `unread_count`, `last_message`, sorted by `last_message_at` desc)
- [x] REST: `GET /api/conversations/{id}/messages?before=&limit=` (oldest→newest, paginated), `POST /api/conversations/{id}/messages`, `POST /api/conversations/{id}/read`
- [x] WebSocket `/api/ws?token=<jwt>` — JWT auth via query (Bearer header fallback); `ready`, `message_new`, `message_status`, `typing`, `presence`, `ping`/`pong`; in-process `ConnectionManager`
- [x] Status transitions: `sent` → `delivered` (recipient WS-connected, or on next WS connect) → `seen` (recipient calls `/read`)
- [x] Presence broadcast on connect/disconnect to all conversation partners; `is_online`/`last_seen` persisted on `users`
- [x] Typing indicator relayed server-side to other participant only
- [x] Seed 2 demo conversations on first boot (alice↔bob: 4 msgs, alice↔charlie: 2 msgs), all status=seen
- [x] Frontend `MessengerProvider` (WS lifecycle, reconnect with exponential backoff up to 30s, 25s heartbeat, state for conversations/messages/typing/presence)
- [x] Full messenger UI in `/`: sidebar (own profile, debounced search, conversation list with unread badges, online dots) + ChatPanel (header with presence + typing indicator, message thread with grouping <2min, gradient mine bubbles + neutral theirs, ticks inside bubble, composer with typing relay)
- [x] RTL bubble alignment flips correctly in Persian
- [x] 25/25 Phase 2 backend tests pass + frontend e2e verified (single-tab UI + cross-user real-time via REST simulation)

## What's implemented (2026-02 — Phase 3 — Media, Voice, Emoji, Polish)
- [x] `POST /api/messages/upload` (multipart): image / video / file / voice; conversation_id + kind + file (+ duration_sec + waveform for voice). 100 MB cap; mime whitelist; participant validation; 400/403/404/413 error contracts. Pillow extracts image width/height. Storage: `/app/backend/uploads/media/{yyyy}/{mm}/{uuid}.{ext}`, served at `/api/uploads/media/...`.
- [x] Message schema extended: `type` ∈ `text|image|video|file|voice`; `media: {url, mime, size_bytes, file_name, width?, height?, duration_sec?, waveform?}`. `conversation.last_message` now carries `type`, `media_label_key`, `file_name`, `duration_sec`.
- [x] WS broadcasts `message_new` + `message_status:delivered` for media uploads (same path as text)
- [x] Frontend `MessengerProvider.uploadMedia(convId, file, opts)`: optimistic ghost bubble with `_progress` (axios `onUploadProgress`), replaced with real message on success or marked `failed` on error. `document.title` syncs to `(N) Glass` when unread > 0.
- [x] Composer with Paperclip/Smile/Mic buttons; emoji-picker-react popover (dark theme, search), inserts at cursor; Send icon replaces mic when textarea has content.
- [x] VoiceRecorder: MediaRecorder + AnalyserNode sampling @ 10 Hz → downsampled to 40-bucket waveform; produces audio/webm blob + duration_sec.
- [x] MediaContent renderers: ImageContent (rounded thumb, click → Lightbox), VideoContent (HTML5 `<video controls>`), FileContent (glass card with icon, name, human size, download), VoiceContent (play/pause + animated waveform with playback progress + mm:ss duration).
- [x] MessageBubble: per-type rendering; image/video/file have time+ticks overlay on bubble; emoji-only messages (1-3 emojis) render at text-[3rem] (Telegram-style).
- [x] Lightbox modal (Esc / X / outside-click to close), glass backdrop blur.
- [x] ChatPanel: drag-drop file upload with glass overlay ("Drop file to send"); scroll-to-bottom pill ("N new messages") when scrolled away from bottom; toast for upload errors / file-too-large; "👋 Say hi to {name}" empty state.
- [x] ChatList: localized last_message preview for media — `📷 Photo`, `🎬 Video`, `📎 {file_name}`, `🎤 Voice {Ns}` with EN+FA strings.
- [x] i18n EN+FA additions: photo, video, file, voice, recording, micDenied, dropFile, fileTooLarge, uploadFailed, unsupportedType, searchEmoji, sayHi/sayHiSub, newMessages.
- [x] 13 new backend tests + 49 regression all pass; frontend Playwright verified composer buttons, image upload + WS receive within 2 s, lightbox open/close, emoji-big rendering (48 px), document.title sync, localized sidebar preview, voice recorder UI.

## Prioritized backlog

### P0 — next phase (Phase 4: collaboration)
- Reply / quote a message inline
- Forward to another conversation
- Message delete (sender) / edit (text only)
- Group chats (3+ participants)

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
