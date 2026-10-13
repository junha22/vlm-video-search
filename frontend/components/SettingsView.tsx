"use client";

import { API_BASE, formatNumber, type Health, type ModelInfo, type Usage } from "@/lib/api";
import { IconActivity, IconCheck, IconCpu, IconSparkles, IconX } from "./Icons";

export default function SettingsView({
  models,
  model,
  onModelChange,
  usage,
  health,
  expansion,
  onExpansionChange,
  numClips,
  onNumClipsChange,
}: {
  models: ModelInfo[];
  model: string;
  onModelChange: (id: string) => void;
  usage: Usage | null;
  health: Health | null;
  expansion: boolean;
  onExpansionChange: (v: boolean) => void;
  numClips: number;
  onNumClipsChange: (n: number) => void;
}) {
  return (
    <div className="settings">
      <section className="set-section fade-up">
        <div className="set-head">
          <IconCpu size={16} />
          <div>
            <h2>분석 모델</h2>
            <p>영상 분석과 편집점 추천에 쓸 Gemini 모델을 고르세요.</p>
          </div>
        </div>
        <div className="model-grid">
          {models.map((m) => {
            const u = usage?.by_model?.[m.id];
            return (
              <button
                key={m.id}
                id={`settings-model-${m.id}`}
                className={`model-card ${m.id === model ? "selected" : ""}`}
                onClick={() => onModelChange(m.id)}
              >
                <div className="mc-top">
                  <span className="mc-radio">{m.id === model && <IconCheck size={10} />}</span>
                  <span className="mc-label">{m.label}</span>
                </div>
                <p className="mc-desc">{m.desc}</p>
                <div className="mc-foot mono">
                  <span>{m.id}</span>
                  <span>{u ? `${formatNumber(u.tokens)} tok · ${u.requests}회` : "미사용"}</span>
                </div>
              </button>
            );
          })}
        </div>
      </section>

      <section className="set-section fade-up">
        <div className="set-head">
          <IconSparkles size={16} />
          <div>
            <h2>검색 파이프라인</h2>
            <p>질의 확장 → 컷 탐색 → 편집 추천 3단계 파이프라인 설정</p>
          </div>
        </div>
        <div className="set-rows">
          <div className="set-row">
            <div>
              <div className="sr-title">질의 확장 (Query Expansion)</div>
              <div className="sr-desc">추상적인 제작 의도를 구체적인 장면 묘사 3개로 나눠 검색 범위를 넓힙니다. 켜고 끈 결과를 비교 실험해 볼 수 있습니다.</div>
            </div>
            <button id="settings-expansion" className={`switch ${expansion ? "on" : ""}`} onClick={() => onExpansionChange(!expansion)} aria-label="질의 확장" />
          </div>
          <div className="set-row">
            <div>
              <div className="sr-title">추천 클립 개수</div>
              <div className="sr-desc">한 번 검색할 때 추천받을 후보 클립 수</div>
            </div>
            <div className="seg">
              {[3, 4, 5].map((n) => (
                <button key={n} className={`seg-btn ${numClips === n ? "on" : ""}`} onClick={() => onNumClipsChange(n)}>
                  {n}
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="set-section fade-up">
        <div className="set-head">
          <IconActivity size={16} />
          <div>
            <h2>API 사용량</h2>
            <p>호출 시마다 자동 저장되어 서버 재시작 후에도 영구 보존되는 토큰 사용량</p>
          </div>
        </div>
        <div className="stat-grid">
          <div className="stat">
            <span>총 누적 사용 토큰</span>
            <b className="mono" style={{ color: "var(--accent-glow)" }}>
              {formatNumber(usage?.total_tokens ?? 0)}
            </b>
          </div>
          <div className="stat">
            <span>프롬프트 (입력)</span>
            <b className="mono">{formatNumber(usage?.prompt_tokens ?? 0)}</b>
          </div>
          <div className="stat">
            <span>응답 (출력)</span>
            <b className="mono">{formatNumber(usage?.output_tokens ?? 0)}</b>
          </div>
          <div className="stat">
            <span>요청 수</span>
            <b className="mono">{formatNumber(usage?.requests ?? 0)}회</b>
          </div>
        </div>
      </section>

      <section className="set-section fade-up">
        <div className="set-head">
          <IconCheck size={16} />
          <div>
            <h2>시스템 상태</h2>
            <p>백엔드: <span className="mono">{API_BASE || "같은 주소 (단일 서버 배포)"}</span></p>
          </div>
        </div>
        <div className="health">
          {[
            { k: "백엔드 서버", ok: !!health?.ok },
            { k: "Gemini API Key (.env)", ok: !!health?.api_key },
            { k: "ffmpeg (클립 다운로드)", ok: !!health?.ffmpeg },
          ].map((h) => (
            <div key={h.k} className={`health-item ${h.ok ? "ok" : "bad"}`}>
              <span className="hi-icon">{h.ok ? <IconCheck size={11} /> : <IconX size={11} />}</span>
              {h.k}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
