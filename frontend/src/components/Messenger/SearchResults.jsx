import React, { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useI18n } from "../../lib/i18n";
import { useMessengerActions } from "../../lib/messenger";
import { UserAvatar } from "../Avatar";
import { OnlineDot } from "./OnlineDot";

export const SearchResults = ({ query, onPick }) => {
  const { t } = useI18n();
  const { searchUsers } = useMessengerActions();
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const q = query.trim();
    if (!q) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const id = setTimeout(async () => {
      try {
        const data = await searchUsers(q);
        if (!cancelled) setResults(data || []);
      } catch {
        if (!cancelled) setResults([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(id);
    };
  }, [query, searchUsers]);

  if (!query.trim()) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: -4 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.18 }}
        className="mt-3 rounded-2xl overflow-hidden"
        style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.10)" }}
        data-testid="search-results"
      >
        {loading && (
          <div className="px-4 py-3 text-xs text-[var(--gm-text-muted)]">{t("loading")}</div>
        )}
        {!loading && results.length === 0 && (
          <div className="px-4 py-3 text-xs text-[var(--gm-text-muted)]" data-testid="search-no-results">
            {t("noUsersFound")}
          </div>
        )}
        {!loading &&
          results.map((u) => (
            <button
              key={u.id}
              onClick={() => onPick(u)}
              className="w-full text-left flex items-center gap-3 px-3 py-2.5 hover:bg-white/[0.06] transition-colors"
              data-testid={`search-result-${u.username}`}
            >
              <div className="relative">
                <UserAvatar user={u} size={36} />
                {u.is_online && (
                  <span className="absolute -bottom-0.5 right-0">
                    <OnlineDot online size={9} />
                  </span>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-white text-sm font-medium truncate">{u.display_name}</div>
                <div className="text-xs text-[var(--gm-text-muted)] truncate">@{u.username}</div>
              </div>
            </button>
          ))}
      </motion.div>
    </AnimatePresence>
  );
};
