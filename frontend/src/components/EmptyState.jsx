import React from "react";

export const EmptyState = ({ icon: Icon, title, subtitle, testId }) => (
  <div
    className="flex flex-col items-center justify-center py-12 px-6 text-center"
    data-testid={testId || "empty-state"}
  >
    {Icon && (
      <Icon
        size={56}
        className="opacity-30 mb-3"
        style={{ color: "var(--text-muted)" }}
      />
    )}
    {title && (
      <div className="text-sm" style={{ color: "var(--text-secondary)" }}>
        {title}
      </div>
    )}
    {subtitle && (
      <div
        className="text-xs mt-1"
        style={{ color: "var(--text-muted)" }}
      >
        {subtitle}
      </div>
    )}
  </div>
);

export default EmptyState;
