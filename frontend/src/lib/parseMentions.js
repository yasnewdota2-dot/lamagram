// parseMentions — splits text into segments: plain strings and mention objects.
// Supports:
//   @username   where username matches ^[a-z0-9_]{3,32}$
//   /c/handle   where handle matches ^[a-z0-9_]{3,32}$
//
// Returns an array like:
//   ["hi ", { type:"user", name:"bob", raw:"@bob" }, " check ",
//    { type:"conv", name:"news", raw:"/c/news" }]

const MENTION_RE = /(@[a-z0-9_]{3,32}|\/c\/[a-z0-9_]{3,32})/gi;

export function parseMentions(text) {
  if (!text || typeof text !== "string") return [text || ""];
  const out = [];
  let last = 0;
  let m;
  MENTION_RE.lastIndex = 0;
  while ((m = MENTION_RE.exec(text)) !== null) {
    const idx = m.index;
    if (idx > last) out.push(text.slice(last, idx));
    const raw = m[0];
    if (raw.startsWith("@")) {
      out.push({ type: "user", name: raw.slice(1).toLowerCase(), raw });
    } else {
      out.push({ type: "conv", name: raw.slice(3).toLowerCase(), raw });
    }
    last = idx + raw.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out.length === 0 ? [text] : out;
}

export const isMentionSegment = (seg) => seg && typeof seg === "object" && (seg.type === "user" || seg.type === "conv");
