import React from "react";

// Phase 25b: only renders when actually online. Offline = nothing.
// Callers also restrict to DM kind (no online dot for group/channel).
export const OnlineDot = ({ online, size = 10, className = "", testId }) => {
  if (!online) return null;
  return (
    <span
      className={`inline-block rounded-full ${className}`}
      style={{
        width: size,
        height: size,
        background: "#3B9EFF",
        boxShadow: "0 0 0 2px var(--bg-base, #07070A), 0 0 10px rgba(59,158,255,0.7)",
        animation: "gmOnlinePulse 2s ease-in-out infinite",
      }}
      data-testid={testId || "online-dot"}
      aria-label="online"
    />
  );
};
