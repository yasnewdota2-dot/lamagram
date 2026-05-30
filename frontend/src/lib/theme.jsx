import React, { createContext, useContext, useEffect, useState } from "react";

const ThemeCtx = createContext({ theme: "dark", setTheme: () => {} });
const KEY = "glass_theme";

const apply = (t) => {
  const html = document.documentElement;
  html.setAttribute("data-theme", t);
  html.classList.remove("dark", "light");
  html.classList.add(t);
};

const initial = () => {
  if (typeof window === "undefined") return "dark";
  const stored = window.localStorage?.getItem(KEY);
  if (stored === "dark" || stored === "light") return stored;
  try {
    return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  } catch {
    return "dark";
  }
};

export const ThemeProvider = ({ children }) => {
  const [theme, setThemeState] = useState(initial);
  useEffect(() => { apply(theme); }, []); // eslint-disable-line
  const setTheme = (t) => {
    if (t !== "dark" && t !== "light") return;
    setThemeState(t);
    try { window.localStorage?.setItem(KEY, t); } catch {}
    apply(t);
  };
  return <ThemeCtx.Provider value={{ theme, setTheme }}>{children}</ThemeCtx.Provider>;
};

export const useTheme = () => useContext(ThemeCtx);
