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
  const updateGroup = useCallback(async (convId, patch) => {
    const { data } = await api.patch(`/groups/${convId}`, patch);
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
  const listGroupMembers = useCallback(async (convId) => {
    const { data } = await api.get(`/groups/${convId}/members`);
    return data;
  }, []);
  const searchInConversation = useCallback(async (convId, q) => {
    const { data } = await api.get(`/conversations/${convId}/messages/search`, { params: { q } });
    return data;
  }, []);
  const searchMessagesGlobal = useCallback(async (q) => {
    const { data } = await api.get("/messages/search", { params: { q } });
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
      const { conversation_id, is_pinned, is_muted } = data;
      store.set((s) => ({
        ...s,
        conversations: s.conversations.map((c) =>
          c.id === conversation_id ? { ...c, is_pinned, is_muted } : c
        ),
      }));
      fetchConversations().catch(() => {});
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
      document.title = total > 0 ? `(${total}) Glass` : "Glass";
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
      updateGroup,
      uploadGroupAvatar,
      addGroupMembers,
      removeGroupMember,
      promoteGroupAdmin,
      demoteGroupAdmin,
      listGroupMembers,
      searchInConversation,
      searchMessagesGlobal,
      starMessage,
      unstarMessage,
      listStarred,
      toggleReaction,
      updateUsername,
    }),
    [
      sendMessage,
      uploadMedia,
      sendTyping,
      openOrCreateConversation,
      ensureSavedConversation,
      fetchConversations,
      loadMessages,
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
      updateGroup,
      uploadGroupAvatar,
      addGroupMembers,
      removeGroupMember,
      promoteGroupAdmin,
      demoteGroupAdmin,
      listGroupMembers,
      searchInConversation,
      searchMessagesGlobal,
      starMessage,
      unstarMessage,
      listStarred,
      toggleReaction,
      updateUsername,
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
