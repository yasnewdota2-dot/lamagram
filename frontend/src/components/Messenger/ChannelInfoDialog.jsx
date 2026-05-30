import React from "react";
import { X, Megaphone, LogOut } from "lucide-react";
import { useI18n } from "../../lib/i18n";
import { useMessengerActions } from "../../lib/messenger";
import { GroupAvatar } from "./GroupAvatar";
import { InviteLinkSection, PublicHandleSection } from "./InfoSections";

export const ChannelInfoDialog = ({ open, onOpenChange, conversation }) => {
  const { t } = useI18n();
  const { removeChannelMember } = useMessengerActions();
  if (!open || !conversation) return null;
  const g = conversation.group || {};
  const isAdmin = !!conversation.is_admin;

  const onLeave = async () => {
    try {
      // Best-effort self-leave
      if (removeChannelMember) await removeChannelMember(conversation.id, "self");
    } catch {}
    onOpenChange(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(7,7,10,0.65)", backdropFilter: "blur(8px)" }} onClick={(e) => { if (e.target === e.currentTarget) onOpenChange(false); }} data-testid="channel-info-dialog">
      <div className="w-full max-w-md rounded-3xl overflow-hidden flex flex-col" style={{ background: "rgba(15,15,22,0.92)", border: "1px solid rgba(255,255,255,0.1)", maxHeight: "85vh" }}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <div className="flex items-center gap-2">
            <Megaphone className="w-4 h-4 text-[#9ABEFF]" />
            <h3 className="text-white font-semibold">{g.title || "Channel"}</h3>
          </div>
          <button onClick={() => onOpenChange(false)} className="p-1 rounded-md hover:bg-white/10" data-testid="channel-info-close"><X className="w-4 h-4 text-white/70" /></button>
        </div>
        <div className="px-5 py-4 space-y-4 overflow-y-auto">
          <div className="flex items-center gap-3">
            <GroupAvatar group={{ title: g.title, avatar_url: g.avatar_url }} size={56} />
            <div className="min-w-0">
              <div className="text-white font-semibold truncate">{g.title}</div>
              <div className="text-xs text-[var(--gm-text-muted)]">
                {(g.member_count || 0)} {t("subscribers")}
                {conversation.is_public && conversation.handle && <span className="ml-2 text-white/40">· @{conversation.handle}</span>}
              </div>
              {g.description && <div className="text-xs text-white/60 mt-1">{g.description}</div>}
            </div>
          </div>
          <PublicHandleSection conversation={conversation} endpoint="channels" />
          <InviteLinkSection conversation={conversation} endpoint="channels" />
          <button onClick={onLeave} className="w-full mt-2 px-3 py-2 rounded-xl text-sm text-red-300 hover:bg-red-500/10 border border-red-400/20 flex items-center justify-center gap-2" data-testid="channel-leave">
            <LogOut className="w-3.5 h-3.5" /> {t("leaveChannel")}
          </button>
        </div>
      </div>
    </div>
  );
};
