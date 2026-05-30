import React, { useEffect, useRef, useState } from "react";
import {
  Play,
  Pause,
  FileText,
  FileArchive,
  FileImage,
  FileVideo,
  FileMusic,
  File as FileIcon,
  Download,
  ImageIcon,
  Music,
} from "lucide-react";
import { resolveAsset } from "../../lib/api";
import { humanSize, formatDuration } from "../../lib/format";
import { useI18n } from "../../lib/i18n";

// ===== Helpers =====
const AUDIO_EXT_RE = /\.(mp3|m4a|wav|ogg|flac|aac|opus)$/i;

const truncateMiddle = (name, max = 32) => {
  if (!name) return "file";
  if (name.length <= max) return name;
  const dot = name.lastIndexOf(".");
  const ext = dot > -1 && name.length - dot <= 8 ? name.slice(dot) : "";
  const stem = ext ? name.slice(0, name.length - ext.length) : name;
  const keep = max - ext.length - 1;
  if (keep < 6) return name.slice(0, max - 1) + "…";
  const head = Math.ceil(keep * 0.6);
  const tail = keep - head;
  return `${stem.slice(0, head)}…${stem.slice(stem.length - tail)}${ext}`;
};

const isMusicFile = (media) => {
  if (!media) return false;
  const name = (media.file_name || "").toLowerCase();
  const mime = (media.mime || media.content_type || "").toLowerCase();
  return AUDIO_EXT_RE.test(name) || mime.startsWith("audio/");
};

const fileIconFor = (name) => {
  const lower = (name || "").toLowerCase();
  if (/\.(pdf)$/.test(lower)) return FileText;
  if (/\.(docx?|rtf|txt|md|odt|pages)$/.test(lower)) return FileText;
  if (/\.(zip|rar|7z|tar|gz|bz2)$/.test(lower)) return FileArchive;
  if (/\.(jpe?g|png|gif|webp|svg|heic|heif)$/.test(lower)) return FileImage;
  if (/\.(mp4|mov|avi|webm|mkv|m4v)$/.test(lower)) return FileVideo;
  if (AUDIO_EXT_RE.test(lower)) return FileMusic;
  return FileIcon;
};

// ===== Image =====
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
      style={{
        width: "100%",
        maxWidth: 280,
        aspectRatio: String(ratio),
      }}
      data-testid={`media-image-${mine ? "mine" : "theirs"}`}
    >
      {url ? (
        <img
          src={url}
          alt={media?.file_name || "image"}
          loading="lazy"
          className="object-cover"
          style={{ width: "100%", height: "100%", maxHeight: 380, display: "block" }}
        />
      ) : (
        <div className="w-full h-full flex items-center justify-center" style={{ color: "var(--text-muted)" }}>
          <ImageIcon className="w-7 h-7" />
        </div>
      )}
    </button>
  );
};

// ===== Video =====
export const VideoContent = ({ media, localUrl }) => {
  const url = localUrl || resolveAsset(media?.url);
  return (
    <video
      controls
      preload="metadata"
      src={url}
      className="rounded-xl bg-black/40"
      style={{ width: "100%", maxWidth: 320, maxHeight: 380, display: "block" }}
      data-testid="media-video"
    />
  );
};

// ===== File card =====
export const FileContent = ({ media }) => {
  const url = resolveAsset(media?.url);
  const name = media?.file_name || "file";
  const Icon = fileIconFor(name);
  return (
    <a
      href={url}
      download={name}
      target="_blank"
      rel="noreferrer"
      className="flex items-center gap-3 px-3 py-2 rounded-xl"
      style={{
        background: "var(--bg-glass)",
        border: "1px solid var(--border-glass)",
        minWidth: 0,
        width: "100%",
        maxWidth: 320,
      }}
      data-testid="media-file"
    >
      <div
        className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0"
        style={{
          background: "rgba(45,127,255,0.18)",
          border: "1px solid rgba(45,127,255,0.35)",
        }}
      >
        <Icon className="w-5 h-5" style={{ color: "var(--accent-blue, #3B9EFF)" }} />
      </div>
      <div className="min-w-0 flex-1">
        <div
          className="text-sm font-medium truncate"
          style={{ color: "var(--text-primary)" }}
          title={name}
          data-testid="file-name"
        >
          {truncateMiddle(name, 32)}
        </div>
        <div className="text-[11px]" style={{ color: "var(--text-muted)" }} data-testid="file-size">
          {humanSize(media?.size_bytes)}
        </div>
      </div>
      <Download
        className="w-4 h-4 shrink-0"
        style={{ color: "var(--text-secondary)" }}
        data-testid="file-download-icon"
      />
    </a>
  );
};

// ===== Music card (audio file with no waveform) =====
export const MusicContent = ({ media, localUrl }) => {
  const url = localUrl || resolveAsset(media?.url);
  const audioRef = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState(media?.duration_sec || 0);
  const [pos, setPos] = useState(0);

  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    const onMeta = () => {
      if (a.duration && isFinite(a.duration)) setDuration(a.duration);
    };
    const onTime = () => setPos(a.currentTime || 0);
    const onEnd = () => {
      setPlaying(false);
      setPos(0);
    };
    a.addEventListener("loadedmetadata", onMeta);
    a.addEventListener("timeupdate", onTime);
    a.addEventListener("ended", onEnd);
    return () => {
      a.removeEventListener("loadedmetadata", onMeta);
      a.removeEventListener("timeupdate", onTime);
      a.removeEventListener("ended", onEnd);
    };
  }, []);

  const toggle = (e) => {
    e?.preventDefault?.();
    e?.stopPropagation?.();
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

  const name = media?.file_name || "audio";
  const pct = duration > 0 ? Math.min(100, (pos / duration) * 100) : 0;

  return (
    <div
      className="flex items-center gap-3 px-3 py-2.5 rounded-xl"
      style={{
        background: "var(--bg-glass)",
        border: "1px solid var(--border-glass)",
        minWidth: 0,
        width: "100%",
        maxWidth: 320,
      }}
      data-testid="media-music"
      dir="ltr"
    >
      <button
        onClick={toggle}
        className="w-10 h-10 rounded-lg flex items-center justify-center text-white shrink-0"
        style={{
          background: "var(--accent-gradient)",
          boxShadow: "0 6px 18px -8px var(--accent-glow)",
        }}
        aria-label={playing ? "pause music" : "play music"}
        data-testid="music-play-button"
      >
        {playing ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
      </button>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <Music className="w-3 h-3 shrink-0" style={{ color: "var(--text-muted)" }} />
          <div
            className="text-sm font-medium truncate"
            style={{ color: "var(--text-primary)" }}
            title={name}
            data-testid="music-name"
          >
            {truncateMiddle(name, 32)}
          </div>
        </div>
        {/* progress rail */}
        <div
          className="mt-1.5 h-1 rounded-full overflow-hidden"
          style={{ background: "rgba(15,20,40,0.18)" }}
        >
          <div
            className="h-full"
            style={{
              width: `${pct}%`,
              background: "var(--accent-gradient)",
              transition: "width 120ms linear",
            }}
          />
        </div>
        <div className="flex items-center justify-between mt-1">
          <span
            className="text-[10px] tabular-nums"
            style={{ color: "var(--text-muted)" }}
            data-testid="music-position"
          >
            {formatDuration(pos)}
          </span>
          <span
            className="text-[10px] tabular-nums"
            style={{ color: "var(--text-muted)" }}
            data-testid="music-duration"
          >
            {duration > 0 ? formatDuration(duration) : ""}
          </span>
        </div>
      </div>
      <audio ref={audioRef} src={url} preload="metadata" />
    </div>
  );
};

// ===== Voice MESSAGE (recorded — has waveform) =====
export const VoiceContent = ({ media, mine, localUrl }) => {
  const { lang: _lang } = useI18n();
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
        maxWidth: 320,
        width: "100%",
      }}
      data-testid="media-voice"
      dir="ltr"
    >
      <button
        onClick={toggle}
        className="w-9 h-9 rounded-full flex items-center justify-center text-white shrink-0"
        style={{ background: "var(--accent-gradient)" }}
        aria-label="play voice"
        data-testid="voice-play-button"
      >
        {playing ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
      </button>
      <div className="flex items-end gap-[2px] h-8 flex-1 min-w-0">
        {waveform.map((v, i) => (
          <span
            key={i}
            className="rounded-full"
            style={{
              flex: 1,
              height: `${Math.max(8, Math.min(100, v * 100))}%`,
              background:
                i < filledTo
                  ? "var(--accent-gradient)"
                  : "rgba(255,255,255,0.22)",
              transition: "background 80ms linear",
              minWidth: 2,
              maxWidth: 4,
            }}
          />
        ))}
      </div>
      <span
        className="text-[11px] tabular-nums shrink-0"
        style={{ color: mine ? "rgba(255,255,255,0.85)" : "var(--text-muted)" }}
        data-testid="voice-duration"
      >
        {formatDuration(media?.duration_sec || 0)}
      </span>
      <audio ref={audioRef} src={url} preload="metadata" />
    </div>
  );
};

// ===== Dispatcher =====
export const MediaContent = ({ message, mine, onOpenImage }) => {
  const localUrl = message?._localUrl;
  const media = message?.media;

  if (message.type === "image") {
    return <ImageContent media={media} mine={mine} onOpen={onOpenImage} localUrl={localUrl} />;
  }
  if (message.type === "video") {
    return <VideoContent media={media} localUrl={localUrl} />;
  }
  if (message.type === "voice") {
    // Voice MESSAGE: has waveform array. Otherwise treat as music file.
    const hasWaveform = Array.isArray(media?.waveform) && media.waveform.length > 0;
    if (hasWaveform) {
      return <VoiceContent media={media} mine={mine} localUrl={localUrl} />;
    }
    return <MusicContent media={media} localUrl={localUrl} />;
  }
  if (message.type === "file") {
    // File with audio extension/mime → music card; otherwise generic file card.
    if (isMusicFile(media)) {
      return <MusicContent media={media} localUrl={localUrl} />;
    }
    return <FileContent media={media} />;
  }
  return null;
};
