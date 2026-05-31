import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
} from "react";
import { api, API_BASE, TOKEN_KEY } from "./api";
import { useAuth } from "./auth";

/* -------------------------------------------------------------------------
 * External subscription store
 *
 * Why: a single React Context value re-renders every consumer on every state
 * change ("fan-out"). With WebSocket presence/typing events arriving at high
 * frequency, that crushed render perf. The store below holds the
 * conversations/messages/typing/presence/activeConvId fields outside React.
 * Components subscribe to ONLY the slice they need via useSyncExternalStore.
 * Actions (sendMessage, etc.) are stable refs returned from MessengerProvider.
 * ------------------------------------------------------------------------- */

const EMPTY_ARRAY = Object.freeze([]);
const EMPTY_OBJECT = Object.freeze({});

const initialState = {
  conversations: [],
  messagesByConv: {},
  typingByConv: {},
  presence: {},
  activeConvId: null,
  wsConnected: false,
  // Phase 5B — per-conversation composer state
  composerByConv: {}, // { [convId]: { replyTo: msg|null, editTarget: msg|null } }
  // Phase 5D — cached group members by conversation_id (userId -> public_user)
  groupMembersByConv: {},
};

const createStore = (initial) => {
  let state = initial;
  const listeners = new Set();
  return {
    get: () => state,
    set: (patch) => {
      const next = typeof patch === "function" ? patch(state) : { ...state, ...patch };
      if (next === state) return;
      state = next;
      listeners.forEach((l) => l());
    },
    subscribe: (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };
};

const store = createStore(initialState);

const useStoreSlice = (selector) =>
  useSyncExternalStore(store.subscribe, () => selector(store.get()));

/* ---- Public selector hooks (one slice each → no fan-out) ---- */
export const useConversations = () =>
  useStoreSlice((s) => s.conversations);

export const useActiveConvId = () =>
  useStoreSlice((s) => s.activeConvId);

export const useMessagesForConv = (convId) =>
  useStoreSlice((s) => (convId ? s.messagesByConv[convId] || EMPTY_ARRAY : EMPTY_ARRAY));

export const useTypingForConv = (convId) =>
  useStoreSlice((s) => (convId ? s.typingByConv[convId] || EMPTY_OBJECT : EMPTY_OBJECT));

export const usePresenceForUser = (userId) =>
  useStoreSlice((s) => (userId ? s.presence[userId] || null : null));

export const useWsConnected = () =>
  useStoreSlice((s) => s.wsConnected);

export const useComposerStateForConv = (convId) =>
  useStoreSlice((s) => (convId ? s.composerByConv[convId] || EMPTY_OBJECT : EMPTY_OBJECT));

export const useGroupMembers = (convId) =>
  useStoreSlice((s) => (convId ? s.groupMembersByConv[convId] || EMPTY_OBJECT : EMPTY_OBJECT));

/* ---- Actions context (stable callbacks) ---- */
const ActionsContext = createContext(null);

const wsUrlFromApi = () => {
  const root = API_BASE.replace(/\/api$/, "");
  return root.replace(/^http/i, "ws") + "/api/ws";
};

export const MessengerProvider = ({ children }) => {
  const { user } = useAuth();

  const wsRef = useRef(null);
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimerRef = useRef(null);
  const heartbeatRef = useRef(null);
  const activeConvIdRef = useRef(null);
  const userIdRef = useRef(null);

  useEffect(() => {
    userIdRef.current = user?.id || null;
  }, [user]);

  /* --- Internal store helpers --- */
  const patchMessagesForConv = useCallback((convId, updater) => {
    store.set((s) => {
      const list = s.messagesByConv[convId] || EMPTY_ARRAY;
      const next = updater(list);
      if (next === list) return s;
      return {
        ...s,
        messagesByConv: { ...s.messagesByConv, [convId]: next },
      };
    });
  }, []);

  const sendWS = useCallback((payload) => {
    try {
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify(payload));
      }
    } catch {
      // ignore
    }
  }, []);

  /* --- Actions --- */
  const fetchConversations = useCallback(async () => {
    const { data } = await api.get("/conversations");
    store.set({ conversations: data });
    return data;
  }, []);

  const loadMessages = useCallback(async (convId) => {
    const { data } = await api.get(`/conversations/${convId}/messages`);
    store.set((s) => ({
      ...s,
      messagesByConv: { ...s.messagesByConv, [convId]: data },
    }));
    return data;
  }, []);

  // Phase 11 — Fetch older messages (paged backfill) and PREPEND into cache.
  // Used by pinned-bar / reply-jump when the target is older than the
  // currently-loaded window.
  const loadOlderMessages = useCallback(async (convId, beforeMessageId, limit = 50) => {
    if (!convId || !beforeMessageId) return [];
    const { data } = await api.get(`/conversations/${convId}/messages`, {
      params: { before: beforeMessageId, limit },
    });
    if (!Array.isArray(data) || data.length === 0) return [];
    store.set((s) => {
      const existing = s.messagesByConv[convId] || [];
      const seen = new Set(existing.map((m) => m.id));
      const newer = data.filter((m) => !seen.has(m.id));
      if (newer.length === 0) return s;
      // server returns ascending order — prepend then re-sort by created_at to
      // be safe against minor drift.
      const merged = [...newer, ...existing].sort(
        (a, b) => new Date(a.created_at) - new Date(b.created_at)
      );
      return { ...s, messagesByConv: { ...s.messagesByConv, [convId]: merged } };
    });
    return data;
  }, []);

  const sendMessage = useCallback(async (convId, text, opts = {}) => {
    const trimmed = (text || "").trim();
    if (!trimmed) return null;
    const replyToId = opts.reply_to_message_id || null;
    // Optimistic insert
    const tmpId = `tmp-${Math.random().toString(36).slice(2, 10)}`;
    const nowIso = new Date().toISOString();
    const tmp = {
      id: tmpId,
      conversation_id: convId,
      sender_id: userIdRef.current,
      type: "text",
      text: trimmed,
      media: null,
      status: "pending",
      created_at: nowIso,
      seen_at: null,
      delivered_at: null,
      reply_to: opts._optimisticReplySnapshot || null,
      forwarded_from: null,
      edited: false,
      edited_at: null,
      deleted_for_everyone: false,
      _temp: true,
    };
    patchMessagesForConv(convId, (list) => [...list, tmp]);
    try {
      const body = { text: trimmed };
      if (replyToId) body.reply_to_message_id = replyToId;
      const { data: real } = await api.post(`/conversations/${convId}/messages`, body);
      patchMessagesForConv(convId, (list) => {
        const withoutTmp = list.filter((m) => m.id !== tmpId);
        if (withoutTmp.some((m) => m.id === real.id)) return withoutTmp;
        return [...withoutTmp, real];
      });
      return real;
    } catch (err) {
      patchMessagesForConv(convId, (list) =>
        list.map((m) =>
          m.id === tmpId
            ? { ...m, status: "failed", _error: err?.response?.data?.detail || err.message }
            : m
        )
      );
      throw err;
    }
  }, [patchMessagesForConv]);

  const uploadMedia = useCallback(async (convId, file, opts = {}) => {
    const kind = opts.kind || (() => {
      const m = (file.type || "");
      if (m.startsWith("image/")) return "image";
      if (m.startsWith("video/")) return "video";
      if (m.startsWith("audio/")) return "voice";
      return "file";
    })();
    const replyToId = opts.reply_to_message_id || null;
    const tmpId = `tmp-${Math.random().toString(36).slice(2, 10)}`;
    const tmpUrl = URL.createObjectURL(file);
    const nowIso = new Date().toISOString();
    const tmpMsg = {
      id: tmpId,
      conversation_id: convId,
      sender_id: userIdRef.current,
      type: kind,
      text: "",
      media: {
        url: null,
        mime: file.type,
        size_bytes: file.size,
        file_name: file.name,
        duration_sec: opts.duration_sec,
        waveform: opts.waveform,
      },
      status: "uploading",
      created_at: nowIso,
      _progress: 0,
      _localUrl: tmpUrl,
    };
    patchMessagesForConv(convId, (list) => [...list, tmpMsg]);

    const form = new FormData();
    form.append("conversation_id", convId);
    form.append("kind", kind);
    form.append("file", file);
    if (opts.duration_sec !== undefined && opts.duration_sec !== null) {
      form.append("duration_sec", String(opts.duration_sec));
    }
    if (opts.waveform) {
      form.append("waveform", JSON.stringify(opts.waveform));
    }
    if (replyToId) {
      form.append("reply_to_message_id", replyToId);
    }

    try {
      const { data: real } = await api.post("/messages/upload", form, {
        headers: { "Content-Type": "multipart/form-data" },
        onUploadProgress: (e) => {
          if (!e.total) return;
          const p = e.loaded / e.total;
          patchMessagesForConv(convId, (list) =>
            list.map((m) => (m.id === tmpId ? { ...m, _progress: p } : m))
          );
        },
      });
      patchMessagesForConv(convId, (list) => {
        const withoutTmp = list.filter((m) => m.id !== tmpId);
        if (withoutTmp.some((m) => m.id === real.id)) return withoutTmp;
        return [...withoutTmp, real];
      });
      try { URL.revokeObjectURL(tmpUrl); } catch { /* ignore */ }
      return real;
    } catch (err) {
      patchMessagesForConv(convId, (list) =>
        list.map((m) =>
          m.id === tmpId
            ? { ...m, status: "failed", _error: err?.response?.data?.detail || err.message }
            : m
        )
      );
      throw err;
    }
  }, [patchMessagesForConv]);

  const markRead = useCallback(async (convId) => {
    try {
      await api.post(`/conversations/${convId}/read`);
      store.set((s) => ({
        ...s,
        conversations: s.conversations.map((c) =>
          c.id === convId ? { ...c, unread_count: 0 } : c
        ),
      }));
    } catch {
      // ignore
    }
  }, []);

  const openOrCreateConversation = useCallback(async (otherUserId) => {
    const { data } = await api.post("/conversations", { user_id: otherUserId });
    store.set((s) => {
      const exists = s.conversations.find((c) => c.id === data.id);
      let next;
      if (exists) {
        next = s.conversations.map((c) => (c.id === data.id ? { ...c, ...data } : c));
      } else {
        const cs = s.conversations;
        const savedIdx = cs.findIndex((c) => c.kind === "saved");
        next = savedIdx === 0 ? [cs[0], data, ...cs.slice(1)] : [data, ...cs];
      }
      return { ...s, conversations: next };
    });
    return data;
  }, []);

  const ensureSavedConversation = useCallback(async () => {
    try {
      const { data } = await api.post("/conversations/saved");
      store.set((s) => {
        const exists = s.conversations.find((c) => c.id === data.id);
        if (exists) return s;
        return {
          ...s,
          conversations: [data, ...s.conversations.filter((c) => c.kind !== "saved")],
        };
      });
      return data;
    } catch {
      return null;
    }
  }, []);

  const searchUsers = useCallback(async (q) => {
    if (!q || !q.trim()) return [];
    const { data } = await api.get("/users/search", { params: { q } });
    return data;
  }, []);

  // Phase 5B actions: edit / delete / forward / pin / mute
  const editMessage = useCallback(async (messageId, newText) => {
    const { data: updated } = await api.patch(`/messages/${messageId}`, { text: newText });
    const convId = updated.conversation_id;
    patchMessagesForConv(convId, (list) =>
      list.map((m) => (m.id === messageId ? { ...m, ...updated } : m))
    );
    return updated;
  }, [patchMessagesForConv]);

  const deleteMessage = useCallback(async (messageId, scope, convId) => {
    if (scope === "me") {
      // Optimistic remove
      if (convId) {
        patchMessagesForConv(convId, (list) => list.filter((m) => m.id !== messageId));
      }
      try {
        await api.delete(`/messages/${messageId}`, { params: { scope: "me" } });
      } catch (err) {
        // Reload messages to restore consistency on failure
        if (convId) loadMessages(convId).catch(() => {});
        throw err;
      }
      return { ok: true, scope: "me" };
    }
    // scope === "all" — optimistic tombstone
    if (convId) {
      patchMessagesForConv(convId, (list) =>
        list.map((m) =>
          m.id === messageId
            ? { ...m, deleted_for_everyone: true, text: "", media: null }
            : m
        )
      );
    }
    try {
      await api.delete(`/messages/${messageId}`, { params: { scope: "all" } });
    } catch (err) {
      if (convId) loadMessages(convId).catch(() => {});
      throw err;
    }
    return { ok: true, scope: "all" };
  }, [patchMessagesForConv, loadMessages]);

  const forwardMessages = useCallback(async (messageId, conversationIds) => {
    const { data } = await api.post(`/messages/${messageId}/forward`, {
      conversation_ids: conversationIds,
    });
    return data;
  }, []);

  const setPinned = useCallback(async (convId, pinned) => {
    try {
      const { data } = pinned
        ? await api.post(`/conversations/${convId}/pin`)
        : await api.delete(`/conversations/${convId}/pin`);
      store.set((s) => ({
        ...s,
        conversations: s.conversations.map((c) =>
          c.id === convId ? { ...c, is_pinned: data.is_pinned, is_muted: data.is_muted } : c
        ),
      }));
      // Refetch list to apply server's pin-aware sort order
      fetchConversations().catch(() => {});
      return data;
    } catch (err) {
      throw err;
    }
  }, [fetchConversations]);

  const setMuted = useCallback(async (convId, muted) => {
    const { data } = muted
      ? await api.post(`/conversations/${convId}/mute`)
      : await api.delete(`/conversations/${convId}/mute`);
    store.set((s) => ({
      ...s,
      conversations: s.conversations.map((c) =>
        c.id === convId ? { ...c, is_pinned: data.is_pinned, is_muted: data.is_muted } : c
      ),
    }));
    return data;
  }, []);

  // Phase 8B: delete conversation (DM / saved only)
  const deleteConversation = useCallback(async (convId) => {
    await api.delete(`/conversations/${convId}`);
    store.set((s) => ({
      ...s,
      conversations: s.conversations.filter((c) => c.id !== convId),
      messagesByConv: Object.fromEntries(
        Object.entries(s.messagesByConv).filter(([k]) => k !== convId)
      ),
      activeConvId: s.activeConvId === convId ? null : s.activeConvId,
    }));
  }, []);

  // Phase 8C: pin / unpin / list pinned messages
  const pinMessage = useCallback(async (messageId) => {
    const { data } = await api.post(`/messages/${messageId}/pin`);
    return data;
  }, []);
  const unpinMessage = useCallback(async (messageId) => {
    const { data } = await api.delete(`/messages/${messageId}/pin`);
    return data;
  }, []);
  const listPinned = useCallback(async (convId) => {
    const { data } = await api.get(`/conversations/${convId}/pinned`);
    return data;
  }, []);

  // Phase 8D: member admin (groups & channels)
  const listMembers = useCallback(async (convId, kind, q = "") => {
    const path = kind === "channel" ? `/channels/${convId}/members` : `/groups/${convId}/members`;
    const { data } = await api.get(path, { params: q ? { q } : {} });
    return data;
  }, []);
  const listBanned = useCallback(async (convId, kind) => {
    const path = kind === "channel" ? `/channels/${convId}/banned` : `/groups/${convId}/banned`;
    const { data } = await api.get(path);
    return data;
  }, []);
  const banMember = useCallback(async (convId, userId, kind) => {
    const path = kind === "channel" ? `/channels/${convId}/ban/${userId}` : `/groups/${convId}/ban/${userId}`;
    const { data } = await api.post(path);
    return data;
  }, []);
  const unbanMember = useCallback(async (convId, userId, kind) => {
    const path = kind === "channel" ? `/channels/${convId}/ban/${userId}` : `/groups/${convId}/ban/${userId}`;
    const { data } = await api.delete(path);
    return data;
  }, []);
  const transferOwnership = useCallback(async (convId, userId, kind) => {
    const path = kind === "channel" ? `/channels/${convId}/transfer-owner/${userId}` : `/groups/${convId}/transfer-owner/${userId}`;
    const { data } = await api.post(path);
    return data;
  }, []);

  // Phase 8E: location messages
  const sendLocation = useCallback(async (convId, lat, lng, address = null) => {
    const { data } = await api.post(`/conversations/${convId}/location`, { lat, lng, address });
    return data;
  }, []);

  // Phase 8B: block / unblock / report
  const blockUser = useCallback(async (userId) => {
    const { data } = await api.post(`/users/${userId}/block`);
    return data;
  }, []);
  const unblockUser = useCallback(async (userId) => {
    const { data } = await api.delete(`/users/${userId}/block`);
    return data;
  }, []);
  const reportUser = useCallback(async (userId, reason) => {
    const { data } = await api.post(`/users/${userId}/report`, { reason: reason || null });
    return data;
  }, []);

  // Composer per-conversation state (reply target / edit target)
  const setReplyTarget = useCallback((convId, replyTo) => {
    store.set((s) => ({
      ...s,
      composerByConv: {
        ...s.composerByConv,
        [convId]: { ...(s.composerByConv[convId] || {}), replyTo, editTarget: null },
      },
    }));
  }, []);

  const setEditTarget = useCallback((convId, editTarget) => {
    store.set((s) => ({
      ...s,
      composerByConv: {
        ...s.composerByConv,
        [convId]: { ...(s.composerByConv[convId] || {}), editTarget, replyTo: null },
      },
    }));
  }, []);

  const clearComposerState = useCallback((convId) => {
    store.set((s) => {
      if (!s.composerByConv[convId]) return s;
      const next = { ...s.composerByConv };
      delete next[convId];
      return { ...s, composerByConv: next };
    });
  }, []);

  // Phase 5C — groups / search / starred
  const createGroup = useCallback(async ({ title, participant_ids, description }) => {
    const { data } = await api.post("/groups", { title, participant_ids, description });
    store.set((s) => {
      const exists = s.conversations.find((c) => c.id === data.id);
      if (exists) return s;
      const saved = s.conversations.find((c) => c.kind === "saved");
      const rest = s.conversations.filter((c) => c.kind !== "saved");
      return {
        ...s,
        conversations: saved ? [saved, data, ...rest] : [data, ...rest],
      };
    });
    return data;
  }, []);
  // Phase 6: channels
  const createChannel = useCallback(async ({ title, description, is_public, handle, participant_ids }) => {
    const body = { title, description, is_public, handle };
    if (participant_ids && participant_ids.length) body.participant_ids = participant_ids;
    const { data } = await api.post("/channels", body);
    store.set((s) => {
      if (s.conversations.find((c) => c.id === data.id)) return s;
      const saved = s.conversations.find((c) => c.kind === "saved");
      const rest = s.conversations.filter((c) => c.kind !== "saved");
      return { ...s, conversations: saved ? [saved, data, ...rest] : [data, ...rest] };
    });
    return data;
  }, []);
  const uploadChannelAvatar = useCallback(async (convId, file) => {
    const form = new FormData();
    form.append("file", file);
    const { data } = await api.post(`/channels/${convId}/avatar`, form, {
      headers: { "Content-Type": "multipart/form-data" },
    });
    store.set((s) => ({
      ...s,
      conversations: s.conversations.map((c) =>
        c.id === convId ? { ...c, group: c.group ? { ...c.group, avatar_url: data?.group?.avatar_url || data.avatar_url } : c.group } : c
      ),
    }));
    return data;
  }, []);
  const patchConversation = useCallback((convId, patch) => {
    store.set((s) => ({
      ...s,
      conversations: s.conversations.map((c) => {
        if (c.id !== convId) return c;
        return { ...c, ...patch };
      }),
    }));
  }, []);
  const removeChannelMember = useCallback(async (convId, userId) => {
    const target = userId === "self" ? "me" : userId;
    // Backend route: DELETE /channels/{id}/members/{user_id}; for self, frontend must pass own user id.
    if (target === "me") {
      // Need own id — get from auth/me via a quick fetch
      const me = await api.get("/auth/me");
      await api.delete(`/channels/${convId}/members/${me.data.id}`);
    } else {
      await api.delete(`/channels/${convId}/members/${target}`);
    }
    store.set((s) => ({ ...s, conversations: s.conversations.filter((c) => c.id !== convId) }));
  }, []);
  const joinConversation = useCallback(async ({ handle, invite_token }) => {
    const body = {};
    if (handle) body.handle = handle;
    if (invite_token) body.invite_token = invite_token;
    const { data } = await api.post("/conversations/join", body);
    store.set((s) => {
      const exists = s.conversations.find((c) => c.id === data.id);
      if (exists) {
        // Update existing entry (so is_member/admins refresh)
        return {
          ...s,
          conversations: s.conversations.map((c) => (c.id === data.id ? { ...c, ...data } : c)),
        };
      }
      const saved = s.conversations.find((c) => c.kind === "saved");
      const rest = s.conversations.filter((c) => c.kind !== "saved");
      return { ...s, conversations: saved ? [saved, data, ...rest] : [data, ...rest] };
    });
    return data;
  }, []);
  const updateGroup = useCallback(async (convId, patch) => {
    const { data } = await api.patch(`/groups/${convId}`, patch);
    store.set((s) => ({
      ...s,
      conversations: s.conversations.map((c) => (c.id === convId ? { ...c, ...data } : c)),
    }));
    return data;
  }, []);
  const updateChannel = useCallback(async (convId, patch) => {
    const { data } = await api.patch(`/channels/${convId}`, patch);
    store.set((s) => ({
      ...s,
      conversations: s.conversations.map((c) => (c.id === convId ? { ...c, ...data } : c)),
    }));
    return data;
  }, []);
  const uploadGroupAvatar = useCallback(async (convId, file) => {
    const form = new FormData();
    form.append("file", file);
    const { data } = await api.post(`/groups/${convId}/avatar`, form, {
      headers: { "Content-Type": "multipart/form-data" },
    });
    store.set((s) => ({
      ...s,
      conversations: s.conversations.map((c) =>
        c.id === convId && c.group ? { ...c, group: { ...c.group, avatar_url: data.avatar_url } } : c
      ),
    }));
    return data;
  }, []);
  const addGroupMembers = useCallback(async (convId, userIds) => {
    const { data } = await api.post(`/groups/${convId}/members`, { user_ids: userIds });
    store.set((s) => ({
      ...s,
      conversations: s.conversations.map((c) => (c.id === convId ? { ...c, ...data } : c)),
    }));
    return data;
  }, []);
  const removeGroupMember = useCallback(async (convId, userId) => {
    const { data } = await api.delete(`/groups/${convId}/members/${userId}`);
    if (data?.deleted) {
      store.set((s) => ({ ...s, conversations: s.conversations.filter((c) => c.id !== convId) }));
    }
    return data;
  }, []);
  const promoteGroupAdmin = useCallback(async (convId, userId) => {
    await api.post(`/groups/${convId}/admins/${userId}`);
    return { ok: true };
  }, []);
  const demoteGroupAdmin = useCallback(async (convId, userId) => {
    await api.delete(`/groups/${convId}/admins/${userId}`);
    return { ok: true };
  }, []);
  // Phase 13 — channel admin promote/demote (parity with group endpoints)
  const promoteChannelAdmin = useCallback(async (convId, userId) => {
    await api.post(`/channels/${convId}/admins/${userId}`);
    return { ok: true };
  }, []);
  const demoteChannelAdmin = useCallback(async (convId, userId) => {
    await api.delete(`/channels/${convId}/admins/${userId}`);
    return { ok: true };
  }, []);
  const listGroupMembers = useCallback(async (convId) => {
    const { data } = await api.get(`/groups/${convId}/members`);
    return data;
  }, []);
  // Cached fetch: stores members as {userId: member} under groupMembersByConv[convId]
  const loadGroupMembers = useCallback(async (convId) => {
    if (!convId) return;
    const cached = store.get().groupMembersByConv[convId];
    if (cached && Object.keys(cached).length > 0) return;
    try {
      const { data } = await api.get(`/groups/${convId}/members`);
      const map = {};
      for (const m of data || []) map[m.id] = m;
      store.set((s) => ({
        ...s,
        groupMembersByConv: { ...s.groupMembersByConv, [convId]: map },
      }));
    } catch {
      /* ignore - bubble fallback will render User xxxxxx */
    }
  }, []);
  const searchInConversation = useCallback(async (convId, q) => {
    const { data } = await api.get(`/conversations/${convId}/messages/search`, { params: { q } });
    return data;
  }, []);
  const searchMessagesGlobal = useCallback(async (q) => {
    const { data } = await api.get("/messages/search", { params: { q } });
    return data;
  }, []);
  // Phase 9C: public chats discovery (groups + channels)
  // Phase 9D: PATCH admin custom title + permissions
  const updateAdminRole = useCallback(async (convId, kind, userId, { title, permissions } = {}) => {
    const path = kind === "channel" ? `/channels/${convId}/admins/${userId}` : `/groups/${convId}/admins/${userId}`;
    const body = {};
    if (title !== undefined) body.title = title;
    if (permissions !== undefined) body.permissions = permissions;
    const { data } = await api.patch(path, body);
    return data;
  }, []);
  const discoverPublic = useCallback(async (q = "", limit = 8) => {
    const { data } = await api.get("/discover", { params: { q, limit } });
    return data;
  }, []);

  // ---------- Phase 24C — Polls ----------
  const createPoll = useCallback(async (convId, payload) => {
    const { data } = await api.post(`/conversations/${convId}/messages/poll`, payload);
    return data;
  }, []);
  const votePoll = useCallback(async (messageId, optionIds) => {
    const { data } = await api.post(`/messages/${messageId}/vote`, { option_ids: optionIds });
    return data;
  }, []);
  const closePoll = useCallback(async (messageId) => {
    const { data } = await api.post(`/messages/${messageId}/poll/close`);
    return data;
  }, []);
  const starMessage = useCallback(async (messageId, convId) => {
    await api.post(`/messages/${messageId}/star`);
    if (convId) {
      patchMessagesForConv(convId, (list) =>
        list.map((m) =>
          m.id === messageId
            ? { ...m, starred_by: [...(m.starred_by || []), userIdRef.current].filter((v, i, a) => a.indexOf(v) === i) }
            : m
        )
      );
    }
  }, [patchMessagesForConv]);
  const unstarMessage = useCallback(async (messageId, convId) => {
    await api.delete(`/messages/${messageId}/star`);
    if (convId) {
      patchMessagesForConv(convId, (list) =>
        list.map((m) =>
          m.id === messageId
            ? { ...m, starred_by: (m.starred_by || []).filter((u) => u !== userIdRef.current) }
            : m
        )
      );
    }
  }, [patchMessagesForConv]);
  const listStarred = useCallback(async () => {
    const { data } = await api.get("/messages/starred");
    return data;
  }, []);

  const toggleReaction = useCallback(async (messageId, emoji, convId) => {
    const { data } = await api.post(`/messages/${messageId}/reactions`, { emoji });
    if (convId) {
      patchMessagesForConv(convId, (list) =>
        list.map((m) => (m.id === messageId ? { ...m, reactions: data.reactions } : m))
      );
    }
    return data;
  }, [patchMessagesForConv]);

  const updateUsername = useCallback(async (username) => {
    const { data } = await api.patch("/users/me/username", { username });
    return data;
  }, []);

  const setActiveConv = useCallback(async (convId) => {
    activeConvIdRef.current = convId;
    store.set({ activeConvId: convId });
    if (!convId) return;
    const existing = store.get().messagesByConv[convId];
    if (!existing) {
      try {
        await loadMessages(convId);
      } catch {
        // ignore
      }
    }
    markRead(convId);
  }, [loadMessages, markRead]);

  const sendTyping = useCallback(
    (convId, isTyping) => {
      sendWS({ type: "typing", conversation_id: convId, is_typing: !!isTyping });
    },
    [sendWS]
  );

  /* --- WebSocket handler --- */
  const handleWsMessage = useCallback((event) => {
    let data;
    try {
      data = JSON.parse(event.data);
    } catch {
      return;
    }
    const meId = userIdRef.current;
    const activeId = activeConvIdRef.current;

    if (data.type === "ready" || data.type === "pong") return;

    if (data.type === "message_new") {
      const { message, conversation_id } = data;
      let needFetchConvs = false;
      store.set((s) => {
        const list = s.messagesByConv[conversation_id] || EMPTY_ARRAY;
        // Reconcile against any optimistic temp (same sender + same text + recent)
        let nextList = list;
        if (!list.some((m) => m.id === message.id)) {
          const tempIdx = list.findIndex(
            (m) =>
              m._temp &&
              m.sender_id === message.sender_id &&
              m.type === message.type &&
              (m.text || "") === (message.text || "")
          );
          if (tempIdx >= 0) {
            nextList = list.slice();
            nextList[tempIdx] = message;
          } else {
            nextList = [...list, message];
          }
        }

        const found = s.conversations.find((c) => c.id === conversation_id);
        if (!found) {
          needFetchConvs = true;
          return {
            ...s,
            messagesByConv:
              nextList === list ? s.messagesByConv : { ...s.messagesByConv, [conversation_id]: nextList },
          };
        }
        const lastMsg = {
          text: message.text || "",
          sender_id: message.sender_id,
          created_at: message.created_at,
          type: message.type || "text",
          media_label_key: message.type && message.type !== "text" ? message.type : undefined,
          file_name: message.media?.file_name,
          duration_sec: message.media?.duration_sec,
        };
        const updated = {
          ...found,
          last_message: lastMsg,
          last_message_at: message.created_at,
        };
        if (message.sender_id !== meId && conversation_id !== activeId) {
          updated.unread_count = (found.unread_count || 0) + 1;
        }
        const others = s.conversations.filter((c) => c.id !== conversation_id);
        let nextConvs;
        if (updated.kind === "saved") {
          nextConvs = [updated, ...others.filter((c) => c.kind !== "saved")];
        } else {
          const savedConv = others.find((c) => c.kind === "saved");
          if (savedConv) {
            const rest = others.filter((c) => c.id !== savedConv.id);
            nextConvs = [savedConv, updated, ...rest];
          } else {
            nextConvs = [updated, ...others];
          }
        }
        return {
          ...s,
          conversations: nextConvs,
          messagesByConv:
            nextList === list ? s.messagesByConv : { ...s.messagesByConv, [conversation_id]: nextList },
        };
      });
      if (needFetchConvs) fetchConversations().catch(() => {});
      if (conversation_id === activeId && message.sender_id !== meId) {
        markRead(conversation_id);
      }
      return;
    }

    if (data.type === "poll_vote_update" || data.type === "poll_close") {
      const { message_id, conversation_id, poll } = data;
      const closed = data.type === "poll_close" ? true : undefined;
      store.set((s) => {
        const list = s.messagesByConv[conversation_id];
        if (!list) return s;
        let changed = false;
        const next = list.map((m) => {
          if (m.id !== message_id) return m;
          changed = true;
          return {
            ...m,
            poll: closed ? { ...poll, closed: true } : poll,
          };
        });
        if (!changed) return s;
        return {
          ...s,
          messagesByConv: { ...s.messagesByConv, [conversation_id]: next },
        };
      });
      return;
    }

    if (data.type === "message_status") {
      const { message_id, conversation_id, status, at } = data;
      store.set((s) => {
        const list = s.messagesByConv[conversation_id];
        if (!list) return s;
        let changed = false;
        const next = list.map((m) => {
          if (m.id !== message_id) return m;
          changed = true;
          return {
            ...m,
            status,
            seen_at: status === "seen" ? at : m.seen_at,
            delivered_at: status === "delivered" ? at : m.delivered_at,
          };
        });
        if (!changed) return s;
        return {
          ...s,
          messagesByConv: { ...s.messagesByConv, [conversation_id]: next },
        };
      });
      return;
    }

    if (data.type === "user_updated") {
      const u = data.user;
      if (!u) return;
      store.set((s) => ({
        ...s,
        conversations: s.conversations.map((c) =>
          c.other_user && c.other_user.id === u.id
            ? { ...c, other_user: { ...c.other_user, ...u } }
            : c
        ),
      }));
      return;
    }

    if (data.type === "message_reaction") {
      const { message_id, conversation_id, reactions } = data;
      store.set((s) => {
        const list = s.messagesByConv[conversation_id];
        if (!list) return s;
        let changed = false;
        const next = list.map((m) => {
          if (m.id !== message_id) return m;
          changed = true;
          return { ...m, reactions };
        });
        if (!changed) return s;
        return { ...s, messagesByConv: { ...s.messagesByConv, [conversation_id]: next } };
      });
      return;
    }

    // Phase 8C — pin / unpin
    if (data.type === "message_pinned") {
      const { conversation_id, message, popped_message_id } = data;
      store.set((s) => {
        const list = s.messagesByConv[conversation_id];
        if (!list) return s;
        const next = list.map((m) => {
          if (m.id === message?.id) return { ...m, pinned_in_conv: true };
          if (popped_message_id && m.id === popped_message_id) return { ...m, pinned_in_conv: false };
          return m;
        });
        return { ...s, messagesByConv: { ...s.messagesByConv, [conversation_id]: next } };
      });
      return;
    }
    if (data.type === "message_unpinned") {
      const { conversation_id, message_id } = data;
      store.set((s) => {
        const list = s.messagesByConv[conversation_id];
        if (!list) return s;
        const next = list.map((m) => (m.id === message_id ? { ...m, pinned_in_conv: false } : m));
        return { ...s, messagesByConv: { ...s.messagesByConv, [conversation_id]: next } };
      });
      return;
    }
    // Phase 8C — channel view counts
    if (data.type === "message_views_updated") {
      const { conversation_id, message_ids } = data;
      const idSet = new Set(message_ids || []);
      store.set((s) => {
        const list = s.messagesByConv[conversation_id];
        if (!list) return s;
        const next = list.map((m) => (idSet.has(m.id) ? { ...m, view_count: (m.view_count || 0) + 1 } : m));
        return { ...s, messagesByConv: { ...s.messagesByConv, [conversation_id]: next } };
      });
      return;
    }

    if (data.type === "conversation_new" || data.type === "group_updated" || data.type === "conversation_removed" || data.type === "conversation_deleted") {
      fetchConversations().catch(() => {});
      if (data.type === "conversation_removed" || data.type === "conversation_deleted") {
        store.set((s) => ({
          ...s,
          conversations: s.conversations.filter((c) => c.id !== data.conversation_id),
        }));
      }
      return;
    }

    if (data.type === "message_edited") {
      const { message_id, conversation_id, text, edited_at } = data;
      store.set((s) => {
        const list = s.messagesByConv[conversation_id];
        let nextMsgs = s.messagesByConv;
        if (list) {
          let changed = false;
          const updated = list.map((m) => {
            if (m.id !== message_id) return m;
            changed = true;
            return { ...m, text, edited: true, edited_at };
          });
          if (changed) {
            nextMsgs = { ...s.messagesByConv, [conversation_id]: updated };
          }
        }
        // Update conversation last_message if this was the latest
        const conv = s.conversations.find((c) => c.id === conversation_id);
        let nextConvs = s.conversations;
        if (conv && conv.last_message) {
          const newLast = { ...conv.last_message, text };
          nextConvs = s.conversations.map((c) =>
            c.id === conversation_id ? { ...c, last_message: newLast } : c
          );
        }
        return { ...s, messagesByConv: nextMsgs, conversations: nextConvs };
      });
      return;
    }

    if (data.type === "message_deleted") {
      const { message_id, conversation_id } = data;
      store.set((s) => {
        const list = s.messagesByConv[conversation_id];
        let nextMsgs = s.messagesByConv;
        if (list) {
          const updated = list.map((m) =>
            m.id === message_id
              ? { ...m, deleted_for_everyone: true, text: "", media: null }
              : m
          );
          nextMsgs = { ...s.messagesByConv, [conversation_id]: updated };
        }
        return { ...s, messagesByConv: nextMsgs };
      });
      // Refresh conversations so last_message reflects server state
      fetchConversations().catch(() => {});
      return;
    }

    if (data.type === "conversation_updated") {
      // Phase 26b Bug A — backend may send either a full `conversation` payload
      // (channel/group rename) or a partial { is_pinned, is_muted } payload.
      const fullConv = data.conversation;
      const partialId = data.conversation_id;
      const targetId = fullConv?.id || partialId;
      if (!targetId) return;
      store.set((s) => ({
        ...s,
        conversations: s.conversations.map((c) => {
          if (c.id !== targetId) return c;
          if (fullConv) return { ...c, ...fullConv };
          return { ...c, is_pinned: data.is_pinned, is_muted: data.is_muted };
        }),
      }));
      return;
    }

    if (data.type === "typing") {
      const { conversation_id, user_id, is_typing } = data;
      store.set((s) => {
        const cur = s.typingByConv[conversation_id] || EMPTY_OBJECT;
        if (!!cur[user_id] === !!is_typing) return s;
        return {
          ...s,
          typingByConv: {
            ...s.typingByConv,
            [conversation_id]: { ...cur, [user_id]: !!is_typing },
          },
        };
      });
      return;
    }

    if (data.type === "presence") {
      const { user_id, is_online, last_seen } = data;
      store.set((s) => {
        const cur = s.presence[user_id];
        const updatedPres = { is_online: !!is_online, last_seen };
        const presenceSame =
          cur && cur.is_online === updatedPres.is_online && cur.last_seen === updatedPres.last_seen;
        const nextPresence = presenceSame
          ? s.presence
          : { ...s.presence, [user_id]: updatedPres };
        const nextConvs = s.conversations.map((c) =>
          c.other_user && c.other_user.id === user_id
            ? { ...c, other_user: { ...c.other_user, is_online: !!is_online, last_seen } }
            : c
        );
        return { ...s, presence: nextPresence, conversations: nextConvs };
      });
      return;
    }
  }, [fetchConversations, markRead]);

  const connect = useCallback(() => {
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token || !userIdRef.current) return;
    if (wsRef.current && wsRef.current.readyState <= 1) return;
    let ws;
    try {
      ws = new WebSocket(`${wsUrlFromApi()}?token=${encodeURIComponent(token)}`);
    } catch {
      return;
    }
    wsRef.current = ws;
    ws.onopen = () => {
      store.set({ wsConnected: true });
      reconnectAttemptsRef.current = 0;
      if (heartbeatRef.current) clearInterval(heartbeatRef.current);
      heartbeatRef.current = setInterval(() => sendWS({ type: "ping" }), 25000);
    };
    ws.onmessage = handleWsMessage;
    ws.onerror = () => {
      try { ws.close(); } catch { /* ignore */ }
    };
    ws.onclose = () => {
      store.set({ wsConnected: false });
      if (heartbeatRef.current) {
        clearInterval(heartbeatRef.current);
        heartbeatRef.current = null;
      }
      if (userIdRef.current && localStorage.getItem(TOKEN_KEY)) {
        const attempts = reconnectAttemptsRef.current + 1;
        reconnectAttemptsRef.current = attempts;
        const delay = Math.min(30000, 1000 * Math.pow(2, attempts - 1));
        if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = setTimeout(connect, delay);
      }
    };
  }, [handleWsMessage, sendWS]);

  const disconnect = useCallback(() => {
    if (heartbeatRef.current) {
      clearInterval(heartbeatRef.current);
      heartbeatRef.current = null;
    }
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    reconnectAttemptsRef.current = 0;
    if (wsRef.current) {
      try {
        wsRef.current.onclose = null;
        wsRef.current.close();
      } catch { /* ignore */ }
      wsRef.current = null;
    }
    store.set({ wsConnected: false });
  }, []);

  useEffect(() => {
    if (!user) {
      disconnect();
      activeConvIdRef.current = null;
      store.set({
        conversations: [],
        messagesByConv: {},
        typingByConv: {},
        presence: {},
        activeConvId: null,
      });
      return;
    }
    fetchConversations().catch(() => {});
    ensureSavedConversation().catch(() => {});
    connect();
    return () => {
      disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  // Sync total unread → document.title (subscribe directly to store)
  useEffect(() => {
    const apply = () => {
      const total = store.get().conversations.reduce(
        (s, c) => s + (c.is_muted ? 0 : (c.unread_count || 0)),
        0,
      );
      document.title = total > 0 ? `(${total}) sexgram` : "sexgram";
    };
    apply();
    return store.subscribe(apply);
  }, []);

  const actions = useMemo(
    () => ({
      sendMessage,
      uploadMedia,
      sendTyping,
      openOrCreateConversation,
      ensureSavedConversation,
      fetchConversations,
      loadMessages,
      loadOlderMessages,
      searchUsers,
      markRead,
      setActiveConv,
      editMessage,
      deleteMessage,
      forwardMessages,
      setPinned,
      setMuted,
      setReplyTarget,
      setEditTarget,
      clearComposerState,
      createGroup,
      createChannel,
      uploadChannelAvatar,
      joinConversation,
      patchConversation,
      removeChannelMember,
      updateGroup,
      updateChannel,
      uploadGroupAvatar,
      addGroupMembers,
      removeGroupMember,
      promoteGroupAdmin,
      demoteGroupAdmin,
      promoteChannelAdmin,
      demoteChannelAdmin,
      listGroupMembers,
      loadGroupMembers,
      searchInConversation,
      searchMessagesGlobal,
      discoverPublic,
      updateAdminRole,
      starMessage,
      unstarMessage,
      listStarred,
      toggleReaction,
      updateUsername,
      deleteConversation,
      blockUser,
      unblockUser,
      reportUser,
      pinMessage,
      unpinMessage,
      listPinned,
      listMembers,
      listBanned,
      banMember,
      unbanMember,
      transferOwnership,
      sendLocation,
      createPoll,
      votePoll,
      closePoll,
    }),
    [
      sendMessage,
      uploadMedia,
      sendTyping,
      openOrCreateConversation,
      ensureSavedConversation,
      fetchConversations,
      loadMessages,
      loadOlderMessages,
      searchUsers,
      markRead,
      setActiveConv,
      editMessage,
      deleteMessage,
      forwardMessages,
      setPinned,
      setMuted,
      setReplyTarget,
      setEditTarget,
      clearComposerState,
      createGroup,
      createChannel,
      uploadChannelAvatar,
      joinConversation,
      patchConversation,
      removeChannelMember,
      updateGroup,
      updateChannel,
      uploadGroupAvatar,
      addGroupMembers,
      removeGroupMember,
      promoteGroupAdmin,
      demoteGroupAdmin,
      promoteChannelAdmin,
      demoteChannelAdmin,
      listGroupMembers,
      loadGroupMembers,
      searchInConversation,
      searchMessagesGlobal,
      discoverPublic,
      updateAdminRole,
      starMessage,
      unstarMessage,
      listStarred,
      toggleReaction,
      updateUsername,
      deleteConversation,
      blockUser,
      unblockUser,
      reportUser,
      pinMessage,
      unpinMessage,
      listPinned,
      listMembers,
      listBanned,
      banMember,
      unbanMember,
      transferOwnership,
      sendLocation,
      createPoll,
      votePoll,
      closePoll,
    ]
  );

  return <ActionsContext.Provider value={actions}>{children}</ActionsContext.Provider>;
};

export const useMessengerActions = () => {
  const ctx = useContext(ActionsContext);
  if (!ctx) throw new Error("useMessengerActions must be used inside MessengerProvider");
  return ctx;
};

/* Back-compat shim: the prior `useMessenger()` returned both state and
 * actions in a single object. Keep it working for any module that still
 * imports it, but selector hooks above are preferred for perf. */
export const useMessenger = () => {
  const actions = useMessengerActions();
  const conversations = useConversations();
  const activeConvId = useActiveConvId();
  const wsConnected = useWsConnected();
  // Note: messagesByConv / typingByConv / presence are deliberately NOT
  // exposed here to discourage fan-out. Use selector hooks instead.
  return { ...actions, conversations, activeConvId, wsConnected };
};
