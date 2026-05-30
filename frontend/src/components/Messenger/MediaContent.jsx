import React, { useEffect, useRef, useState } from "react";
import { Play, Pause, FileText, Download, ImageIcon } from "lucide-react";
import { resolveAsset } from "../../lib/api";
import { humanSize, formatDuration } from "../../lib/format";
import { useI18n } from "../../lib/i18n";

export const ImageContent = ({ media, mine, onOpen, localUrl }) => {
  const url = localUrl || resolveAsset(media?.url);
  const ratio =
    media?.width && media?.height
      ? Math.max(0.5, Math.min(2.4, media.width / media.height))
      : 1.4;
  return (
    <button
      onClick={() => url && onOpen?.(url)}
      className="block rounded-xl overflow-hidden bg-black/30"
      style={{ width: 280, aspectRatio: String(ratio) }}
      data-testid={`media-image-${mine ? "mine" : "theirs"}`}
    >
      {url ? (
        <img
          src={url}
          alt={media?.file_name || "image"}
          loading="lazy"
          className="w-full h-full object-cover"
        />
      ) : (
        <div className="w-full h-full flex items-center justify-center text-white/50">
          <ImageIcon className="w-7 h-7" />
        </div>
      )}
    </button>
  );
};

export const VideoContent = ({ media, localUrl }) => {
  const url = localUrl || resolveAsset(media?.url);
  return (
    <video
      controls
      preload="metadata"
      src={url}
      className="rounded-xl bg-black/40"
      style={{ width: 320, maxWidth: "100%" }}
      data-testid="media-video"
    />
  );
};

export const FileContent = ({ media }) => {
  const url = resolveAsset(media?.url);
  return (
    <a
      href={url}
      download={media?.file_name}
      target="_blank"
      rel="noreferrer"
      className="flex items-center gap-3 px-3 py-2 rounded-xl"
      style={{
        background: "rgba(255,255,255,0.06)",
        border: "1px solid rgba(255,255,255,0.12)",
        minWidth: 220,
        maxWidth: 320,
      }}
      data-testid="media-file"
    >
      <div
        className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0"
        style={{ background: "rgba(59,158,255,0.18)", border: "1px solid rgba(59,158,255,0.35)" }}
      >
        <FileText className="w-5 h-5 text-[#9ABEFF]" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-white text-sm font-medium truncate" data-testid="file-name">
          {media?.file_name || "file"}
        </div>
        <div className="text-[11px] text-white/55">{humanSize(media?.size_bytes)}</div>
      </div>
      <Download className="w-4 h-4 text-white/70 shrink-0" />
    </a>
  );
};

export const VoiceContent = ({ media, mine, localUrl }) => {
  const { lang } = useI18n();
  const url = localUrl || resolveAsset(media?.url);
  const audioRef = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    const onTime = () => {
      if (a.duration && isFinite(a.duration)) {
        setProgress(a.currentTime / a.duration);
      }
    };
    const onEnd = () => {
      setPlaying(false);
      setProgress(0);
    };
    a.addEventListener("timeupdate", onTime);
    a.addEventListener("ended", onEnd);
    return () => {
      a.removeEventListener("timeupdate", onTime);
      a.removeEventListener("ended", onEnd);
    };
  }, []);

  const toggle = () => {
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) {
      a.play();
      setPlaying(true);
    } else {
      a.pause();
      setPlaying(false);
    }
  };

  const waveform =
    Array.isArray(media?.waveform) && media.waveform.length > 0
      ? media.waveform
      : new Array(36).fill(0.35);
  const total = waveform.length;
  const filledTo = Math.floor(progress * total);

  return (
    <div
      className="flex items-center gap-3 px-3 py-2 rounded-xl"
      style={{
        background: mine ? "rgba(255,255,255,0.10)" : "rgba(255,255,255,0.06)",
        border: "1px solid rgba(255,255,255,0.12)",
        minWidth: 220,
      }}
      data-testid="media-voice"
      dir="ltr"
    >
      <button
        onClick={toggle}
        className="w-9 h-9 rounded-full flex items-center justify-center text-white shrink-0"
        style={{ background: "linear-gradient(135deg,#3B9EFF,#A78BFA)" }}
        aria-label="play voice"
        data-testid="voice-play-button"
      >
        {playing ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
      </button>
      <div className="flex items-end gap-[2px] h-8 flex-1">
        {waveform.map((v, i) => (
          <span
            key={i}
            className="rounded-full"
            style={{
              flex: 1,
              height: `${Math.max(8, Math.min(100, v * 100))}%`,
              background:
                i < filledTo
                  ? "linear-gradient(180deg,#3B9EFF,#A78BFA)"
                  : "rgba(255,255,255,0.22)",
              transition: "background 80ms linear",
              minWidth: 2,
              maxWidth: 4,
            }}
          />
        ))}
      </div>
      <span className="text-[11px] text-white/70 tabular-nums shrink-0" data-testid="voice-duration">
        {formatDuration(media?.duration_sec || 0)}
      </span>
      <audio ref={audioRef} src={url} preload="metadata" />
    </div>
  );
};

export const MediaContent = ({ message, mine, onOpenImage }) => {
  const localUrl = message?._localUrl;
  if (message.type === "image") {
    return <ImageContent media={message.media} mine={mine} onOpen={onOpenImage} localUrl={localUrl} />;
  }
  if (message.type === "video") {
    return <VideoContent media={message.media} localUrl={localUrl} />;
  }
  if (message.type === "voice") {
    return <VoiceContent media={message.media} mine={mine} localUrl={localUrl} />;
  }
  if (message.type === "file") {
    return <FileContent media={message.media} />;
  }
  return null;
};
