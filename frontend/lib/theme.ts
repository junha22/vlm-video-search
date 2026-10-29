export type Theme = "light" | "dark";

const KEY = "intentcut:theme";

// <head> 에서 화면을 그리기 전에 실행 → 새로고침해도 테마가 깜빡이지 않음
// 저장된 선택이 없으면 운영체제 설정(라이트/다크)을 따름
export const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem("${KEY}");if(t!=="light"&&t!=="dark"){t=matchMedia("(prefers-color-scheme: light)").matches?"light":"dark"}document.documentElement.dataset.theme=t}catch(e){document.documentElement.dataset.theme="dark"}})();`;

export function getTheme(): Theme {
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}

export function setTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(KEY, theme);
  } catch {}
}
