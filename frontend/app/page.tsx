"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { api, formatTime, type Clip, type Health, type HistoryItem, type ModelInfo, type Usage, type Video } from "@/lib/api";
import Splitter from "@/components/Splitter";
import Sidebar, { type View } from "@/components/Sidebar";
import TopBar from "@/components/TopBar";
import SourcePanel from "@/components/SourcePanel";
import ChatPanel, { type Message } from "@/components/ChatPanel";
import ClipPanel from "@/components/ClipPanel";
import SettingsView from "@/components/SettingsView";

const FALLBACK_MODELS: ModelInfo[] = [
  { id: "gemini-3.1-pro", label: "Gemini 3.1 Pro", desc: "최고 정확도 · 복잡한 의도 분석 · 유료 키 전용" },
  { id: "gemini-3.8-flash", label: "Gemini 3.8 Flash", desc: "빠른 속도 · 균형 잡힌 성능" },
  { id: "gemini-3.8-flash-agentic", label: "Gemini 3.8 Flash (에이전틱)", desc: "다단계 추론 · 에이전트형 탐색" },
  { id: "gemini-3.1-flash-lite", label: "Gemini 3.1 Flash-Lite", desc: "초경량 · 최저 비용 · 무료 키 기본값" },
];
// 3.1 Pro 는 무료 등급이 없어 무료 키로는 모든 검색이 실패하므로 Flash-Lite 를 기본값으로
const DEFAULT_MODEL = "gemini-3.1-flash-lite";

const BUSY = new Set(["queued", "downloading", "uploading", "processing"]);

// 패널 너비 (px): 기본값 · 최소/최대. 가운데 대화 패널은 남는 공간을 쓰되 최소 360px 유지
const COLS_KEY = "intentcut:cols";
const DEFAULT_COLS = { left: 300, right: 380 };
const COL_LIMITS = { left: [220, 480], right: [300, 720], center: 360 } as const;
const clampNum = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));
const uid = () => Math.random().toString(36).slice(2, 10);

interface Toast {
  id: string;
  text: string;
  kind: "error" | "info" | "success";
}

export default function Home() {
  const [view, setView] = useState<View>("dashboard");
  const [models, setModels] = useState<ModelInfo[]>(FALLBACK_MODELS);
  const [model, setModel] = useState(DEFAULT_MODEL);
  const [expansion, setExpansion] = useState(true);
  const [numClips, setNumClips] = useState(3);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [connected, setConnected] = useState<boolean | null>(null);

  const [videos, setVideos] = useState<Video[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [activeMsgId, setActiveMsgId] = useState<string | null>(null);
  const [activeClipId, setActiveClipId] = useState<string | null>(null);
  const [playNonce, setPlayNonce] = useState(0);
  const [searching, setSearching] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [cols, setCols] = useState(DEFAULT_COLS);
  const workspaceRef = useRef<HTMLDivElement>(null);
  const loaded = useRef(false);

  const toast = useCallback((text: string, kind: Toast["kind"] = "error") => {
    const id = uid();
    setToasts((t) => [...t, { id, text, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 5000);
  }, []);

  // ---------- 초기 로드 ----------
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("intentcut:prefs") || "{}");
      if (saved.model) setModel(saved.model);
      if (typeof saved.expansion === "boolean") setExpansion(saved.expansion);
      if (saved.numClips) setNumClips(saved.numClips);
      const savedCols = JSON.parse(localStorage.getItem(COLS_KEY) || "null");
      if (savedCols?.left && savedCols?.right) setCols({ left: savedCols.left, right: savedCols.right });
    } catch {}
    loaded.current = true;

    api.health().then((h) => {
      setHealth(h);
      setConnected(true);
    }).catch(() => setConnected(false));
    api.models().then(setModels).catch(() => {});
    api.usage().then(setUsage).catch(() => {});
    api.videos().then(setVideos).catch(() => {});
  }, []);

  useEffect(() => {
    if (loaded.current) localStorage.setItem("intentcut:prefs", JSON.stringify({ model, expansion, numClips }));
  }, [model, expansion, numClips]);

  useEffect(() => {
    if (loaded.current) localStorage.setItem(COLS_KEY, JSON.stringify(cols));
  }, [cols]);

  // ---------- 패널 너비 조절 ----------
  const resizeCol = (side: "left" | "right", dx: number) => {
    setCols((c) => {
      const total = workspaceRef.current?.clientWidth ?? Infinity;
      const other = side === "left" ? c.right : c.left;
      const [min, max] = COL_LIMITS[side];
      // 가운데 패널이 최소 너비 아래로 줄지 않도록 (양쪽 여백 + 손잡이 2개 = 약 56px)
      const room = total - other - COL_LIMITS.center - 56;
      const next = side === "left" ? c.left + dx : c.right - dx;
      return { ...c, [side]: clampNum(next, min, Math.max(min, Math.min(max, room))) };
    });
  };
  const resetCol = (side: "left" | "right") => setCols((c) => ({ ...c, [side]: DEFAULT_COLS[side] }));

  // ---------- 처리 중인 영상 상태 폴링 ----------
  const anyBusy = videos.some((v) => BUSY.has(v.status));
  useEffect(() => {
    if (!anyBusy) return;
    const t = setInterval(() => {
      api.videos().then((list) => {
        setVideos((prev) => {
          prev.forEach((p) => {
            const n = list.find((x) => x.id === p.id);
            if (n && BUSY.has(p.status) && n.status === "ready") toast(`'${n.name}' 분석 준비 완료`, "success");
            if (n && BUSY.has(p.status) && n.status === "error") toast(`'${n.name}' 처리 실패: ${n.error}`);
          });
          return list;
        });
      }).catch(() => setConnected(false));
    }, 2000);
    return () => clearInterval(t);
  }, [anyBusy, toast]);

  // ---------- 영상 소스 ----------
  const addYoutube = async (url: string) => {
    try {
      const v = await api.youtube(url);
      setVideos((p) => [...p, v]);
    } catch (e) {
      toast((e as Error).message);
    }
  };
  const upload = async (files: File[]) => {
    const limitMb = health?.max_upload_mb;
    if (limitMb && files.reduce((sum, f) => sum + f.size, 0) > limitMb * 1024 * 1024) {
      toast(`업로드 용량 제한(${limitMb}MB)을 초과했습니다. 파일을 나누거나 줄여서 올려주세요.`);
      return;
    }
    try {
      const list = await api.upload(files);
      setVideos((p) => [...p, ...list]);
    } catch (e) {
      toast((e as Error).message);
    }
  };
  const toggleVideo = (id: string, selected: boolean) => {
    setVideos((p) => p.map((v) => (v.id === id ? { ...v, selected } : v)));
    api.select(id, selected).catch((e) => toast(e.message));
  };
  const toggleAll = (selected: boolean) => {
    videos.filter((v) => v.status === "ready").forEach((v) => toggleVideo(v.id, selected));
  };
  const deleteVideo = async (id: string) => {
    try {
      await api.remove(id);
      setVideos((p) => p.filter((v) => v.id !== id));
    } catch (e) {
      toast((e as Error).message);
    }
  };

  const selectedIds = useMemo(() => videos.filter((v) => v.status === "ready" && v.selected).map((v) => v.id), [videos]);
  const modelLabel = models.find((m) => m.id === model)?.label ?? model;

  // ---------- 검색 ----------
  // more: "다른 후보 보기" - 이전에 추천한 구간을 빼고 새 후보만 받음
  const runSearch = async (intent: string, queries: string[] | null, more = false) => {
    if (selectedIds.length === 0) {
      toast("검색할 영상이 없습니다. 왼쪽 패널에서 영상을 추가하고 선택해주세요.", "info");
      return;
    }
    // 이전 대화: 의도 + 추천했던 구간 + 👍/👎 → AI 가 후속 요청을 이어서 해석하고 같은 후보를 반복하지 않도록
    const history: HistoryItem[] = messages
      .filter((m) => m.role === "assistant" && m.intent && !m.error && !m.loading)
      .map((m) => ({
        intent: m.intent!,
        clips: (m.clips ?? []).map((c) => ({
          video_name: c.video_name,
          start_time: c.start_time,
          end_time: c.end_time,
          feedback: c.feedback ?? null,
        })),
      }));

    const useExp = queries ? true : expansion;
    const userMsg: Message = {
      id: uid(),
      role: "user",
      content: more ? "↻ 다른 후보 보기" : queries ? `↻ 수정된 질의로 재검색 — ${queries.join(" / ")}` : intent,
    };
    const botId = uid();
    const botMsg: Message = { id: botId, role: "assistant", content: "", intent, loading: true, startedAt: Date.now(), usedExpansion: useExp };
    setMessages((m) => [...m, userMsg, botMsg]);
    setSearching(true);

    try {
      const res = await api.search({
        intent,
        model,
        use_expansion: useExp,
        video_ids: selectedIds,
        queries,
        history,
        num_clips: numClips,
        more,
      });
      const clips = res.clips.map((c) => ({ ...c, feedback: null }));
      setMessages((m) =>
        m.map((x) =>
          x.id === botId
            ? {
                ...x,
                loading: false,
                queries: res.expanded_queries,
                clips,
                model: modelLabel,
                content: clips.length
                  ? `${selectedIds.length}개 영상에서 ${clips.length}개의 추천 클립을 찾았습니다. 오른쪽 패널에서 미리보기 후 IN/OUT을 조정해 보세요.`
                  : "의도에 맞는 구간을 찾지 못했습니다. 다른 표현으로 다시 시도해 보세요.",
              }
            : x,
        ),
      );
      setUsage(res.usage);
      if (clips.length) {
        setActiveMsgId(botId);
        setActiveClipId(clips[0].id);
        setPlayNonce((n) => n + 1);
      }
    } catch (e) {
      setMessages((m) => m.map((x) => (x.id === botId ? { ...x, loading: false, error: (e as Error).message } : x)));
      api.usage().then(setUsage).catch(() => {});
    } finally {
      setSearching(false);
    }
  };

  const newChat = () => {
    if (searching) return;
    setMessages([]);
    setActiveMsgId(null);
    setActiveClipId(null);
  };

  // ---------- 클립 ----------
  const activeClips = messages.find((m) => m.id === activeMsgId)?.clips ?? [];

  const updateClip = (id: string, patch: Partial<Clip>) => {
    setMessages((m) =>
      m.map((x) => (x.id === activeMsgId ? { ...x, clips: x.clips?.map((c) => (c.id === id ? { ...c, ...patch } : c)) } : x)),
    );
  };

  const selectClip = (id: string) => {
    setActiveClipId(id);
    setPlayNonce((n) => n + 1);
  };

  const showClips = (msgId: string, clipId?: string) => {
    setActiveMsgId(msgId);
    if (clipId) selectClip(clipId);
  };

  const feedback = async (clip: Clip, label: "good" | "bad") => {
    const next = clip.feedback === label ? null : label;
    updateClip(clip.id, { feedback: next });
    if (!next) return;
    const intent = messages.find((m) => m.id === activeMsgId)?.intent ?? "";
    try {
      await api.feedback({ intent, video_name: clip.video_name, start_time: clip.start_time, end_time: clip.end_time, label, model });
      toast(`피드백 저장됨 (${label === "good" ? "적합" : "부적합"} · ${formatTime(clip.start_time)}~${formatTime(clip.end_time)})`, "success");
    } catch (e) {
      toast((e as Error).message);
    }
  };

  return (
    <div className="app">
      <Sidebar view={view} onChange={setView} usage={usage} />
      <main className="main">
        <TopBar
          title={view === "dashboard" ? "Dashboard" : "Settings"}
          subtitle={view === "dashboard" ? "의도 기반 편집 구간 추천" : "모델 · 파이프라인 · 사용량"}
          connected={connected}
          usage={usage}
          models={models}
          model={model}
          onModelChange={setModel}
          auth={!!health?.auth}
        />
        {view === "dashboard" ? (
          <div
            className="workspace"
            ref={workspaceRef}
            style={{ "--col-left": `${cols.left}px`, "--col-right": `${cols.right}px` } as CSSProperties}
          >
            <SourcePanel
              videos={videos}
              onAddYoutube={addYoutube}
              onUpload={upload}
              onToggle={toggleVideo}
              onToggleAll={toggleAll}
              onDelete={deleteVideo}
              youtubeMode={health?.youtube_mode}
              maxUploadMb={health?.max_upload_mb}
            />
            <Splitter label="영상 소스 패널 너비" onDrag={(dx) => resizeCol("left", dx)} onReset={() => resetCol("left")} />
            <ChatPanel
              messages={messages}
              expansion={expansion}
              onExpansionChange={setExpansion}
              onSubmit={(intent) => runSearch(intent, null)}
              onRerun={(intent, queries) => runSearch(intent, queries)}
              onMore={(m) => runSearch(m.intent ?? "", m.queries?.length ? m.queries : null, true)}
              onNewChat={newChat}
              onShowClips={showClips}
              activeMsgId={activeMsgId}
              searching={searching}
              selectedCount={selectedIds.length}
              modelLabel={modelLabel}
              locked={selectedIds.length === 0}
            />
            <Splitter label="추천 클립 패널 너비" onDrag={(dx) => resizeCol("right", dx)} onReset={() => resetCol("right")} />
            <ClipPanel
              clips={activeClips}
              videos={videos}
              activeId={activeClipId}
              playNonce={playNonce}
              onSelect={selectClip}
              onUpdate={updateClip}
              onFeedback={feedback}
              locked={selectedIds.length === 0}
            />
          </div>
        ) : (
          <div className="settings-wrap">
            <SettingsView
              models={models}
              model={model}
              onModelChange={setModel}
              usage={usage}
              health={health}
              expansion={expansion}
              onExpansionChange={setExpansion}
              numClips={numClips}
              onNumClipsChange={setNumClips}
            />
          </div>
        )}
      </main>

      <div className="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind} fade-up`}>
            {t.text}
          </div>
        ))}
      </div>
    </div>
  );
}
