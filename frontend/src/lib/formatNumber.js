// Compact number formatting for view counts, member counts, etc.
//   5         -> "5"
//   999       -> "999"
//   1000      -> "1k"
//   1100      -> "1.1k"
//   12500     -> "12.5k"
//   100000    -> "100k"
//   999999    -> "999k"  (rounded down)
//   1_500_000 -> "1.5M"
export function formatCount(n) {
  if (n == null || Number.isNaN(n)) return "0";
  const v = Number(n);
  if (v < 1000) return String(Math.floor(v));
  if (v < 1_000_000) {
    const k = v / 1000;
    return k >= 100 ? `${Math.floor(k)}k` : `${k.toFixed(1).replace(/\.0$/, "")}k`;
  }
  if (v < 1_000_000_000) {
    const m = v / 1_000_000;
    return m >= 100 ? `${Math.floor(m)}M` : `${m.toFixed(1).replace(/\.0$/, "")}M`;
  }
  return `${(v / 1_000_000_000).toFixed(1).replace(/\.0$/, "")}B`;
}
