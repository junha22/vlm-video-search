"use client";

import { formatNumber, type Usage } from "@/lib/api";
import { IconActivity, IconDashboard, IconLogo, IconSettings } from "./Icons";

export type View = "dashboard" | "settings";

const SOFT_BUDGET = 1_000_000; // 사용량 게이지 기준 (세션당 100만 토큰)

export default function Sidebar({
  view,
  onChange,
  usage,
}: {
  view: View;
  onChange: (v: View) => void;
  usage: Usage | null;
}) {
  const total = usage?.total_tokens ?? 0;
  const pct = Math.min(100, (total / SOFT_BUDGET) * 100);

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
            <IconActivity size={14} /> API 사용량
          </span>
          <span className="badge badge-muted">현재 세션</span>
        </div>
        <div className="sb-usage-value mono">{formatNumber(total)}</div>
        <div className="sb-usage-label">누적 토큰 (Total Tokens)</div>
        <div className="sb-bar">
          <span style={{ width: `${Math.max(pct, total > 0 ? 2 : 0)}%` }} />
        </div>
        <div className="sb-usage-meta">
          <span>입력 {formatNumber(usage?.prompt_tokens ?? 0)}</span>
          <span>출력 {formatNumber(usage?.output_tokens ?? 0)}</span>
          <span>{usage?.requests ?? 0}회</span>
        </div>
      </div>

      <div className="sb-foot">
        <span className="sb-foot-dot" />
        Powered by Gemini Video Understanding
      </div>
    </aside>
  );
}
