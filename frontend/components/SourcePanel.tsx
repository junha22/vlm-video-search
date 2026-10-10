"use client";

import { useRef, useState } from "react";
import type { Video, VideoStatus } from "@/lib/api";
import { IconCheck, IconFilm, IconTrash, IconUpload, IconYoutube } from "./Icons";

const STATUS: Record<VideoStatus, { label: string; cls: string; busy: boolean }> = {
  queued: { label: "대기 중", cls: "badge-muted", busy: true },
  downloading: { label: "다운로드 중", cls: "badge-accent", busy: true },
  uploading: { label: "업로드 중", cls: "badge-accent", busy: true },
  processing: { label: "AI 분석 준비", cls: "badge-warn", busy: true },
  ready: { label: "준비 완료", cls: "badge-success", busy: false },
  error: { label: "오류", cls: "badge-danger", busy: false },
};

export default function SourcePanel({
  videos,
  onAddYoutube,
  onUpload,
  onToggle,
  onToggleAll,
  onDelete,
}: {
  videos: Video[];
  onAddYoutube: (url: string) => Promise<void>;
  onUpload: (files: File[]) => Promise<void>;
  onToggle: (id: string, selected: boolean) => void;
  onToggleAll: (selected: boolean) => void;
  onDelete: (id: string) => void;
}) {
  const [tab, setTab] = useState<"youtube" | "upload">("youtube");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const readyCount = videos.filter((v) => v.status === "ready").length;
  const selectedCount = videos.filter((v) => v.status === "ready" && v.selected).length;
  const allSelected = readyCount > 0 && selectedCount === readyCount;

  const submitYoutube = async () => {
    if (!url.trim() || busy) return;
    setBusy(true);
    try {
      await onAddYoutube(url.trim());
      setUrl("");
    } finally {
      setBusy(false);
    }
  };

  const handleFiles = async (list: FileList | null) => {
    if (!list || list.length === 0) return;
    setBusy(true);
    try {
      await onUpload(Array.from(list));
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <section className="panel" aria-labelledby="source-title">
      <header className="panel-head">
        <h2 id="source-title">영상 소스</h2>
        <span className="badge badge-muted">{videos.length}개</span>
      </header>

      <div className="panel-scroll">
        <div className="src-card">
          <div className="tabs" role="tablist">
            <button
              id="tab-youtube"
              role="tab"
              aria-selected={tab === "youtube"}
              className={`tab ${tab === "youtube" ? "active" : ""}`}
              onClick={() => setTab("youtube")}
            >
              <IconYoutube size={15} /> YouTube URL
            </button>
            <button
              id="tab-upload"
              role="tab"
              aria-selected={tab === "upload"}
              className={`tab ${tab === "upload" ? "active" : ""}`}
              onClick={() => setTab("upload")}
            >
              <IconUpload size={15} /> Upload File
            </button>
          </div>

          {tab === "youtube" ? (
            <div className="src-form fade-up" key="yt">
              <input
                id="youtube-url-input"
                className="input"
                placeholder="https://www.youtube.com/watch?v=..."
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && submitYoutube()}
              />
              <button id="youtube-add-btn" className="btn btn-primary" disabled={!url.trim() || busy} onClick={submitYoutube}>
                {busy ? <span className="spinner" /> : null}
                영상 추가
              </button>
            </div>
          ) : (
            <div className="src-form fade-up" key="up">
              <button
                id="upload-dropzone"
                className={`dropzone ${drag ? "drag" : ""}`}
                onClick={() => fileRef.current?.click()}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDrag(true);
                }}
                onDragLeave={() => setDrag(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDrag(false);
                  handleFiles(e.dataTransfer.files);
                }}
              >
                <span className="dz-icon">{busy ? <span className="spinner" /> : <IconUpload size={20} />}</span>
                <span className="dz-title">{busy ? "업로드 중..." : "클릭하거나 파일을 끌어다 놓으세요"}</span>
                <span className="dz-sub">MP4 · MOV · AVI · 여러 개 선택 가능</span>
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="video/mp4,video/quicktime,video/x-msvideo,.mp4,.mov,.avi"
                multiple
                hidden
                onChange={(e) => handleFiles(e.target.files)}
              />
            </div>
          )}
        </div>

        <div className="src-list-head">
          <span>
            검색 대상 <b>{selectedCount}</b>
            <span className="muted"> / {readyCount}</span>
          </span>
          {readyCount > 0 && (
            <button id="toggle-all-btn" className="link-btn" onClick={() => onToggleAll(!allSelected)}>
              {allSelected ? "전체 해제" : "전체 선택"}
            </button>
          )}
        </div>

        {videos.length === 0 ? (
          <div className="empty">
            <div className="empty-icon">
              <IconFilm size={22} />
            </div>
            <p>아직 추가된 영상이 없습니다</p>
            <span>유튜브 링크나 로컬 파일을 추가하세요</span>
          </div>
        ) : (
          <ul className="src-list">
            {videos.map((v) => {
              const st = STATUS[v.status];
              const ready = v.status === "ready";
              const checked = ready && v.selected;
              return (
                <li key={v.id} className={`src-item fade-up ${checked ? "checked" : ""} ${!ready ? "disabled" : ""}`}>
                  <button
                    id={`video-check-${v.id}`}
                    className={`checkbox ${checked ? "on" : ""}`}
                    disabled={!ready}
                    onClick={() => onToggle(v.id, !v.selected)}
                    aria-label={`${v.name} 검색 대상 선택`}
                  >
                    {checked && <IconCheck size={11} />}
                  </button>
                  <div className={`src-thumb ${v.source}`}>
                    {v.source === "youtube" ? <IconYoutube size={16} /> : <IconFilm size={16} />}
                  </div>
                  <div className="src-info">
                    <div className="src-name" title={v.name}>
                      {v.name}
                    </div>
                    <div className="src-meta">
                      <span className={`badge ${st.cls}`}>
                        {st.busy && <span className="spinner" style={{ width: 9, height: 9, borderWidth: 1.5 }} />}
                        {st.label}
                      </span>
                    </div>
                    {v.error && (
                      <div className="src-error" title={v.error}>
                        {v.error}
                      </div>
                    )}
                  </div>
                  <button
                    id={`video-delete-${v.id}`}
                    className="btn-icon src-del"
                    onClick={() => onDelete(v.id)}
                    title="영상 삭제 (서버·로컬 파일 모두 정리)"
                  >
                    <IconTrash size={15} />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
