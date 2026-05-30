import React, { memo } from "react";
import { resolveAsset } from "../lib/api";

const UserAvatarImpl = ({ user, size = 40, ring = false, className = "", testId }) => {
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
        <img
          src={url}
          alt={user?.display_name || user?.username || "avatar"}
          className="w-full h-full object-cover"
          loading="lazy"
          decoding="async"
        />
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

const areEqual = (prev, next) => {
  if (prev.size !== next.size) return false;
  if (prev.ring !== next.ring) return false;
  if (prev.className !== next.className) return false;
  if (prev.testId !== next.testId) return false;
  const a = prev.user, b = next.user;
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.id === b.id &&
    a.username === b.username &&
    a.display_name === b.display_name &&
    a.avatar_url === b.avatar_url
  );
};

export const UserAvatar = memo(UserAvatarImpl, areEqual);
