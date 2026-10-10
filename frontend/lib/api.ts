export const API_BASE = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000").replace(/\/$/, "");

export type VideoStatus = "queued" | "downloading" | "uploading" | "processing" | "ready" | "error";

export interface Video {
  id: string;
  name: string;
  source: "local" | "youtube";
  status: VideoStatus;
  error: string | null;
  selected: boolean;
  created_at: number;
}

export interface ModelInfo {
  id: string;
  label: string;
  desc: string;
}

export interface Usage {
  total_tokens: number;
  prompt_tokens: number;
  output_tokens: number;
  requests: number;
  by_model: Record<string, { tokens: number; requests: number }>;
}

export interface Clip {
  id: string;
  rank: number;
  video_id: string | null;
  video_name: string;
  start_time: number;
  end_time: number;
  reason: string;
  confidence: string;
  matched_query?: string | null;
  feedback?: "good" | "bad" | null;
}

export interface SearchResult {
  expanded_queries: string[];
  clips: Clip[];
  usage: Usage;
}

export interface Health {
  ok: boolean;
  api_key: boolean;
  ffmpeg: boolean;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, init);
  } catch {
    throw new Error("백엔드 서버에 연결할 수 없습니다. (uvicorn 서버가 실행 중인지 확인하세요)");
  }
  if (!res.ok) {
    let detail = `${res.status} ${res.statusText}`;
    try {
      const body = await res.json();
      if (body?.detail) detail = typeof body.detail === "string" ? body.detail : JSON.stringify(body.detail);
    } catch {}
    throw new Error(detail);
  }
  return res.json() as Promise<T>;
}

const json = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

export const api = {
  health: () => request<Health>("/api/health"),
  models: () => request<ModelInfo[]>("/api/models"),
  usage: () => request<Usage>("/api/usage"),
  videos: () => request<Video[]>("/api/videos"),
  upload: (files: File[]) => {
    const fd = new FormData();
    files.forEach((f) => fd.append("files", f));
    return request<Video[]>("/api/videos/upload", { method: "POST", body: fd });
  },
  youtube: (url: string) => request<Video>("/api/videos/youtube", json({ url })),
  select: (id: string, selected: boolean) =>
    request<Video>(`/api/videos/${id}`, { ...json({ selected }), method: "PATCH" }),
  remove: (id: string) => request<{ ok: boolean }>(`/api/videos/${id}`, { method: "DELETE" }),
  search: (body: {
    intent: string;
    model: string;
    use_expansion: boolean;
    video_ids: string[];
    queries?: string[] | null;
    history: { intent: string; summary?: string }[];
    num_clips?: number;
  }) => request<SearchResult>("/api/search", json(body)),
  feedback: (body: {
    intent: string;
    video_name: string;
    start_time: number;
    end_time: number;
    label: "good" | "bad";
    model?: string;
  }) => request<{ ok: boolean }>("/api/feedback", json(body)),
  streamUrl: (id: string) => `${API_BASE}/api/videos/${id}/stream`,
  clipUrl: (id: string, start: number, end: number) =>
    `${API_BASE}/api/videos/${id}/clip?start=${start.toFixed(2)}&end=${end.toFixed(2)}`,
};

export function formatTime(sec: number): string {
  if (!isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  const ds = Math.floor((sec % 1) * 10);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${ds}`;
}

export function formatNumber(n: number): string {
  return new Intl.NumberFormat("ko-KR").format(n);
}
