// Lightweight time helpers (no extra deps)

export function formatTime(iso, lang = "en") {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString(lang === "fa" ? "fa-IR" : "en-US", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: lang !== "fa",
    });
  } catch {
    return "";
  }
}

export function formatRelative(iso, lang = "en") {
  if (!iso) return "";
  const d = new Date(iso);
  const diffSec = Math.max(0, (Date.now() - d.getTime()) / 1000);
  if (diffSec < 60) return lang === "fa" ? "همین حالا" : "just now";
  if (diffSec < 3600) {
    const m = Math.floor(diffSec / 60);
    return lang === "fa" ? `${m} دقیقه پیش` : `${m}m ago`;
  }
  if (diffSec < 86400) {
    const h = Math.floor(diffSec / 3600);
    return lang === "fa" ? `${h} ساعت پیش` : `${h}h ago`;
  }
  if (diffSec < 7 * 86400) {
    const days = Math.floor(diffSec / 86400);
    if (days === 1) return lang === "fa" ? "دیروز" : "yesterday";
    return lang === "fa" ? `${days} روز پیش` : `${days}d ago`;
  }
  return d.toLocaleDateString(lang === "fa" ? "fa-IR" : "en-US");
}

export function listTime(iso, lang = "en") {
  if (!iso) return "";
  const d = new Date(iso);
  const sameDay = new Date().toDateString() === d.toDateString();
  if (sameDay) return formatTime(iso, lang);
  const diffDays = Math.floor((Date.now() - d.getTime()) / 86400000);
  if (diffDays < 7) {
    return d.toLocaleDateString(lang === "fa" ? "fa-IR" : "en-US", { weekday: "short" });
  }
  return d.toLocaleDateString(lang === "fa" ? "fa-IR" : "en-US", { month: "short", day: "numeric" });
}

export function isWithinMinutes(isoA, isoB, minutes = 2) {
  try {
    return Math.abs(new Date(isoA).getTime() - new Date(isoB).getTime()) < minutes * 60_000;
  } catch {
    return false;
  }
}
