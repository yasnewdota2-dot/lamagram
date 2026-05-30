import React from "react";
import { Check, CheckCheck } from "lucide-react";

export const Ticks = ({ status, testId }) => {
  if (status === "seen") {
    return (
      <CheckCheck
        className="w-3.5 h-3.5"
        style={{ color: "#5BB6FF" }}
        data-testid={testId || "tick-seen"}
      />
    );
  }
  if (status === "delivered") {
    return (
      <CheckCheck
        className="w-3.5 h-3.5"
        style={{ color: "rgba(255,255,255,0.55)" }}
        data-testid={testId || "tick-delivered"}
      />
    );
  }
  return (
    <Check
      className="w-3.5 h-3.5"
      style={{ color: "rgba(255,255,255,0.55)" }}
      data-testid={testId || "tick-sent"}
    />
  );
};
