export function humanSize(bytes) {
  if (bytes == null || isNaN(bytes)) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function formatDuration(sec) {
  if (!sec && sec !== 0) return "";
  const total = Math.max(0, Math.floor(sec));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function detectKind(file) {
  const m = (file && file.type) || "";
  if (m.startsWith("image/")) return "image";
  if (m.startsWith("video/")) return "video";
  if (m.startsWith("audio/")) return "voice";
  return "file";
}

const EMOJI_REGEX =
  /\p{Extended_Pictographic}|\uFE0F|\u200D|\p{Emoji_Modifier}|\p{Emoji_Component}/gu;

export function isEmojiOnly(text) {
  if (!text) return false;
  const trimmed = text.trim();
  if (!trimmed) return false;
  try {
    const noEmoji = trimmed.replace(EMOJI_REGEX, "").replace(/\s/g, "");
    if (noEmoji.length > 0) return false;
    if (typeof Intl !== "undefined" && Intl.Segmenter) {
      const seg = new Intl.Segmenter(undefined, { granularity: "grapheme" });
      const count = [...seg.segment(trimmed)].filter((s) => s.segment.trim()).length;
      return count >= 1 && count <= 3;
    }
    // Fallback: rough length check
    return trimmed.length <= 6;
  } catch {
    return false;
  }
}
