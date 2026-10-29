"use client";

import { useEffect, useState } from "react";
import { getTheme, setTheme, type Theme } from "@/lib/theme";
import { IconMoon, IconSun } from "./Icons";

export default function ThemeToggle() {
  const [theme, setThemeState] = useState<Theme | null>(null);

  useEffect(() => {
    setThemeState(getTheme());
  }, []);

  const next: Theme = theme === "light" ? "dark" : "light";
  return (
    <button
      id="theme-toggle"
      className="btn-icon"
      onClick={() => {
        setTheme(next);
        setThemeState(next);
      }}
      title={next === "light" ? "라이트 모드로 전환" : "다크 모드로 전환"}
      aria-label={next === "light" ? "라이트 모드로 전환" : "다크 모드로 전환"}
    >
      {theme === "light" ? <IconMoon size={16} /> : <IconSun size={16} />}
    </button>
  );
}
