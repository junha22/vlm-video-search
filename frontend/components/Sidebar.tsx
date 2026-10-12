"use client";

import { formatNumber, type Usage } from "@/lib/api";
import { IconActivity, IconDashboard, IconLogo, IconSettings } from "./Icons";

export type View = "dashboard" | "settings";

export default function Sidebar({
  view,
  onChange,
  usage,
}: {
  view: View;
  onChange: (v: View) => void;
  usage: Usage | null;
}) {
  const used = usage?.total_tokens ?? 0;
  const promptTokens = usage?.prompt_tokens ?? 0;
  const outputTokens = usage?.output_tokens ?? 0;
  const requests = usage?.requests ?? 0;

  return (
    <aside className="sidebar">
      <div className="sb-brand">
        <IconLogo size={28} />
        <span>IntentCut</span>
      </div>

      <nav className="sb-nav" aria-label="메인 메뉴">
        <button
          id="nav-dashboard"
          className={`sb-item ${view === "dashboard" ? "active" : ""}`}
          onClick={() => onChange("dashboard")}
        >
          <IconDashboard size={17} />
          Dashboard
        </button>
        <button
          id="nav-settings"
          className={`sb-item ${view === "settings" ? "active" : ""}`}
          onClick={() => onChange("settings")}
        >
          <IconSettings size={17} />
          Settings
        </button>
      </nav>

      <div className="sb-spacer" />

      <div className="sb-usage">
        <div className="sb-usage-head">
          <span className="sb-usage-title">
            <IconActivity size={14} /> 토큰 사용량
          </span>
          <span className="badge badge-accent">영구 누적</span>
        </div>
        <div className="sb-usage-value mono">{formatNumber(used)}</div>
        <div className="sb-usage-label">총 누적 사용 토큰 (Total Tokens)</div>
        <div className="sb-usage-meta">
          <span>입력 {formatNumber(promptTokens)} · 출력 {formatNumber(outputTokens)}</span>
          <span>{requests}회 호출</span>
        </div>
      </div>

      <div className="sb-foot">
        <span className="sb-foot-dot" />
        Powered by Gemini Video Understanding
      </div>
    </aside>
  );
}
