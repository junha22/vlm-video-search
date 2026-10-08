# 🎥 자연어 기반 비디오 씬(Scene) 검색기

이 프로젝트는 **구글 Gemini AI (gemini-3.1-pro)**를 활용하여, 유튜브 링크나 로컬 비디오 파일에서 사용자가 입력한 자연어(예: "사람이 텐트를 치는 장면")와 일치하는 장면의 타임스탬프(시작초 ~ 종료초)를 자동으로 찾아주는 웹 애플리케이션입니다.

## ✨ 주요 기능
- **다양한 소스 지원**: 유튜브 URL 입력 및 로컬 MP4, MOV, AVI 파일 업로드 지원
- **고화질 유튜브 다운로드**: `yt-dlp`와 `ffmpeg`를 이용한 고화질 비디오/오디오 병합 다운로드
- **최신 AI 모델**: 구글 최신 `google-genai` SDK 및 `gemini-3.1-pro` 모델 적용
- **안정성 (Retry Logic)**: 구글 서버 혼잡 시 (503 에러) 자동으로 3초 대기 후 재시도하는 방어 로직 구현
- **스마트 클린업**: AI 분석이 끝난 직후, 내 컴퓨터와 구글 클라우드에 올라간 임시 비디오 파일들을 즉시 삭제하여 용량 낭비 방지

## 🛠 기술 스택
- **언어**: Python
- **UI 프레임워크**: Streamlit
- **비디오 처리**: yt-dlp, ffmpeg
- **AI API**: Google GenAI SDK (`google-genai`)

## 🚀 설치 및 실행 방법

### 1. 가상 환경 설정 및 패키지 설치
이 프로젝트는 파이썬 가상 환경(`venv`) 내에서 실행하는 것을 권장합니다.

```bash
# 가상 환경 생성
python -m venv venv

# 가상 환경 활성화 (Windows 기준)
.\venv\Scripts\activate

# (Mac/Linux의 경우)
# source venv/bin/activate

# 필수 패키지 설치
pip install -r requirements.txt
```

### 2. FFmpeg 설치
유튜브 고화질 영상의 비디오와 오디오 스트림을 완벽하게 병합하기 위해 `ffmpeg`가 필요합니다.
Windows 사용자의 경우 **PowerShell** 터미널에 아래 명령어 블록을 그대로 복사해서 붙여넣고 엔터를 치면, 알아서 다운로드부터 설치(파일 복사) 및 찌꺼기 파일 삭제까지 자동으로 완료됩니다!

```powershell
Invoke-WebRequest -Uri "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip" -OutFile "ffmpeg.zip"
Expand-Archive -Path "ffmpeg.zip" -DestinationPath "." -Force
Copy-Item ".\ffmpeg-master-latest-win64-gpl\bin\ffmpeg.exe" -Destination "."
Copy-Item ".\ffmpeg-master-latest-win64-gpl\bin\ffprobe.exe" -Destination "."
Remove-Item "ffmpeg.zip"
Remove-Item -Recurse -Force ".\ffmpeg-master-latest-win64-gpl"
```

위 명령어가 끝나면 프로젝트 폴더 안에 `ffmpeg.exe`와 `ffprobe.exe`가 생성되며, `yt-dlp`가 이를 알아서 찾아 사용하게 됩니다. (Mac/Linux 유저는 터미널에 `brew install ffmpeg` 또는 `sudo apt install ffmpeg`만 치시면 됩니다.)

### 3. 환경 변수 설정 (.env)
프로젝트 폴더 최상단에 `.env` 파일을 만들고, 본인의 Gemini API Key를 입력합니다.
*(참고: 깃허브 등 외부 저장소에 올릴 때는 보안을 위해 `.gitignore`에 반드시 `.env`가 등록되어 있어야 합니다.)*

```env
GEMINI_API_KEY=당신의_제미나이_API_키를_여기에_입력하세요
```

### 4. 앱 실행
가상 환경이 활성화된 상태에서 아래 명령어를 입력하여 앱을 구동합니다.
```bash
streamlit run app.py
```
앱이 실행되면 로컬 웹 브라우저가 열리며 (보통 `http://localhost:8501`) 서비스를 이용할 수 있습니다.

## 📝 사용 방법
1. **영상 소스 선택**: `유튜브 링크`를 복사해 넣거나, 가지고 있는 `로컬 MP4 파일`을 직접 업로드합니다.
2. **자연어 쿼리 입력**: 찾고 싶은 장면을 자세히 묘사합니다. (예: "불이 꺼지고 사람들이 박수 치는 장면")
3. **분석 요청**: `장면 찾기` 버튼을 누르면 AI가 영상을 분석합니다.
4. **결과 확인**: 처리가 완료되면 해당 장면이 나오는 시작 시간과 종료 시간 텍스트가 화면에 출력됩니다.
