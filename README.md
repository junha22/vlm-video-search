# 🎬 IntentCut: 의도 기반 편집 구간 추천 시스템 (VLM Video Search)

이 프로젝트는 **구글 Gemini AI (gemini-1.5-pro, gemini-2.0-flash 등)**를 활용하여, 유튜브 링크 기반의 영상에서 사용자의 '제작 의도'를 파악해 가장 적합한 편집점(Clip)을 추천해 주는 웹 애플리케이션입니다. 단순한 장면 검색(Moment Retrieval)을 넘어 사용자의 의도를 여러 질의로 확장(Query Expansion)하여 최적의 컷을 찾아냅니다.

기존 Streamlit 단일 구조에서 **FastAPI(백엔드) + Next.js(프론트엔드)** 구조로 전면 리팩토링되어, 향상된 UX와 세련된 다크 테마 UI를 제공합니다.

## ✨ 주요 기능
- **제작 의도 기반 검색 & 질의 확장 (Query Expansion)**: "부대 홍보영상 도입부에 쓸 활기찬 훈련 장면"과 같은 의도를 입력하면, 시스템이 다각도로 검색어를 확장하여 영상을 분석합니다.
- **영상 소스 관리 (Multi-video)**: 여러 유튜브 영상을 업로드하고, 원하는 영상만 선택하여 교차 검색할 수 있습니다.
- **클립 추천 및 미리보기**: AI가 추천하는 구간(IN/OUT 타임스탬프)과 추천 이유, 신뢰도를 한눈에 확인하고 즉시 재생해 볼 수 있습니다.
- **고화질 유튜브 다운로드**: `yt-dlp`와 `ffmpeg`를 이용해 고화질로 로컬 임시 다운로드 후 처리합니다.
- **안정성 및 스마트 클린업**: 503 에러 발생 시 재시도하는 방어 로직과, 분석이 끝난 직후 임시 파일을 클린업하는 로직이 적용되어 있습니다.

## 🛠 기술 스택
- **백엔드 (API & 비디오 처리)**: Python, FastAPI, yt-dlp, ffmpeg
- **프론트엔드 (UI)**: Next.js (App Router), React, Tailwind CSS 스타일 기반 커스텀 CSS (Dark Mode)
- **AI API**: Google GenAI SDK (`google-genai`)

## 🚀 설치 및 실행 방법

이 프로젝트는 **백엔드**와 **프론트엔드** 서버를 각각 실행해야 합니다.

### 1. 백엔드 (FastAPI) 설정 및 실행

가상 환경 설정 및 패키지 설치를 진행합니다.

```bash
# 가상 환경 생성
python -m venv venv

# 가상 환경 활성화 (Windows 기준)
.\venv\Scripts\activate
# (Mac/Linux의 경우: source venv/bin/activate)

# 필수 패키지 설치
pip install fastapi uvicorn "yt-dlp[default,deno]" google-genai python-dotenv pydantic
# 또는 기존 방식대로 pip install -r requirements.txt (fastapi, uvicorn 등 백엔드 패키지 추가 필요)
```

**FFmpeg 설치** (Windows 환경 필수)
유튜브 고화질 영상 처리를 위해 `ffmpeg`가 필요합니다. PowerShell에서 아래를 실행하세요:
```powershell
Invoke-WebRequest -Uri "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip" -OutFile "ffmpeg.zip"
Expand-Archive -Path "ffmpeg.zip" -DestinationPath "." -Force
Copy-Item ".\ffmpeg-master-latest-win64-gpl\bin\ffmpeg.exe" -Destination "."
Copy-Item ".\ffmpeg-master-latest-win64-gpl\bin\ffprobe.exe" -Destination "."
Remove-Item "ffmpeg.zip"
Remove-Item -Recurse -Force ".\ffmpeg-master-latest-win64-gpl"
```
*(Mac/Linux 유저는 터미널에 `brew install ffmpeg` 또는 `sudo apt install ffmpeg` 입력)*

**환경 변수 설정 (.env)**
프로젝트 최상단에 `.env` 파일을 만들고 API 키를 입력합니다.
```env
GEMINI_API_KEY=당신의_제미나이_API_키를_여기에_입력하세요
```

**백엔드 서버 실행**
```bash
uvicorn backend.main:app --reload --reload-dir backend --port 8000
```
(서버가 `http://localhost:8000`에서 실행됩니다.)

### 2. 프론트엔드 (Next.js) 설정 및 실행

새로운 터미널을 열고 `frontend` 폴더로 이동합니다. (Node.js 설치 필수)

```bash
cd frontend

# 패키지 설치
npm install

# 개발 서버 실행
npm run dev
```
(서버가 `http://localhost:3000`에서 실행됩니다.)

### 3. 접속 및 사용
브라우저에서 `http://localhost:3000`에 접속하여 서비스를 이용합니다.

## ☁️ 무료 배포 (Azure for Students)
VM 한 대에 프론트엔드와 백엔드를 함께 올리는 방법은 [deploy/AZURE.md](deploy/AZURE.md)를 참고하세요.

## 📝 사용 방법 요약
1. **영상 소스 선택**: 왼쪽 패널에서 유튜브 링크를 추가하고 검색 대상 체크박스를 활성화합니다.
2. **제작 의도 입력**: 중앙 채팅 패널에서 찾고 싶은 장면의 "의도"를 자연어로 입력하고 전송합니다.
3. **질의 확장**: AI가 입력된 의도를 바탕으로 세부 검색 질의를 생성하는 과정을 확인합니다.
4. **추천 클립 확인**: 오른쪽 패널에서 분석이 완료된 클립 목록을 확인하고, 클릭하여 해당 구간을 재생해 봅니다.
