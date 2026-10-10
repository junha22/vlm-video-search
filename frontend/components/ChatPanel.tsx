"use client";

import { useEffect, useRef, useState } from "react";
import { formatTime, type Clip } from "@/lib/api";
import { IconEdit, IconLogo, IconPlus, IconRefresh, IconSend, IconSparkles, IconX } from "./Icons";

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
  onShowClips,
  activeMsgId,
  searching,
  selectedCount,
  modelLabel,
}: {
  messages: Message[];
  expansion: boolean;
  onExpansionChange: (v: boolean) => void;
  onSubmit: (intent: string) => void;
  onRerun: (intent: string, queries: string[]) => void;
  onShowClips: (msgId: string, clipId?: string) => void;
  activeMsgId: string | null;
  searching: boolean;
  selectedCount: number;
  modelLabel: string;
}) {
  const [text, setText] = useState("");
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

  const submit = (value?: string) => {
    const v = (value ?? text).trim();
    if (!v || searching) return;
    onSubmit(v);
    setText("");
  };

  return (
    <section className="panel chat" aria-labelledby="chat-title">
      <header className="panel-head">
        <h2 id="chat-title">대화형 검색</h2>
        <button
          id="expansion-toggle"
          className="exp-toggle"
          onClick={() => onExpansionChange(!expansion)}
          title="사용자의 추상적 의도를 AI가 여러 검색 질의로 분해하여 검색 품질을 높입니다."
        >
          <IconSparkles size={14} />
          질의 확장
          <span className={`switch ${expansion ? "on" : ""}`} />
        </button>
      </header>

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
                <button key={s} className="suggest-chip" onClick={() => submit(s)} disabled={searching}>
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
                        <QueryEditor msg={m} disabled={searching} onRerun={onRerun} />
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
        <div className={`composer ${searching ? "busy" : ""}`}>
          <textarea
            id="intent-input"
            ref={taRef}
            rows={1}
            placeholder={messages.length ? "후속 질문을 입력하세요 (예: 좀 더 짧은 컷으로, 야간 장면은 제외)" : "예: 부대 홍보영상 도입부에 쓸 활기찬 훈련 장면"}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                submit();
              }
            }}
          />
          <button id="intent-submit" className="send-btn" disabled={!text.trim() || searching} onClick={() => submit()}>
            {searching ? <span className="spinner" /> : <IconSend size={16} />}
          </button>
        </div>
        <div className="composer-hint">
          <span>
            대상 영상 <b>{selectedCount}</b>개
          </span>
          <span className="sep" />
          <span>{modelLabel}</span>
          <span className="sep" />
          <span>질의 확장 {expansion ? "ON" : "OFF"}</span>
        </div>
      </div>
    </section>
  );
}
