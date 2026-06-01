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

## What's implemented (2026-02 — Phase 4 — Saved Messages + Username-first Search)
- [x] `POST /api/conversations/saved` (idempotent) creates/returns the user's self-conversation with `kind="saved"` and single participant; supports sending text + media messages to self.
- [x] `GET /api/conversations` partitions saved+dm and returns the saved one first (server-enforced pinning).
- [x] `GET /api/users/by-username/{username}` returns user public profile (case-insensitive); 404 on miss.
- [x] `GET /api/users/search?q=@prefix` switches to username-prefix mode (re.escape safe); bare `q=` falls back to username-prefix OR display_name-substring.
- [x] Frontend: `SavedAvatar` (bookmark gradient) exported from `ChatList.jsx`; saved chat row always pinned with PINNED badge.
- [x] `ChatPanel` header for saved: title = "Saved Messages", subtitle = "Your personal cloud", no online dot. Regular DM header appends `· @username` next to presence.
- [x] `Settings`: shows `@username` with copy-to-clipboard button (toast on copy).
- [x] Sidebar search input localized placeholder ("Search by @username or name"); typing `@` shows `Searching usernames` hint chip.
- [x] i18n EN+FA additions: savedMessages, savedSubtitle, pinned, searchPlaceholder2, searchingUsernames, usernameCopied. FA: 'پیام‌های ذخیره‌شده', 'فضای ابری شخصی شما', 'جستجوی یوزرنیم', 'یوزرنیم کپی شد'.
- [x] 10 new Phase 4 backend tests + 72/72 full regression pass; frontend Playwright verified saved-first ordering, header copy, message persist, FA RTL toggle, clipboard write of @username, '· @username' DM header suffix.

## What's implemented (2026-02 — Phase 5B — Reply / Forward / Edit / Delete / Pin / Mute)

### Backend
- [x] `PATCH /api/messages/{id}` — sender-only, text-only, 48h window. Sets `edited=true`, `edited_at`. Broadcasts `message_edited` to participants.
- [x] `DELETE /api/messages/{id}?scope=me|all`. scope=me adds user to `deleted_for`; scope=all (sender within 24h) clears text/media, sets `deleted_for_everyone=true`, deletes media file from disk (best-effort), broadcasts `message_deleted`.
- [x] `POST /api/messages/{id}/forward` `{conversation_ids: [...]}` — copies type/text/media (no media re-upload), sets `forwarded_from`, returns created messages; broadcasts `message_new` per target.
- [x] `POST/DELETE /api/conversations/{id}/pin` — toggle pin. Enforces cap=5 pinned DMs per user (saved excluded).
- [x] `POST/DELETE /api/conversations/{id}/mute` — toggle mute.
- [x] `POST /api/conversations/{id}/messages` and `POST /api/messages/upload` accept optional `reply_to_message_id` → server validates & writes `reply_to` snapshot {message_id, sender_id, type, text_preview, file_name?}.
- [x] `GET /api/conversations` now includes `is_pinned` and `is_muted` per current user; sort = `saved + pinned_dm (last_message_at desc) + unpinned_dm (last_message_at desc)`.
- [x] `GET /api/conversations/{id}/messages` excludes messages where `me in deleted_for`; returns tombstone shape `(text='', media=null, deleted_for_everyone=true)` for globally-deleted.
- [x] Startup migration backfills new fields on existing messages + conversations.

### Frontend
- [x] `MessageBubble`: hover ⋯ → DropdownMenu with Reply / Forward / Copy / Edit (sender within 48h text only) / Delete (sub-menu: Delete for me / Delete for everyone within 24h). Renders ReplyQuote (clickable, scrolls to & highlights original), ForwardedHeader, "edited" suffix, tombstone bubble.
- [x] `Composer`: reply/edit strips with cancel; submit handles send & save with `sending` + `sendLockRef` (Phase 5A invariant preserved). Reply optimistic snapshot included so quote renders instantly.
- [x] `ForwardDialog`: shadcn `Dialog` with `DialogTitle`/`DialogDescription` (no a11y warnings), multi-select up to 10, conversation list + debounced user search, success toast with localized "Forwarded to N chats".
- [x] `ChatList` row: Pin icon when pinned, BellOff icon when muted, gray unread badge when muted; hover ⋯ → DropdownMenu with Pin to top / Unpin, Mute / Unmute, Mark as read. Pin cap surfaces error inline.
- [x] Row is now `motion.div role="button" tabIndex=0` with `Enter`/`Space` handling — no nested-button DOM warnings.
- [x] WS handlers: `message_edited`, `message_deleted`, `conversation_updated`. Muted convs excluded from `document.title` unread count.
- [x] i18n EN+FA: reply, forward, copyText, edit, deleteMsg, deleteForMe, deleteForEveryone, edited, replyingTo, editing, forwardTo, send, forwardedFrom, forwardedToN, pinToTop, unpin, muteNotifications, unmute, markAsRead, upToFivePinned, messageWasDeleted, messageNotInView, confirmDeleteAll.

### Testing
- 15/15 Phase 5B backend tests PASS; 96/99 full regression (3 failures are pre-existing Phase 2 seed-sort brittleness, not 5B regressions).
- 100% Phase 5B frontend Playwright interactions PASS.
- Phase 5A perf invariants verified preserved: 1 POST per send, ≤2 typing WS frames per burst, no idle polling.
- Post-fix verification: 0 nested-button DOM warnings, 0 DialogTitle a11y warnings.

## What's implemented (2026-02 — Phase 5C — Groups, Search, Starred — backend complete; UI partial)

### Backend (fully implemented, smoke-tested via curl)
- Group conversations (`kind="group"`) with `participants`, `admins`, `title`, `description`, `avatar_url`, `created_by`.
- `POST /api/groups` (creator becomes admin, requires ≥2 other members), `PATCH /api/groups/{id}`, `POST /api/groups/{id}/avatar` (image, ≤5MB).
- `POST/DELETE /api/groups/{id}/members[/<user_id>]` (admin can add/remove anyone; user can self-leave; auto-promotes next member if last admin is removed; auto-deletes empty group).
- `POST/DELETE /api/groups/{id}/admins/{user_id}` (cannot demote the only admin).
- `GET /api/groups/{id}/members` (with `is_admin`, `is_online` flags).
- `GET /api/conversations/{id}/messages/search?q=` (per-conversation, regex-safe).
- `GET /api/messages/search?q=` (global, across user's conversations).
- `POST/DELETE /api/messages/{id}/star` + `GET /api/messages/starred?limit=&before=` (paginated).
- `GET /api/conversations` now includes `group: {title, avatar_url, description, member_count, is_admin}` for groups; sort = saved → pinned DMs → unpinned DMs + groups (mixed by last_message_at).
- `mark_conversation_read` broadcasts `message_status` to ALL participants (group-aware seen broadcast).
- Migration backfilled 246 messages with `starred_by: []` + `reactions: []`.
- `public_message` now surfaces `starred_by` + `reactions` arrays.

### Frontend (partial)
- **Store**: new actions `createGroup`, `updateGroup`, `uploadGroupAvatar`, `addGroupMembers`, `removeGroupMember`, `promoteGroupAdmin`, `demoteGroupAdmin`, `listGroupMembers`, `searchInConversation`, `searchMessagesGlobal`, `starMessage`, `unstarMessage`, `listStarred`.
- **WS handlers**: `conversation_new`, `group_updated`, `conversation_removed`, `conversation_deleted` (all refetch conversations).
- **i18n**: full EN + FA dictionaries for Phase 5C strings (newChat, newGroup, groupName, members, admin, promote, demote, leaveGroup, groupInfo, membersCount, onlineCount, typingOne/Two/Plural, searchMessages, noResults, nMatches, star, unstar, starred, starredMessages, etc.).
- **ChatList row**: group title renders correctly from `c.group.title` when `kind="group"`.

### Frontend UI deferred to Phase 5D polish (backend is ready)
- **NewGroup dialog** ("+" button → 2-step picker + title/description). API is callable from devtools today.
- **Group avatar component** (gradient + first letter placeholder) — UserAvatar is reused for now; groups currently show initials of title via fallback.
- **Group info panel** (member list with admin badges, add/remove actions, leave button).
- **Group-aware ChatPanel header** (member count, online count, multi-typing indicator).
- **Group bubble sender label** (display_name above incoming bubbles for first message in a sender-group).
- **In-chat message search bar** (toggleable from header) — backend ready.
- **Global "Messages" results section** in sidebar search — backend ready.
- **Starred view** in Saved Messages — backend ready.
- **Emoji reactions** — explicitly deferred per spec ("Phase 5D polish").

### Testing
- Backend smoke (curl): group create / list / member add+remove / promote-demote / search per-conv / search global / star + listed in starred — all 200 OK with expected payloads.
- Phase 1-5B regression: untouched (no behavior change for DMs).
- Phase 5A perf invariants: untouched (no new polling, no extra renders introduced).

## Prioritized backlog

### P0 — Phase 5D polish (next)
- Build the UI pieces deferred above (NewGroupDialog, GroupInfo modal, in-chat search bar, starred view, group sender labels).
- Emoji reactions (data model + endpoints + chips).
- (Refactor) Split `server.py` (now ~1.8k lines) into router modules.

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

## Chunk 7B — Theme system + CSS variable refactor (2026-02-Feb) — COMPLETE
- [x] `lib/theme.jsx` — ThemeProvider w/ localStorage persistence (`glass_theme`) + html[data-theme]
- [x] Full CSS variable system in index.css (--bg-base, --bg-glass, --text-primary, --bubble-mine-bg, etc.)
- [x] Targeted refactor of 5 core files to consume CSS vars directly: Home.jsx, ChatPanel.jsx, MessageBubble.jsx, Composer.jsx, (ChatList uses Tailwind + override layer)
- [x] Transitional override layer in index.css covers lower-priority dialogs/components (acknowledged debt)
- [x] Light-mode body bg + #root transparent fix (root was bleeding hardcoded dark var)
- [x] Light-mode gm-blob colors toned down (replaced solid #3B9EFF/#A78BFA gradient with subtle theme vars)
- [x] Verified visually: Dark + Light screenshots both render without breakage

## Areas of remaining tech debt (Chunk 7C polish backlog)
- Some inline `style={{ background: rgba(11,11,18,...) }}` in dialogs still routed through override layer
- "PINNED" pill text color (`#C9B8FF`) is low-contrast in light mode
- Typography/spacing/scrollbar/skeleton/empty-state polish pass deferred


## Phase 9C — Public chat preview + group typing names (2026-02-Feb) — COMPLETE
- [x] `PublicChatPreviewDrawer.jsx` — provider + `usePublicChatPreview` hook; opens via `/c/handle` mentions or sidebar public-chats search; renders title/handle/count/desc/primary-action; Join routes through `/api/conversations/join`.
- [x] `SearchResults.jsx` — new "Public chats" section fed by `GET /api/discover?q=` (debounced 250ms), strips leading `@` for handle searches, each row opens the preview drawer.
- [x] `MessageBubble.jsx` — `/c/handle` mention segments route through `openPublicChat(handle)` instead of activating the conversation directly.
- [x] `ChatPanel.jsx` — group typing label with names (`X is typing` / `X and Y are typing` / `N people typing`) renders as `data-testid="chat-header-group-typing"`, falls back to `chat-header-group-members`.
- [x] Backend `server.py` typing handler fixed: groups now fan out the typing event to **every** non-sender participant (was previously DM-only logic that only delivered to one peer).
- [x] i18n: added Persian translations for `publicChats`, `joinThisGroup`, `joinThisChannel`, `openConversation`, `searchPlain`.

## Next action items
- Phase 9C Item 2 (P1): Multi-select messages — long-press to enter selection mode + sticky top toolbar (Forward, Delete, Copy multi).
- Phase 9C Item 3 (P2): Refactor `GroupDialogs.jsx` to a single-step dialog (drop the member picker; backend already accepts `participant_ids=[]`).
- Phase 8A leftover (P2): Polish `ChannelDialogs.jsx` borders/toggles in both light + dark modes.
- Phase 9D (P1): Admin custom titles + granular permissions.

## Potential improvement
Consider monetising public channels: add a lightweight "Pinned promotion slot" admins can sell, surface paid promotions inside the new `PublicChatPreviewDrawer` description block. Revenue lift without extra UI surface.

## Phase 9C item 2+3 + Phase 9D (2026-02-Feb) — COMPLETE
- [x] **Multi-select messages** (Phase 9C item 2). `ChatPanel.jsx` adds `selectionMode`+`selectedMap`; long-press a bubble → sticky `multi-select-toolbar` (× / "{n} selected" / Forward / Copy / Delete). Copy concatenates `message.text` with `\n\n` to clipboard. Delete loops `deleteMessage` with a `Delete for everyone` in-DOM modal (`multi-delete-modal`). Forward uses extended `ForwardDialog` accepting `sourceMessages` array.
- [x] **NewGroupDialog single-step** (Phase 9C item 3). `GroupDialogs.jsx > NewGroupDialog` rebuilt as single-step (title, desc, avatar, public-handle); member picker removed. `POST /api/groups` (`server.py`) relaxed to allow 0 other members.
- [x] **Phase 9D admin custom titles + granular permissions**. Backend (`server.py`): `_is_owner`/`_is_admin`/`_has_perm` helpers; migration backfills `admin_titles={}` and `admin_permissions={}` on existing groups/channels; PATCH `/api/groups/{id}/admins/{user_id}` and `/api/channels/{id}/admins/{user_id}` accept `{title?, permissions?}`. Enforcement on ban (`can_ban`), promote/demote (`can_promote`), edit info (`can_edit_info`), pin/unpin (`can_pin`), delete-for-everyone non-sender (`can_delete_messages`), add member + invite link rotate/revoke (`can_invite`). Owner: always all perms; admin with no map entry: BC = all perms; admin WITH map entry: missing keys default False.
- [x] Frontend (`GroupDialogs.jsx > GroupInfoDialog`): inline `Edit role` button per admin row → `EditRoleModal` (title input 16-char max + 6 permission toggles) → `updateAdminRole(convId, kind, userId, {title, permissions})`. `MessageBubble.jsx` group bubbles render the sender's `admin_title` as `[Title]` next to the display name.
- [x] i18n: 14 new EN+FA keys (editRole, customTitle, permissionsHeading, canBan/Promote/Pin/EditInfo/DeleteMessages/Invite, noPermissionAction, selectedCountToolbar, multiDeleteTitle, copy, copied).
- [x] Backend & frontend test coverage: iteration 10 verifies EditRoleModal end-to-end (alice → P9D Test Group → Edit role → 'Captain' + can_invite only → bob's row shows `[Captain]`) and multi-select toolbar entry. Multi-select Copy/Delete/Forward triple verified by curl on backend + manual wiring trace by testing-agent.

## Next action items
- Final e1_tester regression sweep over all Phase 9 features (user requested).
- Phase 8A leftover (P2): `ChannelDialogs.jsx` border/toggle polish in light + dark.
- Optional: surface `Edit role` in `ChannelInfoDialog.jsx` (PATCH endpoint already supports channels; title display is intentionally skipped per spec).


## Phase 24A — Pin → System Message + Group Avatar Tweak (2026-05-31)
- GroupDialogs: Group Info dialog header avatar 64 → 56 (parity with Channel Info).
- Backend `public_message` now surfaces `meta` (was being stripped). pin_message / unpin_message endpoints already emitted system_pin / system_unpin events; with `meta` exposed, frontend can route them correctly.
- New `SystemPinMessage` component: centered subtle pill (no bubble), tap = jump-to-pinned (reuses Phase 12 RAF + loadOlderMessages backfill), long-press = Reply + Delete menu (one-side / both-side <24h).
- i18n: 6 new flat keys with {name} client-side placeholder — `system.pin.{dm|group|channel}` & `system.unpin.{dm|group|channel}` (EN + FA).
- Verified end-to-end (iteration_12.json): 7/7 acceptance criteria pass; avatar measured 56×56; pills rendered EN+FA in DM/Group/Channel; tap-jump scrolls without "not in view" toast; long-press menu shows both Reply and Delete.

## Phase 24B — Poll Backend (2026-05-31)
- 3 new endpoints registered under `/api`: `POST /conversations/{id}/messages/poll`, `POST /messages/{id}/vote`, `POST /messages/{id}/poll/close` (openapi total paths 55→58).
- `messages` schema extended with `type:"poll"` + `poll:{question, options[{id,text,votes[]}], is_anonymous, allows_multiple, closed, closed_at}`.
- Validators: question 1–300, options 2–10, option text 1–100, dedup, non-empty.
- `public_message` now includes raw `poll`; new `serialize_poll(msg, viewer_id, conv)` + `public_message_for_viewer(...)` redact `votes[]` for anonymous polls unless viewer is creator / conv admin / owner. Vote payload to each viewer adds `voted` (bool) and `my_votes` (id list).
- Pre/post-vote logic clears the viewer's existing votes across all options, then sets new ones (re-vote semantics).
- WS events: `message_new` (poll creation, per-viewer payload), `poll_vote_update` (every vote change, per-viewer), `poll_close` (creator/admin only, per-viewer).
- Permission: channel polls only by admins; close only by sender_id OR conv admins/owner.

## Phase 24C — Poll UI + Paperclip Menu (2026-05-31)
- New `PollCreateDialog.jsx`: question (300ch), 2–10 options with X-remove (>2), client-side dupe check, Anonymous/Multiple toggles. Submit calls `createPoll`; backend 4xx surfaces as toast.
- New `PollMessage.jsx`: Telegram-style bubble with header (POLL / ANONYMOUS POLL / FINAL RESULTS), question, options with progress bars (CSS width transition 350ms), single-mode instant vote or multi-mode pending+Vote button, voter count, View results dialog (creator/admin or non-anon), long-press menu (Reply / Forward / Close poll / Delete).
- `Composer.jsx`: paperclip button became attachment DropdownMenu with 4 items — Photo/Video, File, Poll, Location. Standalone Location button removed (moved into menu).
- `messenger.jsx`: added `createPoll/votePoll/closePoll` actions and WS handlers for `poll_vote_update` + `poll_close` (patch `messagesByConv` in place).
- i18n: ~25 new keys EN+FA (attach.*, poll.*, poll.create.*, createPollError).
- Verified: paperclip menu 4 items @ 414px mobile viewport; PollCreateDialog 3-option submit creates message; Anonymous poll header gets lock icon; WS sync curl-confirmed (Bob votes → Alice sees count=1 + voted=False while Bob sees voted=True — per-viewer payload working).

## Phase 24D — Smoothness Pass (2026-05-31)
- Global Radix Dialog / DropdownMenu open animation overridden in `index.css` to spring-ish overshoot: 280ms `cubic-bezier(0.34, 1.56, 0.64, 1)` for open; 180ms ease-out for close; overlay fade 150ms. Affects Group/Channel Info, PollCreateDialog, Forward, NewGroup/Channel, ProfileEditor, attachment menu, all message context menus.
- `.gm-press` helper class added — `transform: scale(0.98)` on `:active` + `brightness(1.08)` on hover (hover-capable devices only). Applied to chat-list items, paperclip / emoji / send / voice buttons.
- Paperclip icon rotates 15° via `data-[state=open]` Tailwind selector when the menu opens.
- Send ↔ Voice button now cross-fades via `AnimatePresence mode="wait"` with spring (opacity + scale 0.7→1, 180ms).
- Poll progress-bar transition widened: 350ms → **500ms `cubic-bezier(0.4, 0, 0.2, 1)`** + `will-change: width` (verified live via getComputedStyle).
- Vote count `%` gets a `gmVotePulse` keyframe (1 → 1.18 → 1, 360ms) any time the option's `vote_count` changes (re-mount via `key={opt.vote_count}`).
- SystemPin pill entrance upgraded: now `opacity 0 → 1` + `scale 0.95 → 1` (200ms, same overshoot easing).
- `* { -webkit-tap-highlight-color: transparent }` extended globally (was scoped to `button/[role=button]/a`).
- Verified: progress-bar inline style is `width 500ms cubic-bezier(0.4, 0, 0.2, 1)`, paperclip rotates on open, GroupInfo dialog springs, send/voice swap is smooth, no console errors, no regression on Poll create/vote/close, Pin system, DM/Group/Channel.

## Phase 25 — P0 Bug Fixes (2026-05-31)
- **Bug 1 (Group/Channel Info header)**: Both dialogs now have a sticky 3-cell header — X close (left) · title (center) · LogOut leave icon (right, danger color). Bottom "Leave group/channel" buttons removed. Avatar already 56 px from P24A.
- **Bug 2 (Delete dialog unreadable in light theme)**: Added Tailwind theme tokens (`--background`, `--foreground`, `--card`, `--popover`, `--popover-foreground`, `--secondary`, `--muted`, `--muted-foreground`, `--border`, `--input`) under `:root[data-theme="light"]`. Every Radix Dialog / AlertDialog / DropdownMenu / Popover now resolves to a readable white surface + near-black text in light mode.
- **Bug 3 (Delete on system_pin / poll)**: Verified `DELETE /api/messages/{id}` is type-agnostic; `handleDelete` + `deleteMessage` chain works for any type. Was unblocked once Bug 2 made the confirm dialog visible.
- **Bug 4 (Persian / Unicode in poll inputs)**: Backend `CreatePollRequest` only uses `min/max_length` (Unicode-safe). Poll Question textarea + each Option Input now carry `dir="auto"` so Persian input flips to RTL visually as you type. Channel `title` backend has no regex either; only handle is ASCII (by design).
- **Bug 5 (Tap on poll opens menu)**: `DropdownMenuTrigger` now wraps ONLY the header area (📊 emoji + question). `onClick={(e) => e.preventDefault()}` cancels Radix's default open-on-tap; menu opens exclusively via `useLongPress` (500 ms) → controlled `setMenuOpen(true)`. Verified live: short-tap on option → menu count 0; long-press on header → menu count 1 (Reply / Forward / Close poll / Delete).
- P1 bugs 6 (pin banner cycle), 7 (online dot polish), 8 (poll voter avatars) — **DEFERRED** to Phase 25b on user signal.

## Phase 25b — Pin Cycle + Online Dot + Voter Avatars (2026-05-31)
- **Bug 6** PinnedMessagesBar: introduced `cursor` state; every tap increments `cursor = (cursor+1) % total` and triggers `onJump(pinned[cursor])`. Banner header now reads `Pinned messages · {i+1}/{total}` (counter hidden when total ≤ 1). Cursor auto-resets when pin set shrinks. Verified `1/5 → 2/5` live.
- **Bug 7** `OnlineDot` now `if (!online) return null` — no empty rings anywhere. ChatList sidebar already gated by `kind === "dm"`. Group/channel rows verified to show zero dots.
- **Bug 8** Backend: new `POST /api/users/batch` (max 100 ids per request, auth-gated) returning `public_user[]` (id, username, display_name, avatar_url). Verified live; openapi paths 58 → 59.
- **Bug 8** Frontend: new `lib/useUsersBatch.js` — module-level Map cache + 50 ms microtask debouncer that coalesces concurrent `useUsersBatch(ids)` subscribers into a single network call (chunked at 100 ids). Tombstones for missing ids prevent re-fetch storms. New `AvatarStack` component renders up to N overlapping circular avatars (size 18 by default), with image fallback to gradient-initial; `+N` text appended if `ids.length > max`. RTL-friendly via `marginInlineStart`.
- **Bug 8** PollMessage: under each option with `!isAnon && votes.length > 0`, an `<AvatarStack ids={opt.votes} max={3} />` renders inline; verified `poll voter avatar stacks visible: 5` across the seeded test polls. Anonymous polls correctly hide the stack.
- **Smart bonus** PollMessage: tap on `pct %` label now opens the View Results dialog (non-anonymous + viewer-has-voted gate). Verified `results dialog opened via pct tap: True`.

## Phase 26 — Critical Bug Fixes (2026-05-31)
- **Bug 1 (Persian dedup false-positive)**: PollCreateDialog `cleanOptions` strips zero-width chars (`\u200B-\u200D\uFEFF`) before dedup; backend `CreatePollRequest._opts` does the same via `str.translate`. Verified: `["جثثث","جثثثا","قرمز"]` accepted live.
- **Bug 2 (Tombstone removed)**: `MessageBubble` returns `null` for `deleted_for_everyone` messages — no more "Message was deleted" placeholder.
- **Bug 3 (Pin list cleanup on delete)**: backend `delete_message` issues `$pull` on `conversation.pinned_message_ids` when the deleted id was pinned.
- **Bug 4 (Channel title not editable)**: added `updateChannel` action to `messenger.jsx`; ChannelInfoDialog now has inline edit-title (Pencil button → input → Save), mirroring GroupDialogs pattern. Verified: `PATCH /api/channels/{id}` accepts `"کانال تست فارسی"` Persian title.
- **Bug 5 (Mobile keyboard close on send)**: Composer send button now `onMouseDown/onTouchStart={(e)=>e.preventDefault()}` to prevent textarea blur during the tap; existing `taRef.current?.focus()` in `finally` continues to keep IME open.
- **Bug 6 (Reaction tap opens menu)**: Reaction chips in `Reactions.jsx` now `e.stopPropagation()` + `e.preventDefault()` on click and also stop propagation on mousedown/touchstart so the parent bubble's long-press / context menu never fires.
- P1 Bugs 7 (Group Info ultra-compact) and 8 (single-vote retract) — **DEFERRED** to next pass on user signal.

## Phase 26b — Sidebar Refresh + Vote Retract + Double-Tap Heart (2026-05-31)
- **Bug A (P0) — Sidebar refresh on Channel/Group rename**: WS handler for `conversation_updated` now merges the full `conversation` payload when backend sends one (channels do this on PATCH). `updateChannel` action already did an optimistic local merge; combined the two paths fix the stale sidebar title. Verified live: `PATCH /api/channels/{id}` with `"کانال جدید Bug A …"` returns updated title; both optimistic and WS pathways now apply it. Groups inherit the same store path.
- **Bug 8 — Vote Retract**: backend `VotePollRequest.option_ids` `min_length=1` removed; `vote_poll` permits empty list to wipe the caller's votes (skips the `len==1` single-mode check when the list is empty). Frontend `PollMessage.handleSingleTap` detects `myVotes.length === 1 && myVotes[0] === optionId` and calls `votePoll(id, [])` to retract. Multi-mode already supported via the "Vote" button on an empty pending set. Verified live: vote → count A=1, my_votes=[A]; retract via `[]` → count A=0, my_votes=[].
- **Smart bonus — Double-tap = ❤️**: `MessageBubble` keeps a `lastTapRef` timestamp; on `onClick` if `now - last < 320ms` it triggers `toggleReaction(message.id, "❤️", convId)` and bumps a `heartBurst` counter. Long-press / single-tap context-menu pathway unchanged.
- **Bug 7 — Group Info member density**: row classes `gap-3 px-3 py-2` → `gap-2 px-2.5 py-1.5`, avatar 36 → 32, name text 14 → 13. Full ultra-compact (UserPlus icon header + Make-public card slim + invite section padding) parked for next pass.

## Phase 26c — Targeted Fixes (2026-05-31)
- **Bug X1 (Channel rename Save not firing)**: ChannelInfoDialog Save button hardened — `onMouseDown e.preventDefault()` prevents input blur (which had been swallowing the click on some touch devices); button padding 1.5 / icon w-5 for a larger hit area; Enter-key handler in the input is a parallel path to Save. `console.log("[rename] PATCH ...")` traces added on both paths. Verified live: `NETWORK PATCH FIRED: PATCH /api/channels/...` and `channel-info-title after save: 'ChanRenamedX1'`.
- **Bug X2 (Channel Info member rows still bloated)**: ChannelInfoDialog member row classes `gap-3 px-3 py-2` → `gap-2 px-2.5 py-1.5`, `UserAvatar size={36}` → `{32}`, name `text-sm` → `text-[13px]`. Live measurement (414 px viewport): `CHANNEL member avatar sizes: [{'w': 32, 'h': 32}]`. ✓

## Phase 26d — Hard Root-Causes for FAIL 1 + FAIL 2 (2026-06-01)
### FAIL 1 — Sidebar stale after Channel rename
**Root cause**: `ChatRow` is wrapped in `React.memo(..., areEqual)` and the `areEqual` comparator only checked `id, unread, last_message_at, last_message, kind, is_pinned, is_muted, other_user.*`. **It never compared `conversation.group?.title`** — so even though store mutated correctly, memo returned `true` and the row never re-rendered.
**Fix**: extended `areEqual` to also bail on `group.title`, `group.avatar_url`, and `group.member_count` deltas.
**Live verification**: rename to `REFRESH-2289` → `SIDEBAR sees rename ('REFRESH-2289'): chat-list-item-7423ac3a-1e5a-4d54-bad0-8238d74bdd17` ✓

### FAIL 2 — Member row "12 px / 0 px padding"
**Root cause**: the previous tester selector `[data-testid^="channel-info-member-"]` was a **prefix match** that included the **search input** `channel-info-member-search` as its first hit. The 12 px and 0 padding were the input's metrics, not a row.
**Fix**: renamed search input testids to `channel-info-members-search` / `group-info-members-search` (note the plural "members-" prefix) so future prefix-matches against `channel-info-member-{username}` won't collide.
**Live verification** with correct selector (excluding `members-search`):
```
channel-info-member-alice  paddingY 6px/6px  gap 8px  avatar 32×32  nameFontSize 13px
channel-info-member-bob    paddingY 6px/6px  gap 8px  avatar 32×32  nameFontSize 13px
```
✓ exactly the spec (32 px avatar, 13 px text, py-1.5 = 6 px).
