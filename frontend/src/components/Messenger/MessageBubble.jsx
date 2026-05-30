import React from "react";
import { motion } from "framer-motion";
import { Ticks } from "./Ticks";
import { formatTime } from "../../lib/time";
import { useI18n } from "../../lib/i18n";

export const MessageBubble = ({ message, mine, showAvatar, testId }) => {
  const { lang, dir } = useI18n();
  const alignClass = mine ? "justify-end" : "justify-start";
  const bubbleStyle = mine
    ? {
        background:
          "linear-gradient(135deg, rgba(59,158,255,0.85) 0%, rgba(123,131,255,0.85) 50%, rgba(167,139,250,0.85) 100%)",
        border: "1px solid rgba(255,255,255,0.18)",
        boxShadow: "0 10px 30px -10px rgba(59,158,255,0.45)",
        color: "white",
      }
    : {
        background: "rgba(255,255,255,0.05)",
        border: "1px solid rgba(255,255,255,0.10)",
        color: "white",
      };

  return (
    <motion.div
      initial={{ opacity: 0, y: 6, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.15, ease: "easeOut" }}
      className={`w-full flex ${alignClass} ${showAvatar ? "mt-3" : "mt-1"}`}
      data-testid={testId || `message-${mine ? "mine" : "theirs"}`}
    >
      <div
        className="max-w-[78%] sm:max-w-[64%] rounded-2xl px-3.5 py-2"
        style={{
          ...bubbleStyle,
          borderTopLeftRadius: !mine && !showAvatar ? "8px" : undefined,
          borderTopRightRadius: mine && !showAvatar ? "8px" : undefined,
        }}
      >
        <div
          className="text-[0.95rem] leading-relaxed whitespace-pre-wrap break-words"
          style={{ unicodeBidi: "plaintext" }}
        >
          {message.text}
        </div>
        <div
          className={`flex items-center gap-1 mt-1 text-[10px] ${
            mine ? "justify-end text-white/80" : "justify-start text-white/55"
          }`}
          style={{ direction: dir }}
        >
          <span>{formatTime(message.created_at, lang)}</span>
          {mine && <Ticks status={message.status} />}
        </div>
      </div>
    </motion.div>
  );
};
