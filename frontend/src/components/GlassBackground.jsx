import React from "react";

export const GlassBackground = () => (
  <div className="gm-bg-blobs" aria-hidden="true" data-testid="glass-background">
    <div className="gm-blob gm-blob-1" />
    <div className="gm-blob gm-blob-2" />
    <div className="gm-blob gm-blob-3" />
    <div
      className="absolute inset-0"
      style={{
        backgroundImage:
          "radial-gradient(rgba(255,255,255,0.045) 1px, transparent 1px)",
        backgroundSize: "22px 22px",
        opacity: 0.35,
        maskImage: "linear-gradient(180deg, rgba(0,0,0,0.9), transparent 70%)",
      }}
    />
  </div>
);
