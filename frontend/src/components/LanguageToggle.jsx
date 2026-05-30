import React from "react";
import { Languages } from "lucide-react";
import { useI18n } from "../lib/i18n";

export const LanguageToggle = ({ compact = false }) => {
  const { lang, setLang } = useI18n();
  const next = lang === "en" ? "fa" : "en";

  return (
    <button
      onClick={() => setLang(next)}
      className="gm-btn-ghost gm-focus-ring"
      style={{ padding: compact ? "8px 12px" : "10px 16px", fontSize: "0.8rem" }}
      data-testid="language-toggle-button"
      aria-label="Toggle language"
    >
      <Languages className="w-4 h-4" />
      <span style={{ fontFamily: "Inter" }}>{lang === "en" ? "EN" : "FA"}</span>
      <span className="text-[var(--gm-text-muted)]">→</span>
      <span style={{ fontFamily: next === "fa" ? "Vazirmatn" : "Inter" }}>
        {next === "en" ? "EN" : "FA"}
      </span>
    </button>
  );
};
