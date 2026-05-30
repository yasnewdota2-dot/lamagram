import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { api, API_BASE, TOKEN_KEY } from "./api";
import { useAuth } from "./auth";

const MessengerContext = createContext(null);

const wsUrlFromApi = () => {
  // API_BASE is `${REACT_APP_BACKEND_URL}/api`
  const root = API_BASE.replace(/\/api$/, "");
  return root.replace(/^http/i, "ws") + "/api/ws";
};

export const MessengerProvider = ({ children }) => {
  const { user } = useAuth();
  const [conversations, setConversations] = useState([]);
  const [messagesByConv, setMessagesByConv] = useState({});
  const [typingByConv, setTypingByConv] = useState({});
  const [presence, setPresence] = useState({});
  const [activeConvId, setActiveConvId] = useState(null);
  const [wsConnected, setWsConnected] = useState(false);

  const wsRef = useRef(null);
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimerRef = useRef(null);
  const heartbeatRef = useRef(null);
  const activeConvIdRef = useRef(null);
  const userIdRef = useRef(null);

  useEffect(() => {
    activeConvIdRef.current = activeConvId;
  }, [activeConvId]);

  useEffect(() => {
    userIdRef.current = user?.id || null;
  }, [user]);

  const sendWS = useCallback((payload) => {
    try {
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify(payload));
      }
    } catch {
      // ignore
    }
  }, []);

  const fetchConversations = useCallback(async () => {
    const { data } = await api.get("/conversations");
    setConversations(data);
    return data;
  }, []);

  const loadMessages = useCallback(async (convId) => {
    const { data } = await api.get(`/conversations/${convId}/messages`);
    setMessagesByConv((prev) => ({ ...prev, [convId]: data }));
    return data;
  }, []);

  const sendMessage = useCallback(async (convId, text) => {
    const { data } = await api.post(`/conversations/${convId}/messages`, { text });
    return data;
  }, []);

  const uploadMedia = useCallback(async (convId, file, opts = {}) => {
    const kind = opts.kind || (() => {
      const m = (file.type || "");
      if (m.startsWith("image/")) return "image";
      if (m.startsWith("video/")) return "video";
      if (m.startsWith("audio/")) return "voice";
      return "file";
    })();
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
    setMessagesByConv((prev) => ({
      ...prev,
      [convId]: [...(prev[convId] || []), tmpMsg],
    }));

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

    try {
      const { data: real } = await api.post("/messages/upload", form, {
        headers: { "Content-Type": "multipart/form-data" },
        onUploadProgress: (e) => {
          if (!e.total) return;
          const p = e.loaded / e.total;
          setMessagesByConv((prev) => {
            const arr = prev[convId];
            if (!arr) return prev;
            return {
              ...prev,
              [convId]: arr.map((m) => (m.id === tmpId ? { ...m, _progress: p } : m)),
            };
          });
        },
      });
      setMessagesByConv((prev) => {
        const arr = prev[convId] || [];
        const withoutTmp = arr.filter((m) => m.id !== tmpId);
        if (withoutTmp.some((m) => m.id === real.id)) {
          return { ...prev, [convId]: withoutTmp };
        }
        return { ...prev, [convId]: [...withoutTmp, real] };
      });
      try { URL.revokeObjectURL(tmpUrl); } catch { /* ignore */ }
      return real;
    } catch (err) {
      setMessagesByConv((prev) => {
        const arr = prev[convId];
        if (!arr) return prev;
        return {
          ...prev,
          [convId]: arr.map((m) =>
            m.id === tmpId ? { ...m, status: "failed", _error: err?.response?.data?.detail || err.message } : m
          ),
        };
      });
      throw err;
    }
  }, []);

  const markRead = useCallback(async (convId) => {
    try {
      await api.post(`/conversations/${convId}/read`);
      setConversations((cs) =>
        cs.map((c) => (c.id === convId ? { ...c, unread_count: 0 } : c))
      );
    } catch {
      // ignore
    }
  }, []);

  const openOrCreateConversation = useCallback(async (otherUserId) => {
    const { data } = await api.post("/conversations", { user_id: otherUserId });
    setConversations((cs) => {
      const exists = cs.find((c) => c.id === data.id);
      if (exists) return cs.map((c) => (c.id === data.id ? { ...c, ...data } : c));
      return [data, ...cs];
    });
    return data;
  }, []);

  const searchUsers = useCallback(async (q) => {
    if (!q || !q.trim()) return [];
    const { data } = await api.get("/users/search", { params: { q } });
    return data;
  }, []);

  const setActiveConv = useCallback(
    async (convId) => {
      setActiveConvId(convId);
      if (!convId) return;
      if (!messagesByConv[convId]) {
        try {
          await loadMessages(convId);
        } catch {
          // ignore
        }
      }
      markRead(convId);
    },
    [messagesByConv, loadMessages, markRead]
  );

  const sendTyping = useCallback(
    (convId, isTyping) => {
      sendWS({ type: "typing", conversation_id: convId, is_typing: !!isTyping });
    },
    [sendWS]
  );

  // ------- WebSocket lifecycle -------
  const handleWsMessage = useCallback(
    (event) => {
      let data;
      try {
        data = JSON.parse(event.data);
      } catch {
        return;
      }
      const meId = userIdRef.current;
      const activeId = activeConvIdRef.current;

      if (data.type === "ready") {
        return;
      }
      if (data.type === "pong") {
        return;
      }
      if (data.type === "message_new") {
        const { message, conversation_id } = data;
        setMessagesByConv((prev) => {
          const list = prev[conversation_id] || [];
          if (list.some((m) => m.id === message.id)) return prev;
          return { ...prev, [conversation_id]: [...list, message] };
        });
        setConversations((cs) => {
          const found = cs.find((c) => c.id === conversation_id);
          const lastMsg = {
            text: message.text || "",
            sender_id: message.sender_id,
            created_at: message.created_at,
            type: message.type || "text",
            media_label_key: message.type && message.type !== "text" ? message.type : undefined,
            file_name: message.media?.file_name,
            duration_sec: message.media?.duration_sec,
          };
          let next;
          if (found) {
            const updated = {
              ...found,
              last_message: lastMsg,
              last_message_at: message.created_at,
            };
            if (message.sender_id !== meId && conversation_id !== activeId) {
              updated.unread_count = (found.unread_count || 0) + 1;
            }
            next = [updated, ...cs.filter((c) => c.id !== conversation_id)];
          } else {
            // unknown conversation — refetch list
            fetchConversations().catch(() => {});
            return cs;
          }
          return next;
        });
        // Auto-mark read when message arrives in the actively-open conversation
        if (
          conversation_id === activeId &&
          message.sender_id !== meId
        ) {
          markRead(conversation_id);
        }
        return;
      }
      if (data.type === "message_status") {
        const { message_id, conversation_id, status, at } = data;
        setMessagesByConv((prev) => {
          const list = prev[conversation_id];
          if (!list) return prev;
          return {
            ...prev,
            [conversation_id]: list.map((m) =>
              m.id === message_id
                ? {
                    ...m,
                    status,
                    seen_at: status === "seen" ? at : m.seen_at,
                    delivered_at:
                      status === "delivered" ? at : m.delivered_at,
                  }
                : m
            ),
          };
        });
        return;
      }
      if (data.type === "typing") {
        const { conversation_id, user_id, is_typing } = data;
        setTypingByConv((prev) => ({
          ...prev,
          [conversation_id]: { ...(prev[conversation_id] || {}), [user_id]: is_typing },
        }));
        return;
      }
      if (data.type === "presence") {
        const { user_id, is_online, last_seen } = data;
        setPresence((prev) => ({ ...prev, [user_id]: { is_online, last_seen } }));
        setConversations((cs) =>
          cs.map((c) =>
            c.other_user && c.other_user.id === user_id
              ? { ...c, other_user: { ...c.other_user, is_online, last_seen } }
              : c
          )
        );
        return;
      }
    },
    [fetchConversations, markRead]
  );

  const connect = useCallback(() => {
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token || !userIdRef.current) return;
    if (wsRef.current && wsRef.current.readyState <= 1) return; // already connecting/open
    let ws;
    try {
      ws = new WebSocket(`${wsUrlFromApi()}?token=${encodeURIComponent(token)}`);
    } catch {
      return;
    }
    wsRef.current = ws;
    ws.onopen = () => {
      setWsConnected(true);
      reconnectAttemptsRef.current = 0;
      if (heartbeatRef.current) clearInterval(heartbeatRef.current);
      heartbeatRef.current = setInterval(
        () => sendWS({ type: "ping" }),
        25000
      );
    };
    ws.onmessage = handleWsMessage;
    ws.onerror = () => {
      try {
        ws.close();
      } catch {
        // ignore
      }
    };
    ws.onclose = () => {
      setWsConnected(false);
      if (heartbeatRef.current) {
        clearInterval(heartbeatRef.current);
        heartbeatRef.current = null;
      }
      // Reconnect with backoff (only if user still authenticated)
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
      } catch {
        // ignore
      }
      wsRef.current = null;
    }
    setWsConnected(false);
  }, []);

  useEffect(() => {
    if (!user) {
      disconnect();
      setConversations([]);
      setMessagesByConv({});
      setTypingByConv({});
      setPresence({});
      setActiveConvId(null);
      return;
    }
    fetchConversations().catch(() => {});
    connect();
    return () => {
      disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  // Sync unread count → document.title
  useEffect(() => {
    const total = conversations.reduce(
      (s, c) => s + (c.unread_count || 0),
      0
    );
    document.title = total > 0 ? `(${total}) Glass` : "Glass";
  }, [conversations]);

  const value = {
    wsConnected,
    conversations,
    messagesByConv,
    typingByConv,
    presence,
    activeConvId,
    setActiveConv,
    sendMessage,
    uploadMedia,
    sendTyping,
    openOrCreateConversation,
    fetchConversations,
    loadMessages,
    searchUsers,
    markRead,
  };

  return (
    <MessengerContext.Provider value={value}>
      {children}
    </MessengerContext.Provider>
  );
};

export const useMessenger = () => {
  const ctx = useContext(MessengerContext);
  if (!ctx) throw new Error("useMessenger must be used inside MessengerProvider");
  return ctx;
};
