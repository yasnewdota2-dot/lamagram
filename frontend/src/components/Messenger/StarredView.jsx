import React, { useEffect, useState } from "react";
import { Star, Inbox } from "lucide-react";
import { useI18n } from "../../lib/i18n";
import { useMessengerActions, useConversations } from "../../lib/messenger";
import { useAuth } from "../../lib/auth";
import { MessageBubble } from "./MessageBubble";
import { EmptyState } from "../EmptyState";

export const StarredView = ({ onJumpTo }) => {
  const { t } = useI18n();
  const { user } = useAuth();
  const { listStarred, unstarMessage } = useMessengerActions();
  const conversations = useConversations();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    setLoading(true);
    try { setItems(await listStarred()); } catch { setItems([]); }
    setLoading(false);
  };

  useEffect(() => { refresh(); }, []);

  const convName = (cid) => {
    const c = conversations.find((x) => x.id === cid);
    if (!c) return "—";
    if (c.kind === "saved") return t("savedMessages");
    if (c.kind === "group") return c.group?.title || "Group";
    return c.other_user?.display_name || c.other_user?.username || "—";
  };

  if (loading) {
    return <div className="text-center text-xs text-white/55 py-10" data-testid="starred-loading">…</div>;
  }
  if (items.length === 0) {
    return (
      <EmptyState
        icon={Star}
        title={t("noStarredMessages")}
        testId="starred-empty"
      />
    );
  }
  return (
    <div className="flex flex-col gap-2 py-3 px-2" data-testid="starred-list">
      {items.map((m) => {
        const mine = m.sender_id === user?.id;
        return (
          <button
            key={m.id}
            onClick={() => onJumpTo?.(m.conversation_id, m.id)}
            className="text-left rounded-2xl px-2 py-1 hover:bg-white/5"
            data-testid={`starred-row-${m.id}`}
          >
            <div className="text-[10px] uppercase tracking-wider text-[#C9B8FF] mb-1 px-1">
              <Star className="inline w-2.5 h-2.5 mr-1" />
              {convName(m.conversation_id)}
            </div>
            <MessageBubble
              message={m}
              mine={mine}
              showAvatar={false}
              onOpenImage={() => {}}
              onReply={() => {}}
              onForward={() => {}}
              onEdit={() => {}}
              onDelete={async (msg) => { await unstarMessage(msg.id, m.conversation_id); refresh(); }}
              onJumpToReply={() => {}}
            />
          </button>
        );
      })}
    </div>
  );
};
