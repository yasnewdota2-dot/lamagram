// Phase 25b — overlapping circular avatars for poll voters (and reusable elsewhere).
// Renders up to `max` overlapping avatars; if there are more voters, shows
// a "+N" text label next to the stack.
import React from "react";
import { useUsersBatch } from "../../lib/useUsersBatch";
import { resolveAsset } from "../../lib/api";

const Initial = ({ name, size }) => (
  <span
    className="flex items-center justify-center rounded-full font-medium text-white select-none"
    style={{
      width: size,
      height: size,
      fontSize: Math.max(8, Math.round(size * 0.45)),
      background: "linear-gradient(135deg,#3B9EFF,#A78BFA)",
    }}
  >
    {(name || "?").trim().charAt(0).toUpperCase()}
  </span>
);

export const AvatarStack = ({ ids = [], max = 3, size = 18, testId }) => {
  const usersMap = useUsersBatch(ids);
  if (!ids.length) return null;

  const shown = ids.slice(0, max);
  const extra = Math.max(0, ids.length - max);
  const overlap = Math.round(size * 0.35);

  return (
    <div className="flex items-center" data-testid={testId || "avatar-stack"}>
      <div className="flex">
        {shown.map((id, i) => {
          const u = usersMap.get(id);
          const name = u?.display_name || u?.username;
          const url = u?.avatar_url ? resolveAsset(u.avatar_url) : null;
          return (
            <div
              key={id}
              style={{
                marginInlineStart: i === 0 ? 0 : -overlap,
                width: size,
                height: size,
                borderRadius: "9999px",
                border: "1.5px solid var(--bg-glass-strong, rgba(255,255,255,0.15))",
                overflow: "hidden",
                background: "var(--bg-elevated, #18181F)",
              }}
              title={name || id}
            >
              {url ? (
                <img src={url} alt={name || ""} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              ) : (
                <Initial name={name} size={size} />
              )}
            </div>
          );
        })}
      </div>
      {extra > 0 && (
        <span className="text-[10px] opacity-75 ms-1.5" data-testid="avatar-stack-extra">
          +{extra}
        </span>
      )}
    </div>
  );
};

export default AvatarStack;
