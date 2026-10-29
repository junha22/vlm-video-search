"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, formatTime, youtubeWatchUrl, type Clip, type Video } from "@/lib/api";
import { IconDownload, IconMinus, IconPlay, IconPlus, IconScissors, IconThumbDown, IconThumbUp, IconYoutube } from "./Icons";
import YouTubePlayer from "./YouTubePlayer";

const STEP = 0.5;

function confClass(c: string) {
  if (c.includes("높")) return "badge-success";
  if (c.includes("낮")) return "badge-danger";
  return "badge-warn";
}

function TimeAdjust({
  label,
  value,
  onChange,
  onSetCurrent,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  onSetCurrent: () => void;
}) {
  return (
    <div className="ta">
      <span className="ta-label">{label}</span>
      <div className="ta-ctrl">
        <button className="ta-btn" onClick={() => onChange(value - STEP)} title={`-${STEP}s`}>
          <IconMinus size={12} />
        </button>
        <span className="mono ta-val">{formatTime(value)}</span>
        <button className="ta-btn" onClick={() => onChange(value + STEP)} title={`+${STEP}s`}>
          <IconPlus size={12} />
        </button>
      </div>
      <button className="ta-now" onClick={onSetCurrent} title="현재 재생 위치로 설정">
        현재 위치
      </button>
    </div>
  );
}

export default function ClipPanel({
  clips,
  videos,
  activeId,
  playNonce,
  onSelect,
  onUpdate,
  onFeedback,
  locked = false,
}: {
  clips: Clip[];
  videos: Video[];
  activeId: string | null;
  playNonce: number;
  onSelect: (id: string) => void;
  onUpdate: (id: string, patch: Partial<Clip>) => void;
  onFeedback: (clip: Clip, label: "good" | "bad") => void;
  locked?: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const stopAtOut = useRef(false);
  const [cur, setCur] = useState(0);
  const [dur, setDur] = useState(0);
  const [ytKey, setYtKey] = useState(0);

  const videoOf = (c: Clip | null) => (c?.video_id ? videos.find((v) => v.id === c.video_id) : undefined);
  const active = clips.find((c) => c.id === activeId) ?? null;
  const activeVideo = videoOf(active);
  // 서버에 파일이 있으면 직접 스트리밍, 유튜브 링크 모드면 유튜브 플레이어로 미리보기
  const src = activeVideo?.has_file ? api.streamUrl(activeVideo.id) : null;
  const ytId = !src && activeVideo?.youtube_id ? activeVideo.youtube_id : null;
  const currentTime = () => (ytId ? cur : videoRef.current?.currentTime);

  const playRange = useCallback(() => {
    if (ytId) {
      setYtKey((k) => k + 1);
      return;
    }
    const v = videoRef.current;
    if (!v || !active) return;
    const go = () => {
      v.currentTime = active.start_time;
      stopAtOut.current = true;
      v.play().catch(() => {});
    };
    if (v.readyState >= 1 && v.currentSrc === src) go();
    else v.addEventListener("loadedmetadata", go, { once: true });
  }, [active, src, ytId]);

  // 클립 선택 / 구간 재생 요청 시 해당 IN 지점부터 재생
  useEffect(() => {
    playRange();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, playNonce]);

  const clamp = (clip: Clip, patch: Partial<Clip>) => {
    let s = patch.start_time ?? clip.start_time;
    let e = patch.end_time ?? clip.end_time;
    const max = dur || Infinity;
    s = Math.max(0, Math.min(s, e - STEP));
    e = Math.min(max, Math.max(e, s + STEP));
    onUpdate(clip.id, { start_time: Math.round(s * 10) / 10, end_time: Math.round(e * 10) / 10 });
  };

  const pct = (t: number) => (dur ? `${(t / dur) * 100}%` : "0%");

  return (
    <section className={`panel ${locked ? "panel-locked" : ""}`} aria-labelledby="clips-title">
      <header className="panel-head">
        <h2 id="clips-title">추천 클립</h2>
        {clips.length > 0 && <span className="badge badge-accent">{clips.length}개 후보</span>}
      </header>

      {locked && (
        <div className="panel-lock-banner">
          <span className="lock-icon">🔒</span>
          <div className="lock-info">
            <strong>3단계: 추천 결과 대기</strong>
            <p>왼쪽에서 영상을 선택하고 가운데에서 검색을 진행하면 추천 클립이 표시됩니다.</p>
          </div>
        </div>
      )}

      <div className="panel-scroll">
        <div className="player">
          {src ? (
            <>
              <video
                ref={videoRef}
                src={src}
                controls
                playsInline
                preload="metadata"
                onLoadedMetadata={(e) => setDur(e.currentTarget.duration)}
                onTimeUpdate={(e) => {
                  const v = e.currentTarget;
                  setCur(v.currentTime);
                  if (active && stopAtOut.current && v.currentTime >= active.end_time) {
                    v.pause();
                    stopAtOut.current = false;
                  }
                }}
                onSeeking={(e) => {
                  if (active && (e.currentTarget.currentTime < active.start_time - 0.3 || e.currentTarget.currentTime > active.end_time)) {
                    stopAtOut.current = false;
                  }
                }}
              />
              {active && dur > 0 && (
                <div className="timeline" title="전체 영상 중 추천 구간">
                  <span className="tl-range" style={{ left: pct(active.start_time), width: pct(active.end_time - active.start_time) }} />
                  <span className="tl-head" style={{ left: pct(cur) }} />
                </div>
              )}
            </>
          ) : ytId && active ? (
            <>
              <YouTubePlayer
                videoId={ytId}
                start={active.start_time}
                end={active.end_time}
                playKey={ytKey}
                onTime={setCur}
                onDuration={setDur}
              />
              {dur > 0 && (
                <div className="timeline" title="전체 영상 중 추천 구간">
                  <span className="tl-range" style={{ left: pct(active.start_time), width: pct(active.end_time - active.start_time) }} />
                  <span className="tl-head" style={{ left: pct(cur) }} />
                </div>
              )}
            </>
          ) : (
            <div className="player-empty">
              <div className="pe-icon">
                <IconScissors size={22} />
              </div>
              <p>{active ? "이 클립의 원본 영상을 찾을 수 없습니다" : "클립을 선택하면 해당 구간을 미리보기로 재생합니다"}</p>
            </div>
          )}
        </div>

        {clips.length === 0 ? (
          <div className="clip-skeletons">
            {[0, 1, 2].map((i) => (
              <div key={i} className="clip-ghost">
                <div className="skeleton" style={{ width: 28, height: 28, borderRadius: 8 }} />
                <div style={{ flex: 1, display: "grid", gap: 8 }}>
                  <div className="skeleton" style={{ height: 10, width: "60%" }} />
                  <div className="skeleton" style={{ height: 8, width: "90%" }} />
                </div>
              </div>
            ))}
            <p className="muted center small">제작 의도를 입력하면 후보 클립이 순위별로 표시됩니다</p>
          </div>
        ) : (
          <ol className="clip-list">
            {clips.map((c) => {
              const isActive = c.id === activeId;
              const cv = videoOf(c);
              return (
                <li
                  key={c.id}
                  id={`clip-${c.id}`}
                  className={`clip-card fade-up ${isActive ? "active" : ""}`}
                  onClick={() => !isActive && onSelect(c.id)}
                >
                  <div className="clip-top">
                    <span className={`rank r${c.rank}`}>{c.rank}</span>
                    <div className="clip-title">
                      <div className="clip-name" title={c.video_name}>
                        {c.video_name}
                      </div>
                      {/* 넓으면 한 줄, 좁으면 IN / OUT 두 줄 (shell.css 컨테이너 쿼리) */}
                      <div className="clip-time mono">
                        <span className="tc-range">
                          <span className="tc in">IN {formatTime(c.start_time)}</span>
                          <span className="arrow">→</span>
                          <span className="tc out">OUT {formatTime(c.end_time)}</span>
                        </span>
                        <span className="muted tc-dur">· {(c.end_time - c.start_time).toFixed(1)}s</span>
                      </div>
                    </div>
                    <span className={`badge ${confClass(c.confidence)}`}>신뢰도 {c.confidence}</span>
                  </div>

                  {c.matched_query && <div className="clip-query">#{c.matched_query}</div>}
                  <p className="clip-reason">{c.reason}</p>

                  {isActive && (
                    <div className="clip-adjust fade-up" onClick={(e) => e.stopPropagation()}>
                      <TimeAdjust
                        label="IN"
                        value={c.start_time}
                        onChange={(v) => clamp(c, { start_time: v })}
                        onSetCurrent={() => clamp(c, { start_time: currentTime() ?? c.start_time })}
                      />
                      <TimeAdjust
                        label="OUT"
                        value={c.end_time}
                        onChange={(v) => clamp(c, { end_time: v })}
                        onSetCurrent={() => clamp(c, { end_time: currentTime() ?? c.end_time })}
                      />
                    </div>
                  )}

                  <div className="clip-actions" onClick={(e) => e.stopPropagation()}>
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() => (isActive ? playRange() : onSelect(c.id))}
                      disabled={!cv}
                    >
                      <IconPlay size={11} /> 구간 재생
                    </button>
                    {cv && !cv.has_file && cv.youtube_id ? (
                      // 유튜브 링크 모드: 서버에 원본이 없어 MP4 클립 대신 해당 시점의 유튜브 링크 제공
                      <a
                        className="btn btn-ghost btn-sm"
                        href={youtubeWatchUrl(cv.youtube_id, c.start_time)}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <IconYoutube size={13} /> YouTube
                      </a>
                    ) : (
                      <a
                        className={`btn btn-ghost btn-sm ${!cv ? "disabled" : ""}`}
                        href={cv ? api.clipUrl(cv.id, c.start_time, c.end_time) : undefined}
                        download
                      >
                        <IconDownload size={13} /> 다운로드
                      </a>
                    )}
                    <div className="fb">
                      <button
                        className={`fb-btn good ${c.feedback === "good" ? "on" : ""}`}
                        onClick={() => onFeedback(c, "good")}
                        title="적합함"
                      >
                        <IconThumbUp size={14} />
                      </button>
                      <button
                        className={`fb-btn bad ${c.feedback === "bad" ? "on" : ""}`}
                        onClick={() => onFeedback(c, "bad")}
                        title="부적합"
                      >
                        <IconThumbDown size={14} />
                      </button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </section>
  );
}
