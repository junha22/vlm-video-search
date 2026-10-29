"use client";

import { useEffect, useRef, useState } from "react";
import { formatTime, type Clip, type Quota } from "@/lib/api";
import { IconEdit, IconLogo, IconPlus, IconRefresh, IconSend, IconShuffle, IconSparkles, IconX } from "./Icons";

export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  intent?: string;
  queries?: string[];
  usedExpansion?: boolean;
  clips?: Clip[];
  loading?: boolean;
  error?: string;
  startedAt?: number;
  model?: string;
}

const SUGGESTIONS = [
  "부대 홍보영상 도입부에 쓸 활기찬 훈련 장면",
  "감동적인 엔딩에 어울리는 단체 경례 장면",
  "긴장감 있는 작전 수행 B-roll 컷",
];

const STEPS = ["질의 확장", "컷 탐색", "편집 추천"];

function Pipeline({ startedAt, expansion }: { startedAt: number; expansion: boolean }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, []);
  const elapsed = Math.max(0, (now - startedAt) / 1000);
  const step = !expansion ? (elapsed < 25 ? 1 : 2) : elapsed < 6 ? 0 : elapsed < 30 ? 1 : 2;

  return (
    <div className="pipeline">
      <div className="pipeline-steps">
        {STEPS.map((s, i) => {
          const skipped = !expansion && i === 0;
          const state = skipped ? "skip" : i < step ? "done" : i === step ? "active" : "todo";
          return (
            <div key={s} className={`pl-step ${state}`}>
              <span className="pl-dot">{state === "active" ? <span className="spinner" /> : i + 1}</span>
              <span>{s}</span>
              {skipped && <em>OFF</em>}
            </div>
          );
        })}
      </div>
      <div className="pipeline-meta">
        AI가 영상을 분석하고 있습니다 · <span className="mono">{elapsed.toFixed(0)}s</span>
        <span className="muted"> (보통 30초~2분)</span>
      </div>
      <div className="pipeline-bar">
        <span />
      </div>
    </div>
  );
}

function QueryEditor({
  msg,
  disabled,
  onRerun,
}: {
  msg: Message;
  disabled: boolean;
  onRerun: (intent: string, queries: string[]) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string[]>(msg.queries ?? []);

  if (!msg.queries || msg.queries.length === 0) {
    return msg.usedExpansion === false ? (
      <div className="q-off">질의 확장 OFF · 입력한 의도 그대로 탐색했습니다</div>
    ) : null;
  }

  return (
    <div className="q-block">
      <div className="q-head">
        <span>
          <IconSparkles size={13} /> 확장된 검색 질의
        </span>
        {!editing ? (
          <button
            className="link-btn"
            disabled={disabled}
            onClick={() => {
              setDraft(msg.queries ?? []);
              setEditing(true);
            }}
          >
            <IconEdit size={12} /> 수정
          </button>
        ) : (
          <button className="link-btn" onClick={() => setEditing(false)}>
            취소
          </button>
        )}
      </div>

      {!editing ? (
        <div className="q-chips">
          {msg.queries.map((q, i) => (
            <span key={i} className="q-chip">
              <b>{i + 1}</b>
              {q}
            </span>
          ))}
        </div>
      ) : (
        <div className="q-edit">
          {draft.map((q, i) => (
            <div key={i} className="q-edit-row">
              <span className="q-idx">{i + 1}</span>
              <input
                className="input"
                value={q}
                onChange={(e) => setDraft((d) => d.map((x, j) => (j === i ? e.target.value : x)))}
              />
              <button className="btn-icon" onClick={() => setDraft((d) => d.filter((_, j) => j !== i))} title="삭제">
                <IconX size={14} />
              </button>
            </div>
          ))}
          <div className="q-edit-actions">
            <button className="btn btn-ghost btn-sm" onClick={() => setDraft((d) => [...d, ""])} disabled={draft.length >= 6}>
              <IconPlus size={13} /> 질의 추가
            </button>
            <button
              className="btn btn-primary btn-sm"
              disabled={disabled || draft.filter((q) => q.trim()).length === 0}
              onClick={() => {
                setEditing(false);
                onRerun(msg.intent ?? "", draft.filter((q) => q.trim()));
              }}
            >
              <IconRefresh size={13} /> 수정된 질의로 재검색
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function ChatPanel({
  messages,
  expansion,
  onExpansionChange,
  onSubmit,
  onRerun,
  onMore,
  onNewChat,
  quota,
  onShowClips,
  activeMsgId,
  searching,
  selectedCount,
  modelLabel,
  locked = false,
}: {
  messages: Message[];
  expansion: boolean;
  onExpansionChange: (v: boolean) => void;
  onSubmit: (intent: string) => void;
  onRerun: (intent: string, queries: string[]) => void;
  onMore: (msg: Message) => void;
  onNewChat: () => void;
  quota?: Quota | null;
  onShowClips: (msgId: string, clipId?: string) => void;
  activeMsgId: string | null;
  searching: boolean;
  selectedCount: number;
  modelLabel: string;
  locked?: boolean;
}) {
  const [text, setText] = useState("");
  const [confirmNew, setConfirmNew] = useState(false); // "새 대화" 누르면 바로 지우지 않고 한 번 더 확인
  const bodyRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "0px";
    ta.style.height = Math.min(ta.scrollHeight, 160) + "px";
  }, [text]);

  // 이어서 검색할 때 AI 에 넘어가는 이전 대화 수, "다른 후보 보기"는 마지막 결과에만 표시
  const done = messages.filter((m) => m.role === "assistant" && m.intent && !m.loading && !m.error);
  const lastDoneId = done.length ? done[done.length - 1].id : null;

  const submit = (value?: string) => {
    if (locked) return;
    const v = (value ?? text).trim();
    if (!v || searching) return;
    onSubmit(v);
    setText("");
  };

  return (
    <section className={`panel chat ${locked ? "panel-locked" : ""}`} aria-labelledby="chat-title">
      <header className="panel-head">
        <h2 id="chat-title">대화형 검색</h2>
        <button
          id="expansion-toggle"
          className="exp-toggle"
          disabled={locked}
          onClick={() => onExpansionChange(!expansion)}
          title="사용자의 추상적 의도를 AI가 여러 검색 질의로 분해하여 검색 품질을 높입니다."
        >
          <IconSparkles size={14} />
          질의 확장
          <span className={`switch ${expansion ? "on" : ""}`} />
        </button>
      </header>

      {locked && (
        <div className="panel-lock-banner">
          <span className="lock-icon">🔒</span>
          <div className="lock-info">
            <strong>1단계: 영상 소스 준비 필요</strong>
            <p>영상 소스 패널에서 유튜브 링크를 추가하거나 파일을 업로드하고, 검색할 영상을 체크해주세요.</p>
          </div>
        </div>
      )}

      <div className="chat-body" ref={bodyRef}>
        {messages.length === 0 ? (
          <div className="hero">
            <div className="hero-glow" />
            <h2 className="hero-title">Find the Perfect Cut</h2>
            <p className="hero-sub">
              제작 의도(Editing Brief)를 입력하면 AI가 여러 영상 속에서
              <br />
              가장 잘 맞는 편집 구간(IN/OUT)을 찾아 추천합니다.
            </p>
            <div className="hero-steps">
              {STEPS.map((s, i) => (
                <div key={s} className="hero-step">
                  <span>{i + 1}</span>
                  {s}
                </div>
              ))}
            </div>
            <div className="hero-suggest">
              {SUGGESTIONS.map((s) => (
                <button key={s} className="suggest-chip" onClick={() => submit(s)} disabled={searching || locked}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="msgs">
            {messages.map((m) =>
              m.role === "user" ? (
                <div key={m.id} className="msg user fade-up">
                  <div className="bubble">{m.content}</div>
                </div>
              ) : (
                <div key={m.id} className="msg assistant fade-up">
                  <div className="avatar">
                    <IconLogo size={26} />
                  </div>
                  <div className="msg-content">
                    {m.loading ? (
                      <Pipeline startedAt={m.startedAt ?? Date.now()} expansion={m.usedExpansion !== false} />
                    ) : m.error ? (
                      <div className="msg-error">{m.error}</div>
                    ) : (
                      <>
                        <QueryEditor msg={m} disabled={searching || locked} onRerun={onRerun} />
                        <div className="msg-text">{m.content}</div>
                        {m.clips && m.clips.length > 0 && (
                          <div className={`result-list ${activeMsgId === m.id ? "active" : ""}`}>
                            {m.clips.map((c) => (
                              <button key={c.id} className="result-row" onClick={() => onShowClips(m.id, c.id)}>
                                <span className={`rank r${c.rank}`}>{c.rank}</span>
                                <span className="result-name">{c.video_name}</span>
                                <span className="mono result-time">
                                   {formatTime(c.start_time)} – {formatTime(c.end_time)}
                                </span>
                              </button>
                            ))}
                          </div>
                        )}
                        {m.id === lastDoneId && (
                          <button
                            className="btn btn-ghost btn-sm more-btn"
                            disabled={searching || locked}
                            onClick={() => onMore(m)}
                            title="이번에 추천한 구간을 빼고 다른 후보를 찾습니다"
                          >
                            <IconShuffle size={13} /> 다른 후보 보기
                          </button>
                        )}
                        {m.model && <div className="msg-foot">{m.model}</div>}
                      </>
                    )}
                  </div>
                </div>
              ),
            )}
          </div>
        )}
      </div>

      <div className="composer-wrap">
        <div className={`composer ${searching ? "busy" : ""} ${locked ? "disabled" : ""}`}>
          <textarea
            id="intent-input"
            ref={taRef}
            rows={1}
            disabled={locked}
            placeholder={
              locked
                ? "검색할 영상을 먼저 추가해주세요"
                : messages.length
                ? "후속 질문을 입력하세요 (예: 좀 더 짧은 컷으로, 야간 장면은 제외)"
                : "예: 부대 홍보영상 도입부에 쓸 활기찬 훈련 장면"
            }
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                submit();
              }
            }}
          />
          <button id="intent-submit" className="send-btn" disabled={!text.trim() || searching || locked} onClick={() => submit()}>
            {searching ? <span className="spinner" /> : <IconSend size={16} />}
          </button>
        </div>
        <div className="composer-hint">
          <span>
            대상 영상 <b>{selectedCount}</b>개
          </span>
          {quota?.limit ? (
            <span className={quota.remaining === 0 ? "quota-out" : undefined} title="한국 시간 자정에 다시 채워집니다">
              오늘 남은 검색 <b>{quota.remaining}</b>/{quota.limit}회
            </span>
          ) : null}
          {done.length > 0 && (
            <span className="ctx-chip">
              {confirmNew && !searching ? (
                <>
                  대화 기록을 모두 지울까요?
                  <button
                    id="new-chat-confirm"
                    className="link-btn danger"
                    onClick={() => {
                      setConfirmNew(false);
                      onNewChat();
                    }}
                  >
                    지우기
                  </button>
                  <button className="link-btn" onClick={() => setConfirmNew(false)}>
                    취소
                  </button>
                </>
              ) : (
                <>
                  이전 대화 {done.length}개를 이어서 검색합니다
                  <button id="new-chat-btn" className="link-btn" onClick={() => setConfirmNew(true)} disabled={searching}>
                    새 대화
                  </button>
                </>
              )}
            </span>
          )}
        </div>
      </div>
    </section>
  );
}
