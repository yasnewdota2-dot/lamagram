import React, { useState } from "react";
import { motion } from "framer-motion";
import { Pin, PinOff, Reply, Trash2, ChevronRight } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "../ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import { Checkbox } from "../ui/checkbox";
import { useI18n } from "../../lib/i18n";
import { useAuth } from "../../lib/auth";
import { useLongPress } from "../../lib/useLongPress";

const DELETE_ALL_WINDOW_MS = 24 * 60 * 60 * 1000;

// Phase 24A — minimal centered system message for pin/unpin events.
// Tap → jump to pinned message. Long-press → menu (Reply / Delete).
export const SystemPinMessage = ({
  message,
  conversation,
  groupMembers,
  onJumpToReply,
  onReply,
  onDelete,
  testId,
}) => {
  const { t } = useI18n();
  const { user: meUser } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteForAll, setDeleteForAll] = useState(false);

  const isUnpin = message.type === "system_unpin";
  const meta = message.meta || {};
  const pinnedMessageId = meta.pinned_message_id;
  const actorId = meta.actor_id || message.sender_id;
  const kind = meta.conversation_kind || conversation?.kind || "dm";

  // Resolve actor display name (DM peer / group member / self)
  let actorName = "";
  if (actorId === meUser?.id) {
    actorName = meUser?.display_name || meUser?.username || "";
  } else if (kind === "group" && groupMembers?.[actorId]) {
    const m = groupMembers[actorId];
    actorName = m.display_name || m.username || "";
  } else if (kind === "dm") {
    const other = (conversation?.participants || []).find((p) => p.id === actorId);
    actorName = other?.display_name || other?.username || "";
  }

  const i18nKey = `system.${isUnpin ? "unpin" : "pin"}.${kind === "channel" ? "channel" : kind === "group" ? "group" : "dm"}`;
  const label = (t(i18nKey) || "").replace("{name}", actorName || "");

  const lp = useLongPress(() => setMenuOpen(true), { threshold: 500 });
  const { didFire, ...lpHandlers } = lp;

  const created = new Date(message.created_at).getTime();
  const now = Date.now();
  const mine = message.sender_id === meUser?.id;
  const deletableAll = mine && now - created < DELETE_ALL_WINDOW_MS;

  const handleTap = (e) => {
    e.stopPropagation();
    if (lp.didFire?.()) return;
    if (pinnedMessageId && onJumpToReply) onJumpToReply(pinnedMessageId);
  };

  const Icon = isUnpin ? PinOff : Pin;

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95, y: 4 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={{ duration: 0.2, ease: [0.34, 1.56, 0.64, 1] }}
      className="flex w-full justify-center px-3 py-1"
      data-testid={testId || `message-${message.id}`}
    >
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger asChild>
          <button
            {...lpHandlers}
            onClick={handleTap}
            className="group inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] cursor-pointer transition-colors"
            style={{
              background: "var(--bg-glass-soft, rgba(255,255,255,0.04))",
              border: "1px solid var(--border-glass, rgba(255,255,255,0.08))",
              color: "var(--text-muted, rgba(255,255,255,0.65))",
              backdropFilter: "blur(6px)",
            }}
            data-testid={`system-pin-${message.id}`}
          >
            <Icon className="w-3 h-3 opacity-80" />
            <span className="truncate max-w-[60ch]">{label}</span>
            {pinnedMessageId && (
              <ChevronRight className="w-3 h-3 opacity-50 group-hover:opacity-90 transition-opacity" />
            )}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="center" className="min-w-[160px]" data-testid={`system-pin-menu-${message.id}`}>
          <DropdownMenuItem
            onClick={(e) => { e.stopPropagation(); onReply?.(message); setMenuOpen(false); }}
            data-testid="system-pin-action-reply"
          >
            <Reply className="w-4 h-4 me-2" />
            {t("reply") || "Reply"}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={(e) => { e.stopPropagation(); setConfirmDelete(true); setMenuOpen(false); }}
            className="text-red-400 focus:text-red-300"
            data-testid="system-pin-action-delete"
          >
            <Trash2 className="w-4 h-4 me-2" />
            {t("delete") || "Delete"}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent data-testid="system-pin-delete-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>{t("deleteMessageTitle") || "Delete message?"}</AlertDialogTitle>
            <AlertDialogDescription>{t("areYouSure") || "Are you sure?"}</AlertDialogDescription>
          </AlertDialogHeader>
          {deletableAll && (
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <Checkbox checked={deleteForAll} onCheckedChange={(v) => setDeleteForAll(!!v)} data-testid="system-pin-delete-for-all" />
              {t("deleteForEveryone") || "Delete for everyone"}
            </label>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel>{t("cancel") || "Cancel"}</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                setConfirmDelete(false);
                try {
                  await onDelete?.(message, deletableAll && deleteForAll ? "all" : "me");
                } catch (_e) {}
              }}
              data-testid="system-pin-delete-confirm"
            >
              {t("delete") || "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </motion.div>
  );
};

export default SystemPinMessage;
