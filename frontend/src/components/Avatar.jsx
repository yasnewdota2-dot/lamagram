import React from "react";
import { resolveAsset } from "../lib/api";

export const UserAvatar = ({ user, size = 40, ring = false, className = "", testId }) => {
  const url = user?.avatar_url ? resolveAsset(user.avatar_url) : null;
  const initials = (user?.display_name || user?.username || "?")
    .split(" ")
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  const inner = (
    <div
      className={`flex items-center justify-center rounded-full overflow-hidden text-white font-semibold ${className}`}
      style={{
        width: size,
        height: size,
        background: "linear-gradient(135deg,#1a2240,#3b2a5b)",
        fontSize: size * 0.38,
      }}
      data-testid={testId || "user-avatar"}
    >
      {url ? (
        <img src={url} alt={user?.display_name || user?.username || "avatar"} className="w-full h-full object-cover" />
      ) : (
        <span>{initials}</span>
      )}
    </div>
  );

  if (!ring) return inner;
  return (
    <div className="gm-avatar-ring" style={{ width: size + 4, height: size + 4 }}>
      {inner}
    </div>
  );
};
