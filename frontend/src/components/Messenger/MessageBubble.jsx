import React from "react";
import { motion } from "framer-motion";
import { Ticks } from "./Ticks";
import { MediaContent } from "./MediaContent";
import { formatTime } from "../../lib/time";
import { isEmojiOnly } from "../../lib/format";
import { useI18n } from "../../lib/i18n";

export const MessageBubble = ({ message, mine, showAvatar, onOpenImage, testId }) => {
  const { lang, dir } = useI18n();
  const alignClass = mine ? "justify-end" : "justify-start";
  const isMedia = message.type && message.type !== "text";
  const emojiBig = !isMedia && isEmojiOnly(message.text);

  const bubbleStyle = isMedia
    ? {
        background: "transparent",
        border: "none",
        boxShadow: "none",
        color: "white",
        padding: 0,
      }
    : mine
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

  const isUploading = message.status === "uploading";
  const isFailed = message.status === "failed";
  const progress = Math.max(0, Math.min(1, message._progress || 0));

  return (
    <motion.div
      initial={{ opacity: 0, y: 6, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.15, ease: "easeOut" }}
      className={`w-full flex ${alignClass} ${showAvatar ? "mt-3" : "mt-1"}`}
      data-testid={testId || `message-${mine ? "mine" : "theirs"}`}
    >
      <div
        className={`${isMedia ? "" : "max-w-[78%] sm:max-w-[64%] rounded-2xl px-3.5 py-2"} relative`}
        style={{
          ...bubbleStyle,
          borderTopLeftRadius: !isMedia && !mine && !showAvatar ? "8px" : undefined,
          borderTopRightRadius: !isMedia && mine && !showAvatar ? "8px" : undefined,
        }}
      >
        {isMedia ? (
          <div className="relative inline-block" style={{ opacity: isUploading ? 0.7 : 1 }}>
            <MediaContent message={message} mine={mine} onOpenImage={onOpenImage} />
            {/* Time + ticks overlay */}
            <div
              className="absolute bottom-1 right-2 flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] text-white/95"
              style={{ background: "rgba(0,0,0,0.45)", backdropFilter: "blur(4px)", direction: dir }}
            >
              <span>{formatTime(message.created_at, lang)}</span>
              {mine && !isUploading && <Ticks status={message.status} />}
            </div>
            {isUploading && (
              <div
                className="absolute left-0 bottom-0 right-0 h-1 bg-white/15 rounded-b-xl overflow-hidden"
                data-testid="upload-progress"
              >
                <div
                  className="h-full"
                  style={{
                    width: `${progress * 100}%`,
                    background: "linear-gradient(90deg,#3B9EFF,#A78BFA)",
                    transition: "width 120ms linear",
                  }}
                />
              </div>
            )}
            {isFailed && (
              <div className="absolute inset-0 flex items-center justify-center rounded-xl"
                style={{ background: "rgba(0,0,0,0.45)" }}>
                <span className="text-xs text-[#FFB4B4]" data-testid="upload-failed">
                  {message._error || "Failed"}
                </span>
              </div>
            )}
          </div>
        ) : (
          <>
            <div
              className={`leading-relaxed whitespace-pre-wrap break-words ${
                emojiBig ? "text-[3rem] leading-tight" : "text-[0.95rem]"
              }`}
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
          </>
        )}
      </div>
    </motion.div>
  );
};
