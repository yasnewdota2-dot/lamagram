import React from "react";

export const TypingDots = ({ label, testId }) => (
  <span className="inline-flex items-center gap-1" data-testid={testId || "typing-dots"}>
    <span className="gm-typing-dot" />
    <span className="gm-typing-dot" style={{ animationDelay: "0.15s" }} />
    <span className="gm-typing-dot" style={{ animationDelay: "0.3s" }} />
    {label ? <span className="ml-2 text-xs text-[#9ABEFF]">{label}</span> : null}
  </span>
);
