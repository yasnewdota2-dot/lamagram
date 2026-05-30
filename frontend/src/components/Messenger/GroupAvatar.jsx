import React, { memo } from "react";
import { resolveAsset } from "../../lib/api";

const GroupAvatarImpl = ({ group, size = 44, testId }) => {
  const url = group?.avatar_url ? resolveAsset(group.avatar_url) : null;
  const letter = (group?.title || "G").trim().charAt(0).toUpperCase();
  return (
    <div
      className="rounded-full flex items-center justify-center text-white font-semibold overflow-hidden shrink-0"
      style={{
        width: size,
        height: size,
        background: "linear-gradient(135deg,#3B9EFF,#A78BFA)",
        fontSize: size * 0.42,
      }}
      data-testid={testId || "group-avatar"}
    >
      {url ? (
        <img src={url} alt={group?.title || "group"} className="w-full h-full object-cover" loading="lazy" decoding="async" />
      ) : (
        <span>{letter}</span>
      )}
    </div>
  );
};
export const GroupAvatar = memo(GroupAvatarImpl);
