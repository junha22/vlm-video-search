"use client";

import { useEffect, useRef, useState } from "react";
import { youtubeWatchUrl } from "@/lib/api";

// YouTube IFrame Player API 중 이 컴포넌트가 쓰는 부분만 정의
interface YTPlayer {
  loadVideoById(opts: { videoId: string; startSeconds?: number; endSeconds?: number }): void;
  getCurrentTime(): number;
  getDuration(): number;
  destroy(): void;
}
interface YTNamespace {
  Player: new (el: HTMLElement, opts: Record<string, unknown>) => YTPlayer;
}
declare global {
  interface Window {
    YT?: YTNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let apiPromise: Promise<YTNamespace> | null = null;

function loadYouTubeApi(): Promise<YTNamespace> {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (!apiPromise) {
    apiPromise = new Promise((resolve, reject) => {
      const prev = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => {
        prev?.();
        resolve(window.YT!);
      };
      const s = document.createElement("script");
      s.src = "https://www.youtube.com/iframe_api";
      s.onerror = () => {
        apiPromise = null;
        reject(new Error("YouTube IFrame API load failed"));
      };
      document.head.appendChild(s);
    });
  }
  return apiPromise;
}

/**
 * 유튜브 링크 모드(서버에 영상 파일 없음)용 미리보기 플레이어.
 * playKey 가 바뀔 때마다 start~end 구간을 처음부터 재생하고, 재생 위치·길이를 콜백으로 알려줌.
 */
export default function YouTubePlayer({
  videoId,
  start,
  end,
  playKey,
  onTime,
  onDuration,
}: {
  videoId: string;
  start: number;
  end: number;
  playKey: number;
  onTime: (t: number) => void;
  onDuration: (d: number) => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YTPlayer | null>(null);
  const ready = useRef(false);
  const pending = useRef(false);
  const latest = useRef({ videoId, start, end, onTime, onDuration });
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    latest.current = { videoId, start, end, onTime, onDuration };
  });

  const playLatest = () => {
    const { videoId: id, start: s, end: e } = latest.current;
    playerRef.current?.loadVideoById({ videoId: id, startSeconds: s, endSeconds: e });
  };

  // 플레이어 생성 (최초 1회)
  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;
    loadYouTubeApi()
      .then((YT) => {
        if (cancelled || !hostRef.current) return;
        const el = document.createElement("div");
        hostRef.current.appendChild(el);
        playerRef.current = new YT.Player(el, {
          width: "100%",
          height: "100%",
          videoId: latest.current.videoId,
          playerVars: { playsinline: 1, rel: 0 },
          events: {
            onReady: () => {
              ready.current = true;
              if (pending.current) {
                pending.current = false;
                playLatest();
              }
            },
            onStateChange: () => {
              const d = playerRef.current?.getDuration() ?? 0;
              if (d > 0) latest.current.onDuration(d);
            },
          },
        });
        timer = window.setInterval(() => {
          if (ready.current && playerRef.current) latest.current.onTime(playerRef.current.getCurrentTime());
        }, 250);
      })
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      playerRef.current?.destroy();
      playerRef.current = null;
      ready.current = false;
      if (hostRef.current) hostRef.current.innerHTML = "";
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 클립 선택 · 구간 재생 요청 시 IN~OUT 구간 재생 (준비 전이면 준비되는 즉시)
  useEffect(() => {
    if (ready.current) playLatest();
    else pending.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoId, playKey]);

  if (failed) {
    return (
      <div className="player-empty">
        <p>유튜브 플레이어를 불러오지 못했습니다.</p>
        <a className="btn btn-ghost btn-sm" href={youtubeWatchUrl(videoId, start)} target="_blank" rel="noopener noreferrer">
          YouTube에서 열기
        </a>
      </div>
    );
  }
  return <div ref={hostRef} className="yt-frame" />;
}
