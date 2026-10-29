"""
의도 기반 편집 구간 추천 시스템 - FastAPI 백엔드

기존 Streamlit app.py 의 핵심 로직을 그대로 이식했습니다.
  1. yt-dlp + ffmpeg 기반 고화질 유튜브 다운로드 / 로컬 파일 처리
  2. 503 에러 발생 시 3초 대기 후 재시도 (Retry 방어 로직)
  3. 구글 서버(client.files.delete) 및 로컬 임시 파일 완벽 삭제 (Cleanup)
  4. 최신 google-genai SDK 사용

실행:  uvicorn backend.main:app --reload --port 8000   (프로젝트 루트에서)

배포용 환경 변수 (모두 선택 · 기본값은 로컬 실행 기준):
  YOUTUBE_MODE      download(기본) | url  - url 이면 영상을 내려받지 않고 유튜브 링크를 Gemini 에 바로 전달
  MAX_UPLOAD_MB     업로드 1회 최대 용량(MB), 0 이면 제한 없음
  MAX_CLIP_SECONDS  클립 다운로드 최대 길이(초), 0 이면 제한 없음
  FFMPEG_THREADS    클립 인코딩 스레드 수 (저사양 서버는 1 권장), 비우면 ffmpeg 기본값
  DATA_DIR          usage.json / feedback.jsonl 저장 위치 (기본: backend/)
  STATIC_DIR        정적 빌드한 프론트엔드 폴더 (기본: frontend/out, 있으면 같은 주소에서 UI 도 제공)
  APP_USERNAME      로그인 아이디 (APP_PASSWORD 와 함께 설정)
  APP_PASSWORD      로그인 비밀번호. 설정하면 로그인 화면이 켜지고, 비우면 로그인 없이 사용 (로컬 실행 기본값)
"""

import hashlib
import hmac
import json
import math
import os
import re
import shutil
import subprocess
import tempfile
import threading
import time
import uuid
from contextlib import asynccontextmanager
from pathlib import Path
from typing import List, Optional
from urllib.error import HTTPError
from urllib.parse import parse_qs, urlencode, urlparse
from urllib.request import urlopen

import yt_dlp
from dotenv import load_dotenv
from fastapi import BackgroundTasks, FastAPI, File, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from google import genai
from google.genai import types
from pydantic import BaseModel

# ----------------- 환경 설정 -----------------
ROOT_DIR = Path(__file__).resolve().parent.parent
load_dotenv(ROOT_DIR / ".env")
API_KEY = os.environ.get("GEMINI_API_KEY", "")

YOUTUBE_MODE = "url" if os.environ.get("YOUTUBE_MODE", "").strip().lower() == "url" else "download"
MAX_UPLOAD_MB = int(os.environ.get("MAX_UPLOAD_MB") or 0)
MAX_CLIP_SECONDS = float(os.environ.get("MAX_CLIP_SECONDS") or 0)
FFMPEG_THREADS = (os.environ.get("FFMPEG_THREADS") or "").strip()
if not FFMPEG_THREADS.isdigit():
    FFMPEG_THREADS = ""
DATA_DIR = Path(os.environ.get("DATA_DIR") or ROOT_DIR / "backend")
STATIC_DIR = Path(os.environ.get("STATIC_DIR") or ROOT_DIR / "frontend" / "out")

# 로그인: 쿠키 세션 (서명 키는 계정 정보에서 만들어서, 비밀번호를 바꾸면 기존 로그인이 모두 풀림)
APP_USERNAME = (os.environ.get("APP_USERNAME") or "").strip()
APP_PASSWORD = os.environ.get("APP_PASSWORD") or ""
AUTH_ENABLED = bool(APP_PASSWORD)
SESSION_COOKIE = "intentcut_session"
SESSION_DAYS = 30
SESSION_KEY = hashlib.sha256(f"intentcut|{APP_USERNAME}|{APP_PASSWORD}|{API_KEY}".encode()).digest()
LOGIN_WINDOW = 600      # 10분 동안
LOGIN_MAX_FAILS = 10    # IP 당 실패 10번까지 허용
LOGIN_FAILS: dict = {}  # ip -> [실패 시각]

ALLOWED_VIDEO_EXTS = {".mp4", ".mov", ".avi", ".webm", ".mkv", ".m4v"}
MAX_VIDEOS_PER_SEARCH = 10      # Gemini 가 한 요청에서 받는 유튜브 링크 최대 개수
GEMINI_FILE_TTL = 47 * 3600     # Gemini Files API 는 업로드 48시간 뒤 파일을 자동 삭제
CLIP_LOCK = threading.Semaphore(1)  # 저사양 서버에서 ffmpeg 동시 실행으로 메모리가 터지지 않도록

# 프로젝트 루트의 ffmpeg.exe 를 우선 사용, 없으면 PATH 에서 탐색
if (ROOT_DIR / "ffmpeg.exe").exists():
    FFMPEG_BIN = str(ROOT_DIR / "ffmpeg.exe")
    FFMPEG_DIR = str(ROOT_DIR)
else:
    FFMPEG_BIN = shutil.which("ffmpeg") or "ffmpeg"
    FFMPEG_DIR = None

TEMP_DIR = Path(tempfile.gettempdir()) / "intent_clip"
TEMP_DIR.mkdir(parents=True, exist_ok=True)
DATA_DIR.mkdir(parents=True, exist_ok=True)
FEEDBACK_PATH = DATA_DIR / "feedback.jsonl"
USAGE_PATH = DATA_DIR / "usage.json"


def load_usage() -> dict:
    default_usage = {
        "total_tokens": 0,
        "prompt_tokens": 0,
        "output_tokens": 0,
        "requests": 0,
        "by_model": {},
    }
    if USAGE_PATH.exists():
        try:
            with open(USAGE_PATH, "r", encoding="utf-8") as f:
                data = json.load(f)
                return {
                    "total_tokens": int(data.get("total_tokens", 0)),
                    "prompt_tokens": int(data.get("prompt_tokens", 0)),
                    "output_tokens": int(data.get("output_tokens", 0)),
                    "requests": int(data.get("requests", 0)),
                    "by_model": data.get("by_model", {}) if isinstance(data.get("by_model"), dict) else {},
                }
        except Exception:
            pass
    return default_usage


def save_usage():
    try:
        USAGE_PATH.parent.mkdir(parents=True, exist_ok=True)
        temp_file = USAGE_PATH.with_suffix(".tmp")
        with open(temp_file, "w", encoding="utf-8") as f:
            json.dump(USAGE, f, ensure_ascii=False, indent=2)
        temp_file.replace(USAGE_PATH)
    except Exception as e:
        print(f"[USAGE SAVE ERROR] {e}")


MODELS = [
    {"id": "gemini-3.1-pro", "label": "Gemini 3.1 Pro", "desc": "최고 정확도 · 복잡한 의도 분석 · 유료 키 전용"},
    {"id": "gemini-3.8-flash", "label": "Gemini 3.8 Flash", "desc": "빠른 속도 · 균형 잡힌 성능"},
    {"id": "gemini-3.8-flash-agentic", "label": "Gemini 3.8 Flash (에이전틱)", "desc": "다단계 추론 · 에이전트형 탐색"},
    {"id": "gemini-3.1-flash-lite", "label": "Gemini 3.1 Flash-Lite", "desc": "초경량 · 최저 비용 · 무료 키 기본값"},
]
MODEL_IDS = {m["id"] for m in MODELS}
MODEL_ALIASES = {
    "gemini-3.1-pro": "gemini-3.1-pro-preview",
    "gemini-3.8-flash-agentic": "gemini-3.8-flash",
}
# gemini-3.1-pro-preview 는 무료 등급이 없어 무료 키로는 모든 요청이 429(limit: 0)로 실패
DEFAULT_MODEL = "gemini-3.1-flash-lite"

# ----------------- 상태 관리 (단일 사용자 로컬 실행 기준) -----------------
STATE_LOCK = threading.Lock()
VIDEOS: dict = {}  # id -> {id, name, source, local_path, youtube_id, gemini_name, uploaded_at, status, error, selected, created_at}
USAGE = load_usage()
if not USAGE_PATH.exists():
    save_usage()

_client = None


def get_client():
    global _client
    if not API_KEY:
        raise HTTPException(status_code=500, detail="서버에 Gemini API Key가 설정되지 않았습니다. (.env 파일을 확인해주세요)")
    if _client is None:
        _client = genai.Client(api_key=API_KEY)
    return _client


# ----------------- 유튜브 링크 처리 -----------------
YOUTUBE_HOSTS = {"youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com"}
YOUTUBE_ID_RE = re.compile(r"^[A-Za-z0-9_-]{11}$")


def parse_youtube_id(url):
    """유튜브 주소에서 11자리 영상 ID 만 추출 (다른 사이트·내부망 주소는 거부)"""
    text = url.strip()
    if "://" not in text:
        text = "https://" + text
    try:
        u = urlparse(text)
        host = (u.hostname or "").lower()
    except ValueError:
        return None
    if u.scheme not in ("http", "https"):
        return None
    vid = ""
    if host == "youtu.be":
        vid = u.path.strip("/").split("/")[0]
    elif host in YOUTUBE_HOSTS:
        parts = u.path.strip("/").split("/")
        if parts[0] == "watch":
            vid = parse_qs(u.query).get("v", [""])[0]
        elif len(parts) >= 2 and parts[0] in ("shorts", "embed", "live", "v"):
            vid = parts[1]
    return vid if YOUTUBE_ID_RE.match(vid) else None


def youtube_watch_url(video_id):
    return f"https://www.youtube.com/watch?v={video_id}"


def fetch_youtube_title(video_id):
    """oEmbed 로 제목 조회 (API 키 불필요). 비공개·삭제된 영상이면 HTTPError 발생"""
    query = urlencode({"url": youtube_watch_url(video_id), "format": "json"})
    with urlopen(f"https://www.youtube.com/oembed?{query}", timeout=8) as res:
        return json.load(res).get("title")


# ----------------- 기존 핵심 로직 (유지) -----------------
def download_youtube_video(url, output_path):
    ydl_opts = {
        # H.264(avc1) 우선: AV1 은 클립 재인코딩이 무겁고 일부 브라우저에서 재생되지 않음
        'format': 'bestvideo[vcodec^=avc1][height<=1080]+bestaudio[ext=m4a]/best[ext=mp4][height<=1080]/best',
        'outtmpl': output_path,
        'quiet': True,
        'no_warnings': True,
        'noplaylist': True,
        'merge_output_format': 'mp4',
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


def gemini_error(err):
    """Gemini 오류를 (상태 코드, 사용자용 메시지)로 변환 - 원본 쿼터 JSON 이 화면에 그대로 뜨지 않도록"""
    msg = str(err)
    if "limit: 0" in msg:
        return 429, "선택한 모델은 무료 API 키로 사용할 수 없습니다. 상단에서 Flash-Lite 등 다른 모델을 선택해주세요."
    if "429" in msg or "RESOURCE_EXHAUSTED" in msg:
        return 429, "Gemini API 사용 한도를 초과했습니다. 잠시 후 다시 시도하거나 다른 모델을 선택해주세요."
    if "API_KEY_INVALID" in msg or "API key not valid" in msg:
        return 500, "서버의 Gemini API Key가 올바르지 않습니다."
    return 502, f"AI 분석 중 오류 발생: {msg[:300]}"


def generate_with_retry(model, contents, config=None, max_retries=3):
    """503 은 3초 뒤, 분당 한도 초과(429)는 안내된 대기 시간(30초 이하) 뒤 재시도 (실제 API 모델명으로 매핑)"""
    client = get_client()
    actual_model = MODEL_ALIASES.get(model, model)
    for attempt in range(max_retries):
        try:
            response = client.models.generate_content(model=actual_model, contents=contents, config=config or {})
            record_usage(model, response)
            return response.text or ""
        except Exception as e:
            msg = str(e)
            if attempt < max_retries - 1:
                if "503" in msg:
                    time.sleep(3)
                    continue
                delay = re.search(r"retryDelay['\"]?\s*:\s*['\"]?(\d+)", msg)
                if "429" in msg and "PerMinute" in msg and "limit: 0" not in msg and delay and int(delay.group(1)) <= 30:
                    time.sleep(int(delay.group(1)) + 1)
                    continue
            status, detail = gemini_error(e)
            raise HTTPException(status_code=status, detail=detail)
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
        save_usage()


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


def expire_stale_videos():
    """Gemini 가 48시간 뒤 지우는 업로드 파일을 미리 만료 처리 (오래 켜둔 서버에서 검색이 실패하지 않도록)"""
    now = time.time()
    expired = []
    with STATE_LOCK:
        for v in VIDEOS.values():
            if v["gemini_name"] and v["uploaded_at"] and now - v["uploaded_at"] > GEMINI_FILE_TTL:
                expired.append(dict(v))
                v.update(gemini_name=None, local_path=None, status="error", selected=False,
                         error="업로드 후 48시간이 지나 Gemini 파일이 만료되었습니다. 삭제 후 다시 추가해주세요.")
    for v in expired:
        cleanup_video(v)


def make_session():
    exp = str(int(time.time()) + SESSION_DAYS * 86400)
    return f"{exp}.{hmac.new(SESSION_KEY, exp.encode(), hashlib.sha256).hexdigest()}"


def valid_session(token):
    exp, _, sig = (token or "").partition(".")
    if not exp.isdigit() or int(exp) < time.time():
        return False
    return hmac.compare_digest(sig, hmac.new(SESSION_KEY, exp.encode(), hashlib.sha256).hexdigest())


def parse_json(text):
    cleaned = text.replace("```json", "").replace("```", "").strip()
    start, end = cleaned.find("{"), cleaned.rfind("}")
    if start != -1 and end != -1:
        cleaned = cleaned[start:end + 1]
    return json.loads(cleaned)


def public_video(v):
    data = {k: v[k] for k in ("id", "name", "source", "status", "error", "selected", "created_at", "youtube_id")}
    data["has_file"] = bool(v["local_path"])  # False 면 미리보기는 유튜브 플레이어, 클립 다운로드 불가
    return data


# ----------------- 백그라운드 작업 -----------------
def process_upload(vid_id):
    vid = VIDEOS.get(vid_id)
    if not vid:
        return
    try:
        client = get_client()
        _set(vid_id, status="uploading")
        gemini_file = client.files.upload(file=vid["local_path"], config={'display_name': vid["name"]})
        _set(vid_id, gemini_name=gemini_file.name, uploaded_at=time.time(), status="processing")
        poll_video_processing(client, gemini_file.name)
        _set(vid_id, status="ready")
    except Exception as e:
        _set(vid_id, status="error", error=str(e.detail if isinstance(e, HTTPException) else e))


def process_youtube(vid_id, url):
    try:
        _set(vid_id, status="downloading")
        title = download_youtube_video(url, VIDEOS[vid_id]["local_path"])
        if title:
            _set(vid_id, name=_unique_name(title[:60], exclude=vid_id))
        process_upload(vid_id)
    except Exception as e:
        _set(vid_id, status="error", error=str(e))


def process_youtube_url(vid_id, video_id):
    """URL 모드: 내려받지 않고 제목만 확인한 뒤 바로 분석 가능 상태로 전환 (Gemini 가 유튜브에서 직접 읽음)"""
    try:
        _set(vid_id, status="processing")
        title = fetch_youtube_title(video_id)
        if title:
            _set(vid_id, name=_unique_name(title[:60], exclude=vid_id))
        _set(vid_id, status="ready")
    except HTTPError as e:
        if e.code in (401, 403):
            _set(vid_id, status="error", error="비공개이거나 외부 재생이 막힌 영상입니다. 공개 영상만 분석할 수 있습니다.")
        elif e.code in (400, 404):  # 없는 영상 ID 는 400, 삭제된 영상은 404
            _set(vid_id, status="error", error="영상을 찾을 수 없습니다. 주소를 확인해주세요.")
        else:
            _set(vid_id, status="ready")  # 제목 조회만 실패 (일시적 오류) → 기본 이름으로 진행
    except Exception:
        _set(vid_id, status="ready")


def _set(vid_id, **kwargs):
    with STATE_LOCK:
        if vid_id in VIDEOS:
            VIDEOS[vid_id].update(kwargs)


def _unique_name(name, exclude=None):
    """동일한 이름 충돌 방지 (AI 응답의 영상 이름으로 원본을 찾기 때문)"""
    existing = {v["name"] for v in VIDEOS.values() if v["id"] != exclude}
    base, n = name, 2
    while name in existing:
        name = f"{base} ({n})"
        n += 1
    return name


def _new_video(name, source, local_path=None, youtube_id=None, with_file=True):
    vid_id = uuid.uuid4().hex[:10]
    if with_file and not local_path:
        local_path = str(TEMP_DIR / f"{source}_{vid_id}.mp4")
    vid = {
        "id": vid_id, "name": _unique_name(name), "source": source,
        "local_path": local_path, "youtube_id": youtube_id,
        "gemini_name": None, "uploaded_at": None, "status": "queued", "error": None,
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


@app.middleware("http")
async def limit_upload_size(request: Request, call_next):
    """업로드 용량 제한: 본문을 디스크에 받기 전에 Content-Length 로 먼저 거절"""
    if MAX_UPLOAD_MB and request.url.path == "/api/videos/upload":
        length = request.headers.get("content-length", "")
        if length.isdigit() and int(length) > MAX_UPLOAD_MB * 1024 * 1024:
            return JSONResponse(status_code=413, content={"detail": f"업로드 용량 제한({MAX_UPLOAD_MB}MB)을 초과했습니다."})
    return await call_next(request)


PUBLIC_PATHS = {"/login", "/api/login", "/api/logout", "/api/health", "/favicon.ico"}


@app.middleware("http")
async def require_login(request: Request, call_next):
    """APP_PASSWORD 가 설정된 경우에만 동작: 로그인 쿠키가 없으면 API 는 401, 화면은 /login 으로 이동"""
    path = request.url.path
    if (not AUTH_ENABLED or request.method == "OPTIONS" or path in PUBLIC_PATHS
            or path.startswith("/_next/") or valid_session(request.cookies.get(SESSION_COOKIE))):
        return await call_next(request)
    if path.startswith("/api/"):
        return JSONResponse(status_code=401, content={"detail": "로그인이 필요합니다."})
    return RedirectResponse("/login", status_code=303)


# CORS 는 위 미들웨어들보다 나중에 추가해야 바깥에서 감싸서 413·401 응답에도 CORS 헤더가 붙음
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


class HistoryClip(BaseModel):
    video_name: str
    start_time: float
    end_time: float
    feedback: Optional[str] = None  # "good" | "bad" | None


class HistoryItem(BaseModel):
    intent: str
    summary: Optional[str] = None
    clips: List[HistoryClip] = []  # 이전에 추천한 구간과 사용자의 👍/👎


class SearchReq(BaseModel):
    intent: str
    model: str = DEFAULT_MODEL
    use_expansion: bool = True
    video_ids: List[str]
    queries: Optional[List[str]] = None  # 사용자가 수정한 확장 질의 (있으면 그대로 사용)
    history: List[HistoryItem] = []
    num_clips: int = 3
    more: bool = False  # "다른 후보 보기": 이전 추천 구간을 제외하고 새 후보만


class LoginReq(BaseModel):
    username: str = ""
    password: str = ""


class FeedbackReq(BaseModel):
    intent: str
    video_name: str
    start_time: float
    end_time: float
    label: str  # "good" | "bad"
    model: Optional[str] = None


@app.get("/api/health")
def health():
    return {
        "ok": True,
        "api_key": bool(API_KEY),
        "ffmpeg": bool(shutil.which(FFMPEG_BIN) or os.path.exists(FFMPEG_BIN)),
        "youtube_mode": YOUTUBE_MODE,
        "max_upload_mb": MAX_UPLOAD_MB,
        "auth": AUTH_ENABLED,
    }


@app.get("/login", include_in_schema=False)
def login_page(request: Request):
    if not AUTH_ENABLED or valid_session(request.cookies.get(SESSION_COOKIE)):
        return RedirectResponse("/", status_code=303)
    page = STATIC_DIR / "login.html"
    if not page.is_file():
        raise HTTPException(404, "로그인 화면(frontend/out/login.html)이 없습니다. npm run build:static 후 다시 올려주세요.")
    return FileResponse(page)


@app.post("/api/login")
def login(req: LoginReq, request: Request):
    if not AUTH_ENABLED:
        return {"ok": True}
    ip = request.client.host if request.client else "?"
    now = time.time()
    fails = [t for t in LOGIN_FAILS.get(ip, []) if now - t < LOGIN_WINDOW]
    if len(fails) >= LOGIN_MAX_FAILS:
        raise HTTPException(429, "로그인 시도가 너무 많습니다. 10분 뒤에 다시 시도해주세요.")
    user_ok = hmac.compare_digest(req.username.strip().encode(), APP_USERNAME.encode()) if APP_USERNAME else True
    pass_ok = hmac.compare_digest(req.password.encode(), APP_PASSWORD.encode())
    if not (user_ok and pass_ok):
        if len(LOGIN_FAILS) > 10000:
            LOGIN_FAILS.clear()
        LOGIN_FAILS[ip] = fails + [now]
        raise HTTPException(401, "아이디 또는 비밀번호가 올바르지 않습니다.")
    LOGIN_FAILS.pop(ip, None)
    res = JSONResponse({"ok": True})
    res.set_cookie(SESSION_COOKIE, make_session(), max_age=SESSION_DAYS * 86400, httponly=True,
                   samesite="lax", secure=request.url.scheme == "https", path="/")
    return res


@app.post("/api/logout")
def logout():
    res = JSONResponse({"ok": True})
    res.delete_cookie(SESSION_COOKIE, path="/")
    return res


@app.get("/api/models")
def list_models():
    return MODELS


@app.get("/api/usage")
def get_usage():
    return USAGE


@app.post("/api/usage/reset")
def reset_usage():
    with STATE_LOCK:
        USAGE["total_tokens"] = 0
        USAGE["prompt_tokens"] = 0
        USAGE["output_tokens"] = 0
        USAGE["requests"] = 0
        USAGE["by_model"] = {}
        save_usage()
    return USAGE


@app.get("/api/videos")
def list_videos():
    expire_stale_videos()
    return sorted([public_video(v) for v in VIDEOS.values()], key=lambda x: x["created_at"])


@app.post("/api/videos/upload")
async def upload_videos(background: BackgroundTasks, files: List[UploadFile] = File(...)):
    # 형식·용량을 먼저 모두 검사 (일부만 등록된 채로 실패하지 않도록)
    for uf in files:
        ext = Path(uf.filename or "video.mp4").suffix.lower() or ".mp4"
        if ext not in ALLOWED_VIDEO_EXTS:
            raise HTTPException(400, f"지원하지 않는 파일 형식입니다: {ext} (MP4 · MOV · AVI 등 영상 파일만 가능)")
    if MAX_UPLOAD_MB and sum(uf.size or 0 for uf in files) > MAX_UPLOAD_MB * 1024 * 1024:
        raise HTTPException(413, f"업로드 용량 제한({MAX_UPLOAD_MB}MB)을 초과했습니다.")

    created = []
    for uf in files:
        ext = Path(uf.filename or "video.mp4").suffix.lower() or ".mp4"
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
    video_id = parse_youtube_id(req.url)
    if not video_id:
        raise HTTPException(400, "유튜브 영상 주소만 추가할 수 있습니다. (예: https://www.youtube.com/watch?v=...)")
    if YOUTUBE_MODE == "url":
        vid = _new_video(f"YouTube {video_id}", "youtube", youtube_id=video_id, with_file=False)
        background.add_task(process_youtube_url, vid["id"], video_id)
    else:
        vid = _new_video(f"Youtube_{uuid.uuid4().hex[:6]}", "youtube", youtube_id=video_id)
        background.add_task(process_youtube, vid["id"], youtube_watch_url(video_id))
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
def stream_video(vid_id: str):
    """브라우저 탐색/구간 재생용 스트리밍 (HTTP Range 요청은 FileResponse 가 처리)"""
    vid = VIDEOS.get(vid_id)
    if not vid or not vid["local_path"] or not os.path.exists(vid["local_path"]):
        raise HTTPException(404, "영상 파일이 없습니다.")
    return FileResponse(vid["local_path"])


@app.get("/api/videos/{vid_id}/clip")
def download_clip(vid_id: str, start: float, end: float, background: BackgroundTasks):
    """ffmpeg 로 IN/OUT 구간을 잘라 다운로드"""
    vid = VIDEOS.get(vid_id)
    if not vid or not vid["local_path"] or not os.path.exists(vid["local_path"]):
        raise HTTPException(404, "영상 파일이 없습니다.")
    if not (math.isfinite(start) and math.isfinite(end)) or start < 0 or end <= start:
        raise HTTPException(400, "OUT 시점은 IN 시점보다 뒤여야 합니다.")
    if MAX_CLIP_SECONDS and end - start > MAX_CLIP_SECONDS:
        raise HTTPException(400, f"클립은 최대 {MAX_CLIP_SECONDS:g}초까지 다운로드할 수 있습니다.")
    out_path = str(TEMP_DIR / f"clip_{uuid.uuid4().hex}.mp4")
    cmd = [FFMPEG_BIN, "-y", "-ss", f"{start:.2f}", "-i", vid["local_path"], "-t", f"{end - start:.2f}",
           "-c:v", "libx264", "-preset", "veryfast", "-c:a", "aac", "-movflags", "+faststart"]
    if FFMPEG_THREADS:
        cmd += ["-threads", FFMPEG_THREADS]
    cmd.append(out_path)
    try:
        with CLIP_LOCK:
            subprocess.run(cmd, check=True, capture_output=True, timeout=300)
    except Exception as e:
        print(f"[CLIP ERROR] {e}")
        if os.path.exists(out_path):
            os.remove(out_path)
        raise HTTPException(500, "클립 생성에 실패했습니다. (ffmpeg 설치 여부를 확인해주세요)")
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
    is_agentic = (model == "gemini-3.8-flash-agentic")
    ctx = "\n".join(f"- {h.intent}" for h in history[-5:])
    ctx_block = f"[이전 대화 맥락 - 새 의도가 '더 짧게', '다른 분위기로' 같은 후속 요청이면 이전 의도와 합쳐서 확장해]\n{ctx}\n" if ctx else ""
    agentic_guide = "\n다각도 가설 기반으로 시각적 대비(풀샷/클로즈업/동적 모션)를 고려하여 정교하게 확장하라." if is_agentic else ""
    prompt = f"""너는 영상 편집 기획자야. 사용자의 제작 의도(Editing Brief)를 영상에서 실제로 찾을 수 있는
구체적인 시각적/청각적 장면 묘사 3개로 확장해. 3개는 서로 다른 장면·구도가 되도록 해.{agentic_guide}
{ctx_block}
[제작 의도] {intent}

반드시 아래 JSON 형식으로만 출력해.
{{"expanded_queries": ["장면 묘사1", "장면 묘사2", "장면 묘사3"]}}"""

    if is_agentic:
        config = types.GenerateContentConfig(temperature=0.7, thinking_config=types.ThinkingConfig(thinking_budget=1024))
    else:
        config = {'temperature': 0.7}
    text = generate_with_retry(model, [prompt], config)
    try:
        return parse_json(text).get("expanded_queries", [])[:5]
    except Exception:
        return []


FEEDBACK_MARK = {"good": " 👍", "bad": " 👎"}


def build_context_block(history, more):
    """이전 대화(의도·추천 구간·👍/👎)를 정리 - 후속 요청을 이어서 해석하고 같은 후보가 반복되지 않도록"""
    turns = []
    for i, h in enumerate(history[-5:], 1):
        clips = ", ".join(
            f"{c.video_name} {c.start_time:.0f}~{c.end_time:.0f}초{FEEDBACK_MARK.get(c.feedback or '', '')}" for c in h.clips
        )
        line = f"{i}. 의도: {h.intent}"
        if clips:
            line += f"\n   추천했던 구간: {clips}"
        elif h.summary:
            line += f" / 결과: {h.summary}"
        turns.append(line)
    if not turns:
        return ""
    rules = [
        "- 새 입력이 이전 요청을 고치거나 덧붙이는 후속 요청(예: '더 짧게', '다른 거', '사람 많은 장면으로')이면 이전 의도와 합쳐서 해석해.",
        "- 👎 표시된 구간과 비슷한 장면은 피하고, 👍 표시된 구간의 특징은 살려.",
        "- 이전에 추천한 구간을 그대로 다시 추천하지 마. (사용자가 다시 원하는 경우만 예외)",
    ]
    if more:
        rules.append("- 이번 요청은 '다른 후보 보기'야. 위에서 추천했던 구간과 겹치지 않는 새로운 구간만 골라.")
    return "[이전 대화 맥락]\n" + "\n".join(turns) + "\n[대화 이어가기 규칙]\n" + "\n".join(rules) + "\n"


@app.post("/api/search")
def search(req: SearchReq):
    if req.model not in MODEL_IDS:
        raise HTTPException(400, "지원하지 않는 모델입니다.")
    expire_stale_videos()
    targets = [VIDEOS[i] for i in req.video_ids if i in VIDEOS and VIDEOS[i]["status"] == "ready"]
    if not targets:
        raise HTTPException(400, "검색 가능한(처리 완료된) 영상이 없습니다. 왼쪽 패널에서 영상을 추가하고 선택해주세요.")
    if len(targets) > MAX_VIDEOS_PER_SEARCH:
        raise HTTPException(400, f"한 번에 최대 {MAX_VIDEOS_PER_SEARCH}개 영상까지 검색할 수 있습니다. 왼쪽 패널에서 선택을 줄여주세요.")

    client = get_client()
    is_agentic = (req.model == "gemini-3.8-flash-agentic")

    # 1단계: 질의 확장
    queries = [q for q in (req.queries or []) if q.strip()]
    if req.use_expansion and not queries:
        try:
            queries = expand_queries(req.intent, req.model, req.history)
        except HTTPException as e:
            if e.status_code == 429:
                raise
            queries = []  # 질의 확장만 실패하면 의도 그대로 검색 진행

    if queries:
        expansion_block = "1. 질의 확장 결과(아래 장면들을 우선 탐색):\n" + "\n".join(f"   - {q}" for q in queries)
    else:
        expansion_block = "1. 질의 확장: 사용 안함. 입력된 의도 그대로만 탐색하라."

    video_list = "\n".join(f"- [영상 {i}] {v['name']}" for i, v in enumerate(targets, 1))
    ctx_block = build_context_block(req.history, req.more)

    agentic_block = """
[에이전틱 자기 검증(Self-Reflection) 필수]
- 1단계 가설 수립: 확장된 질의와 매칭되는 후보 구간들을 넉넉히 발굴한다.
- 2단계 비판적 재검토: 각 후보 컷의 구도, 인물, 속도감이 [제작 의도]에 완벽히 부합하는지 자기 비판(Critique)한다.
- 3단계 최종 엄선: 모호하거나 부합하지 않는 컷은 배제하고 최고 순위만 선별한다.
""" if is_agentic else ""
    diversity_block = """
[후보 다양성]
- 추천 클립끼리 구도(풀샷·미디엄·클로즈업), 움직임, 분위기가 서로 겹치지 않게 다양하게 골라.
- 영상이 여러 개면 가능한 한 여러 영상에서 고르고, 시간 구간이 서로 겹치는 클립은 피해.
"""

    prompt = f"""너는 최고 수준의 영상 편집자이자 AI 분석가야.
사용자의 [제작 의도: {req.intent}]를 바탕으로, 첨부된 영상들에서 가장 완벽하게 부합하는 클립을 추천해야 해.
각 영상 바로 앞에 '[영상 번호] 이름' 라벨을 붙여 첨부했고, 순서대로 다음과 같아:
{video_list}
{ctx_block}{agentic_block}{diversity_block}
다음 순서대로 생각하고 분석해:
{expansion_block}
2. 컷 탐색: 확장된 장면들이 각 영상의 몇 분 몇 초(타임스탬프)에 등장하는지 면밀히 스캔해.
3. 최종 편집 추천: 탐색된 컷들 중 '제작 의도'에 가장 완벽하게 맞는 IN/OUT 타임스탬프 {req.num_clips}개를 엄선해.
   각 클립이 왜 추천되었는지 '추천 이유(2~3줄)'와 '신뢰도(높음/중간/낮음)', 어떤 확장 질의와 매칭되었는지를 평가해.

출력은 반드시 아래의 JSON 형식으로만 작성해. 마크다운 기호나 다른 설명은 절대 추가하지 마.
{{
  "clips": [
    {{
      "video_name": "영상 이름 ([영상 번호] 라벨 뒤의 이름, 위 목록 중 하나와 정확히 일치)",
      "start_time": 시작초(정수),
      "end_time": 종료초(정수),
      "reason": "추천 이유",
      "confidence": "높음",
      "matched_query": "매칭된 확장 질의"
    }}
  ]
}}"""

    # SDK 가 파일의 display_name 을 모델에 전달하지 않으므로 영상마다 이름 라벨을 직접 붙임
    contents = []
    for i, v in enumerate(targets, 1):
        contents.append(f"[영상 {i}] {v['name']}")
        if v["gemini_name"]:
            try:
                contents.append(client.files.get(name=v["gemini_name"]))
            except Exception:
                raise HTTPException(400, f"'{v['name']}' 영상의 Gemini 파일을 찾을 수 없습니다. 삭제 후 다시 추가해주세요.")
        else:
            # URL 모드: Gemini 가 유튜브에서 직접 영상을 읽음 (공개 영상만 가능)
            contents.append(types.Part(file_data=types.FileData(file_uri=youtube_watch_url(v["youtube_id"]))))
    contents.append(prompt)

    # 2~3단계: 컷 탐색 + 최종 추천 (에이전틱 모델일 경우 Thinking Budget 활성화)
    # temperature 를 0.2 → 0.7 로 올려 매번 같은 후보만 나오지 않게 하고, "다른 후보 보기"는 더 다양하게
    temperature = 1.0 if req.more else 0.7
    if is_agentic:
        config = types.GenerateContentConfig(
            temperature=temperature,
            thinking_config=types.ThinkingConfig(thinking_budget=2048)
        )
    else:
        config = {'temperature': temperature}

    text = generate_with_retry(req.model, contents, config)
    try:
        data = parse_json(text)
    except Exception:
        raise HTTPException(502, f"AI 응답을 JSON으로 분석하는 데 실패했습니다.\n{text[:500]}")

    name_map = {v["name"]: v["id"] for v in targets}
    clips = []
    for i, c in enumerate(data.get("clips", [])):
        vname = re.sub(r"^\[영상 \d+\]\s*", "", c.get("video_name", "") or "")
        vid_id = name_map.get(vname) or next((vid for n, vid in name_map.items() if vname and (vname in n or n in vname)), None)
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

    if req.more:
        # AI 가 지시를 어기고 이전 구간을 다시 내놓는 경우가 있어, 절반 이상 겹치는 후보는 직접 제외
        prev = [(c.video_name, c.start_time, c.end_time) for h in req.history for c in h.clips]

        def overlaps_prev(clip):
            length = max(clip["end_time"] - clip["start_time"], 0.1)
            return any(
                name == clip["video_name"] and max(0.0, min(clip["end_time"], e) - max(clip["start_time"], s)) / length > 0.5
                for name, s, e in prev
            )

        clips = [c for c in clips if not overlaps_prev(c)]
        for i, c in enumerate(clips):
            c["rank"] = i + 1

    return {"expanded_queries": queries, "clips": clips, "usage": USAGE}


# ----------------- 정적 프론트엔드 (단일 서버 배포) -----------------
# npm run build:static 결과물(frontend/out)이 있으면 같은 주소에서 UI 도 함께 제공 (위의 /api 라우트가 우선)
if STATIC_DIR.is_dir():
    app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="web")
