// Phase 25b — module-level user cache. Components subscribing via
// useUsersBatch(ids) only trigger a network call for ids not yet in the cache.
// A 50ms microtask debouncer coalesces concurrent calls.
import { useEffect, useState } from "react";
import { api } from "./api";

const cache = new Map(); // id -> user object
const subscribers = new Set(); // () => void
let pendingIds = new Set();
let flushHandle = null;
let inflight = null;

function notify() {
  subscribers.forEach((cb) => {
    try { cb(); } catch (_e) {}
  });
}

async function flushNow() {
  flushHandle = null;
  const ids = Array.from(pendingIds).filter((id) => !cache.has(id));
  pendingIds = new Set();
  if (ids.length === 0) return;
  // Chunk into 100-id batches (server limit).
  const chunks = [];
  for (let i = 0; i < ids.length; i += 100) chunks.push(ids.slice(i, i + 100));
  inflight = Promise.all(
    chunks.map((chunk) =>
      api.post("/users/batch", { ids: chunk }).then((r) => r.data).catch(() => [])
    )
  );
  const lists = await inflight;
  inflight = null;
  lists.forEach((list) => {
    list.forEach((u) => { if (u && u.id) cache.set(u.id, u); });
  });
  // For any id we asked about but server didn't return (deleted user), cache a
  // tombstone so we don't keep re-asking on every render.
  ids.forEach((id) => { if (!cache.has(id)) cache.set(id, null); });
  notify();
}

function scheduleFetch(ids) {
  let changed = false;
  ids.forEach((id) => {
    if (!id) return;
    if (cache.has(id)) return;
    if (!pendingIds.has(id)) { pendingIds.add(id); changed = true; }
  });
  if (changed && flushHandle === null) {
    flushHandle = setTimeout(flushNow, 50);
  }
}

export function useUsersBatch(ids) {
  const [, setTick] = useState(0);

  useEffect(() => {
    const cb = () => setTick((n) => n + 1);
    subscribers.add(cb);
    scheduleFetch(ids || []);
    return () => { subscribers.delete(cb); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [Array.isArray(ids) ? ids.join("|") : ""]);

  // Always return a fresh Map snapshot for the requested ids
  const out = new Map();
  (ids || []).forEach((id) => {
    if (cache.has(id)) {
      const u = cache.get(id);
      if (u) out.set(id, u);
    }
  });
  return out;
}

export function getCachedUser(id) {
  return cache.get(id) || null;
}
