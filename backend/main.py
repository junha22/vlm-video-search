"""
의도 기반 편집 구간 추천 시스템 - FastAPI 백엔드

기존 Streamlit app.py 의 핵심 로직을 그대로 이식했습니다.
  1. yt-dlp + ffmpeg 기반 고화질 유튜브 다운로드 / 로컬 파일 처리
  2. 503 에러 발생 시 3초 대기 후 재시도 (Retry 방어 로직)
  3. 구글 서버(client.files.delete) 및 로컬 임시 파일 완벽 삭제 (Cleanup)
  4. 최신 google-genai SDK 사용

실행:  uvicorn backend.main:app --reload --port 8000   (프로젝트 루트에서)
"""

import json
import os
import shutil
import subprocess
import tempfile
import threading
import time
import uuid
from contextlib import asynccontextmanager
from pathlib import Path
from typing import List, Optional

import yt_dlp
from dotenv import load_dotenv
from fastapi import BackgroundTasks, FastAPI, File, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from google import genai
from pydantic import BaseModel

# ----------------- 환경 설정 -----------------
ROOT_DIR = Path(__file__).resolve().parent.parent
load_dotenv(ROOT_DIR / ".env")
API_KEY = os.environ.get("GEMINI_API_KEY", "")

# 프로젝트 루트의 ffmpeg.exe 를 우선 사용, 없으면 PATH 에서 탐색
if (ROOT_DIR / "ffmpeg.exe").exists():
    FFMPEG_BIN = str(ROOT_DIR / "ffmpeg.exe")
    FFMPEG_DIR = str(ROOT_DIR)
else:
    FFMPEG_BIN = shutil.which("ffmpeg") or "ffmpeg"
    FFMPEG_DIR = None

TEMP_DIR = Path(tempfile.gettempdir()) / "intent_clip"
TEMP_DIR.mkdir(parents=True, exist_ok=True)
FEEDBACK_PATH = ROOT_DIR / "backend" / "feedback.jsonl"

MODELS = [
    {"id": "gemini-3.1-pro", "label": "Gemini 3.1 Pro", "desc": "최고 정확도 · 복잡한 의도 분석"},
    {"id": "gemini-3.8-flash", "label": "Gemini 3.8 Flash", "desc": "빠른 속도 · 균형 잡힌 성능"},
    {"id": "gemini-3.8-flash-agentic", "label": "Gemini 3.8 Flash (에이전틱)", "desc": "다단계 추론 · 에이전트형 탐색"},
    {"id": "gemini-3.1-flash-lite", "label": "Gemini 3.1 Flash-Lite", "desc": "초경량 · 최저 비용"},
]
MODEL_IDS = {m["id"] for m in MODELS}

# ----------------- 인메모리 상태 (단일 사용자 로컬 실행 기준) -----------------
STATE_LOCK = threading.Lock()
VIDEOS: dict = {}  # id -> {id, name, source, local_path, gemini_name, status, error, selected, created_at}
USAGE = {"total_tokens": 0, "prompt_tokens": 0, "output_tokens": 0, "requests": 0, "by_model": {}}

_client = None


def get_client():
    global _client
    if not API_KEY:
        raise HTTPException(status_code=500, detail="서버에 Gemini API Key가 설정되지 않았습니다. (.env 파일을 확인해주세요)")
    if _client is None:
        _client = genai.Client(api_key=API_KEY)
    return _client


# ----------------- 기존 핵심 로직 (유지) -----------------
def download_youtube_video(url, output_path):
    ydl_opts = {
        'format': 'bestvideo[ext=mp4][height<=1080]+bestaudio[ext=m4a]/best[ext=mp4][height<=1080]/best',
        'outtmpl': output_path,
        'quiet': True,
        'no_warnings': True,
        'merge_output_format': 'mp4',
        'extractor_args': {'youtube': {'player_client': ['android', 'web']}},
    }
    if FFMPEG_DIR:
        ydl_opts['ffmpeg_location'] = FFMPEG_DIR
    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        info = ydl.extract_info(url, download=True)
        return info.get("title") if info else None


def poll_video_processing(client, file_name):
    while True:
        video_file = client.files.get(name=file_name)
        state = str(video_file.state)
        if "ACTIVE" in state:
            return video_file
        elif "FAILED" in state:
            raise Exception("비디오 처리에 실패했습니다.")
        time.sleep(3)


def generate_with_retry(model, contents, config=None, max_retries=3):
    """503 에러 발생 시 3초 대기 후 재시도"""
    client = get_client()
    for attempt in range(max_retries):
        try:
            response = client.models.generate_content(model=model, contents=contents, config=config or {})
            record_usage(model, response)
            return response.text or ""
        except Exception as e:
            if "503" in str(e) and attempt < max_retries - 1:
                time.sleep(3)
                continue
            raise HTTPException(status_code=502, detail=f"AI 분석 중 오류 발생: {e}")
    return ""


def record_usage(model, response):
    meta = getattr(response, "usage_metadata", None)
    total = getattr(meta, "total_token_count", 0) or 0
    prompt = getattr(meta, "prompt_token_count", 0) or 0
    output = getattr(meta, "candidates_token_count", 0) or 0
    with STATE_LOCK:
        USAGE["total_tokens"] += total
        USAGE["prompt_tokens"] += prompt
        USAGE["output_tokens"] += output
        USAGE["requests"] += 1
        bm = USAGE["by_model"].setdefault(model, {"tokens": 0, "requests": 0})
        bm["tokens"] += total
        bm["requests"] += 1


def cleanup_video(vid):
    """구글 서버 파일 + 로컬 임시 파일 완벽 삭제"""
    if vid.get("gemini_name"):
        try:
            get_client().files.delete(name=vid["gemini_name"])
        except Exception:
            pass
    path = vid.get("local_path")
    if path and os.path.exists(path):
        try:
            os.remove(path)
        except Exception:
            pass


def parse_json(text):
    cleaned = text.replace("```json", "").replace("```", "").strip()
    start, end = cleaned.find("{"), cleaned.rfind("}")
    if start != -1 and end != -1:
        cleaned = cleaned[start:end + 1]
    return json.loads(cleaned)


def public_video(v):
    return {k: v[k] for k in ("id", "name", "source", "status", "error", "selected", "created_at")}


# ----------------- 백그라운드 작업 -----------------
def process_upload(vid_id):
    vid = VIDEOS.get(vid_id)
    if not vid:
        return
    try:
        client = get_client()
        _set(vid_id, status="uploading")
        gemini_file = client.files.upload(file=vid["local_path"], config={'display_name': vid["name"]})
        _set(vid_id, gemini_name=gemini_file.name, status="processing")
        poll_video_processing(client, gemini_file.name)
        _set(vid_id, status="ready")
    except Exception as e:
        _set(vid_id, status="error", error=str(e.detail if isinstance(e, HTTPException) else e))


def process_youtube(vid_id, url):
    try:
        _set(vid_id, status="downloading")
        title = download_youtube_video(url, VIDEOS[vid_id]["local_path"])
        if title:
            _set(vid_id, name=f"{title[:60]}")
        process_upload(vid_id)
    except Exception as e:
        _set(vid_id, status="error", error=str(e))


def _set(vid_id, **kwargs):
    with STATE_LOCK:
        if vid_id in VIDEOS:
            VIDEOS[vid_id].update(kwargs)


def _new_video(name, source, local_path):
    vid_id = uuid.uuid4().hex[:10]
    # 동일한 display_name 충돌 방지
    existing = {v["name"] for v in VIDEOS.values()}
    base, n = name, 2
    while name in existing:
        name = f"{base} ({n})"
        n += 1
    vid = {
        "id": vid_id, "name": name, "source": source,
        "local_path": local_path or str(TEMP_DIR / f"{source}_{vid_id}.mp4"),
        "gemini_name": None, "status": "queued", "error": None,
        "selected": True, "created_at": time.time(),
    }
    with STATE_LOCK:
        VIDEOS[vid_id] = vid
    return vid


# ----------------- FastAPI 앱 -----------------
@asynccontextmanager
async def lifespan(app: FastAPI):
    yield
    # 서버 종료 시 남아있는 모든 원격/로컬 파일 정리
    for vid in list(VIDEOS.values()):
        cleanup_video(vid)
    VIDEOS.clear()


app = FastAPI(title="Intent-based Clip Recommendation API", lifespan=lifespan)

allowed = os.environ.get("CORS_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000").split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in allowed if o.strip()],
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["Content-Disposition"],
)


class YoutubeReq(BaseModel):
    url: str


class SelectReq(BaseModel):
    selected: bool


class HistoryItem(BaseModel):
    intent: str
    summary: Optional[str] = None


class SearchReq(BaseModel):
    intent: str
    model: str = "gemini-3.1-pro"
    use_expansion: bool = True
    video_ids: List[str]
    queries: Optional[List[str]] = None  # 사용자가 수정한 확장 질의 (있으면 그대로 사용)
    history: List[HistoryItem] = []
    num_clips: int = 3


class FeedbackReq(BaseModel):
    intent: str
    video_name: str
    start_time: float
    end_time: float
    label: str  # "good" | "bad"
    model: Optional[str] = None


@app.get("/api/health")
def health():
    return {"ok": True, "api_key": bool(API_KEY), "ffmpeg": bool(shutil.which(FFMPEG_BIN) or os.path.exists(FFMPEG_BIN))}


@app.get("/api/models")
def list_models():
    return MODELS


@app.get("/api/usage")
def get_usage():
    return USAGE


@app.get("/api/videos")
def list_videos():
    return sorted([public_video(v) for v in VIDEOS.values()], key=lambda x: x["created_at"])


@app.post("/api/videos/upload")
async def upload_videos(background: BackgroundTasks, files: List[UploadFile] = File(...)):
    created = []
    for uf in files:
        ext = Path(uf.filename or "video.mp4").suffix or ".mp4"
        local_path = str(TEMP_DIR / f"local_{uuid.uuid4().hex}{ext}")
        with open(local_path, "wb") as f:
            while chunk := await uf.read(1024 * 1024):
                f.write(chunk)
        vid = _new_video(uf.filename or "video.mp4", "local", local_path)
        background.add_task(process_upload, vid["id"])
        created.append(public_video(vid))
    return created


@app.post("/api/videos/youtube")
def add_youtube(req: YoutubeReq, background: BackgroundTasks):
    if not req.url.strip():
        raise HTTPException(400, "유튜브 링크를 입력해주세요.")
    vid = _new_video(f"Youtube_{uuid.uuid4().hex[:6]}", "youtube", None)
    background.add_task(process_youtube, vid["id"], req.url.strip())
    return public_video(vid)


@app.patch("/api/videos/{vid_id}")
def select_video(vid_id: str, req: SelectReq):
    if vid_id not in VIDEOS:
        raise HTTPException(404, "영상을 찾을 수 없습니다.")
    _set(vid_id, selected=req.selected)
    return public_video(VIDEOS[vid_id])


@app.delete("/api/videos/{vid_id}")
def delete_video(vid_id: str):
    with STATE_LOCK:
        vid = VIDEOS.pop(vid_id, None)
    if not vid:
        raise HTTPException(404, "영상을 찾을 수 없습니다.")
    cleanup_video(vid)
    return {"ok": True}


@app.get("/api/videos/{vid_id}/stream")
def stream_video(vid_id: str, request: Request):
    """HTTP Range 를 지원하는 비디오 스트리밍 (브라우저 탐색/구간 재생용)"""
    vid = VIDEOS.get(vid_id)
    if not vid or not os.path.exists(vid["local_path"]):
        raise HTTPException(404, "영상 파일이 없습니다.")
    path = vid["local_path"]
    size = os.path.getsize(path)
    range_header = request.headers.get("range")
    media_type = "video/mp4" if path.lower().endswith(".mp4") else "video/quicktime" if path.lower().endswith(".mov") else "video/x-msvideo"

    if not range_header:
        return FileResponse(path, media_type=media_type, headers={"Accept-Ranges": "bytes"})

    units, _, rng = range_header.partition("=")
    start_s, _, end_s = rng.partition("-")
    start = int(start_s) if start_s else 0
    end = int(end_s) if end_s else min(start + 2 * 1024 * 1024, size - 1)
    end = min(end, size - 1)
    length = end - start + 1

    def iterator():
        with open(path, "rb") as f:
            f.seek(start)
            remaining = length
            while remaining > 0:
                data = f.read(min(256 * 1024, remaining))
                if not data:
                    break
                remaining -= len(data)
                yield data

    headers = {
        "Content-Range": f"bytes {start}-{end}/{size}",
        "Accept-Ranges": "bytes",
        "Content-Length": str(length),
    }
    return StreamingResponse(iterator(), status_code=206, media_type=media_type, headers=headers)


@app.get("/api/videos/{vid_id}/clip")
def download_clip(vid_id: str, start: float, end: float, background: BackgroundTasks):
    """ffmpeg 로 IN/OUT 구간을 잘라 다운로드"""
    vid = VIDEOS.get(vid_id)
    if not vid or not os.path.exists(vid["local_path"]):
        raise HTTPException(404, "영상 파일이 없습니다.")
    if end <= start:
        raise HTTPException(400, "OUT 시점은 IN 시점보다 뒤여야 합니다.")
    out_path = str(TEMP_DIR / f"clip_{uuid.uuid4().hex}.mp4")
    cmd = [FFMPEG_BIN, "-y", "-ss", f"{start:.2f}", "-i", vid["local_path"], "-t", f"{end - start:.2f}",
           "-c:v", "libx264", "-preset", "veryfast", "-c:a", "aac", "-movflags", "+faststart", out_path]
    try:
        subprocess.run(cmd, check=True, capture_output=True)
    except Exception as e:
        raise HTTPException(500, f"클립 생성 실패 (ffmpeg 확인 필요): {e}")
    background.add_task(lambda p: os.path.exists(p) and os.remove(p), out_path)
    safe = "".join(c for c in Path(vid["name"]).stem if c.isalnum() or c in "-_")[:40] or "clip"
    filename = f"{safe}_{int(start)}-{int(end)}.mp4"
    return FileResponse(out_path, media_type="video/mp4", filename=filename)


@app.post("/api/feedback")
def save_feedback(req: FeedbackReq):
    with open(FEEDBACK_PATH, "a", encoding="utf-8") as f:
        f.write(json.dumps({**req.model_dump(), "ts": time.time()}, ensure_ascii=False) + "\n")
    return {"ok": True}


# ----------------- 3단계 파이프라인: 질의 확장 → 컷 탐색 → 편집 추천 -----------------
def expand_queries(intent, model, history):
    ctx = "\n".join(f"- {h.intent}" for h in history[-5:])
    ctx_block = f"[이전 대화 맥락]\n{ctx}\n" if ctx else ""
    prompt = f"""너는 영상 편집 기획자야. 사용자의 제작 의도(Editing Brief)를 영상에서 실제로 찾을 수 있는
구체적인 시각적/청각적 장면 묘사 3개로 확장해.
{ctx_block}
[제작 의도] {intent}

반드시 아래 JSON 형식으로만 출력해.
{{"expanded_queries": ["장면 묘사1", "장면 묘사2", "장면 묘사3"]}}"""
    text = generate_with_retry(model, [prompt], {'temperature': 0.4})
    try:
        return parse_json(text).get("expanded_queries", [])[:5]
    except Exception:
        return []


@app.post("/api/search")
def search(req: SearchReq):
    if req.model not in MODEL_IDS:
        raise HTTPException(400, "지원하지 않는 모델입니다.")
    targets = [VIDEOS[i] for i in req.video_ids if i in VIDEOS and VIDEOS[i]["status"] == "ready"]
    if not targets:
        raise HTTPException(400, "검색 가능한(처리 완료된) 영상이 없습니다. 왼쪽 패널에서 영상을 추가하고 선택해주세요.")

    client = get_client()

    # 1단계: 질의 확장
    queries = [q for q in (req.queries or []) if q.strip()]
    if req.use_expansion and not queries:
        queries = expand_queries(req.intent, req.model, req.history)

    if queries:
        expansion_block = "1. 질의 확장 결과(아래 장면들을 우선 탐색):\n" + "\n".join(f"   - {q}" for q in queries)
    else:
        expansion_block = "1. 질의 확장: 사용 안함. 입력된 의도 그대로만 탐색하라."

    ctx = "\n".join(f"- 의도: {h.intent}" + (f" / 결과: {h.summary}" if h.summary else "") for h in req.history[-5:])
    video_list = "\n".join(f"- {v['name']}" for v in targets)
    ctx_block = f"[이전 대화 맥락 - 후속 질문이면 이를 반영해]\n{ctx}\n" if ctx else ""

    prompt = f"""너는 최고 수준의 영상 편집자이자 AI 분석가야.
사용자의 [제작 의도: {req.intent}]를 바탕으로, 첨부된 영상들에서 가장 완벽하게 부합하는 클립을 추천해야 해.
각 영상의 이름은 파일의 display_name 속성(메타데이터)으로 구분하며, 첨부 순서대로 다음과 같아:
{video_list}
{ctx_block}
다음 순서대로 생각하고 분석해:
{expansion_block}
2. 컷 탐색: 확장된 장면들이 각 영상의 몇 분 몇 초(타임스탬프)에 등장하는지 면밀히 스캔해.
3. 최종 편집 추천: 탐색된 컷들 중 '제작 의도'에 가장 완벽하게 맞는 IN/OUT 타임스탬프 {req.num_clips}개를 엄선해.
   각 클립이 왜 추천되었는지 '추천 이유(2~3줄)'와 '신뢰도(높음/중간/낮음)', 어떤 확장 질의와 매칭되었는지를 평가해.

출력은 반드시 아래의 JSON 형식으로만 작성해. 마크다운 기호나 다른 설명은 절대 추가하지 마.
{{
  "clips": [
    {{
      "video_name": "영상의 display_name (위 목록 중 하나와 정확히 일치)",
      "start_time": 시작초(정수),
      "end_time": 종료초(정수),
      "reason": "추천 이유",
      "confidence": "높음",
      "matched_query": "매칭된 확장 질의"
    }}
  ]
}}"""

    contents = []
    for v in targets:
        contents.append(client.files.get(name=v["gemini_name"]))
    contents.append(prompt)

    # 2~3단계: 컷 탐색 + 최종 추천
    text = generate_with_retry(req.model, contents, {'temperature': 0.2})
    try:
        data = parse_json(text)
    except Exception:
        raise HTTPException(502, f"AI 응답을 JSON으로 분석하는 데 실패했습니다.\n{text[:500]}")

    name_map = {v["name"]: v["id"] for v in targets}
    clips = []
    for i, c in enumerate(data.get("clips", [])):
        vname = c.get("video_name", "")
        vid_id = name_map.get(vname) or next((vid for n, vid in name_map.items() if vname in n or n in vname), None)
        if not vid_id and len(targets) == 1:
            vid_id = targets[0]["id"]
        clips.append({
            "id": uuid.uuid4().hex[:8],
            "rank": i + 1,
            "video_id": vid_id,
            "video_name": vname,
            "start_time": float(c.get("start_time", 0) or 0),
            "end_time": float(c.get("end_time", 0) or 0),
            "reason": c.get("reason", ""),
            "confidence": c.get("confidence", "중간"),
            "matched_query": c.get("matched_query"),
        })

    return {"expanded_queries": queries, "clips": clips, "usage": USAGE}
