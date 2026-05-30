import React, { useEffect } from "react";
import { X } from "lucide-react";

export const Lightbox = ({ src, onClose }) => {
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onClose?.();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!src) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-6"
      style={{ background: "rgba(0,0,0,0.78)", backdropFilter: "blur(18px)" }}
      onClick={onClose}
      data-testid="lightbox"
    >
      <button
        onClick={onClose}
        className="absolute top-5 right-5 w-10 h-10 rounded-full flex items-center justify-center text-white"
        style={{ background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.15)" }}
        aria-label="close"
        data-testid="lightbox-close"
      >
        <X className="w-5 h-5" />
      </button>
      <img
        src={src}
        alt=""
        onClick={(e) => e.stopPropagation()}
        className="max-h-[90vh] max-w-[92vw] rounded-2xl shadow-2xl"
        data-testid="lightbox-image"
      />
    </div>
  );
};
