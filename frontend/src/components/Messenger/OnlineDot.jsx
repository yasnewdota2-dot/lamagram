import React from "react";

export const OnlineDot = ({ online, size = 10, className = "", testId }) => (
  <span
    className={`inline-block rounded-full ${className}`}
    style={{
      width: size,
      height: size,
      background: online ? "#3B9EFF" : "rgba(255,255,255,0.18)",
      boxShadow: online ? "0 0 0 2px rgba(7,7,10,1), 0 0 10px rgba(59,158,255,0.7)" : "0 0 0 2px rgba(7,7,10,1)",
      animation: online ? "gmOnlinePulse 2s ease-in-out infinite" : "none",
    }}
    data-testid={testId || "online-dot"}
  />
);
