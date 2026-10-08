import streamlit as st
import os
from dotenv import load_dotenv

# .env 파일 환경 변수 로드
load_dotenv()
import time
import tempfile
import yt_dlp
import uuid
from google import genai
from google.genai import types

def download_youtube_video(url, output_path):
    """yt-dlp를 사용하여 유튜브 비디오를 다운로드합니다."""
    ydl_opts = {
        # ffmpeg를 이용하여 비디오와 오디오를 최적의 화질(최대 1080p)로 병합하여 다운로드
        'format': 'bestvideo[ext=mp4][height<=1080]+bestaudio[ext=m4a]/best[ext=mp4][height<=1080]/best',
        'outtmpl': output_path,
        'quiet': True,
        'no_warnings': True,
    }
    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        ydl.download([url])

def poll_video_processing(client, file_name):
    """비디오가 처리를 완료하고 ACTIVE 상태가 될 때까지 폴링합니다."""
    with st.spinner("비디오를 Gemini 서버에서 처리 중입니다. (영상의 길이에 따라 수 분이 소요될 수 있습니다...)"):
        while True:
            video_file = client.files.get(name=file_name)
            if video_file.state == "ACTIVE":
                break
            elif video_file.state == "FAILED":
                raise Exception("비디오 처리에 실패했습니다. 다른 영상을 시도해주세요.")
            time.sleep(5) # 5초마다 상태 확인

def analyze_video(api_key, video_path, query):
    """준비된 비디오 파일을 Gemini API로 분석합니다."""
    # 1. 클라이언트 초기화
    client = genai.Client(api_key=api_key)
    uploaded_file = None
    
    try:
        # 2. 파일 업로드
        with st.spinner("비디오를 구글 서버로 업로드 중입니다..."):
            uploaded_file = client.files.upload(file=video_path)
            
        # 3. 파일 처리 대기 (Polling)
        poll_video_processing(client, uploaded_file.name)
        
        # 4. 모델 호출
        with st.spinner("Gemini 3.8 Flash 모델이 장면을 분석하고 있습니다... (구글 서버 혼잡 시 자동 재시도)"):
            prompt = f"영상에서 '{query}' 장면이 나오는 구간을 모두 찾아 '시작초 ~ 종료초' 형식으로만 답변해 줘. 부가 설명은 하지 마."
            
            # 503 서버 혼잡 에러 대비 자동 재시도 로직
            max_retries = 3
            for attempt in range(max_retries):
                try:
                    response = client.models.generate_content(
                        model='gemini-3.1-pro',
                        contents=[uploaded_file, prompt],
                    )
                    return response.text
                except Exception as e:
                    if "503" in str(e) and attempt < max_retries - 1:
                        time.sleep(3) # 3초 대기 후 재시도
                        continue
                    raise e
            
    except Exception as e:
        raise Exception(f"AI 분석 중 오류 발생: {str(e)}")
        
    finally:
        # 5. 클린업 (구글 서버에 업로드된 파일 삭제)
        if uploaded_file:
            try:
                client.files.delete(name=uploaded_file.name)
            except Exception as e:
                st.error(f"원격 파일 삭제 중 오류: {str(e)}")

st.set_page_config(page_title="자연어 비디오 씬 검색", page_icon="🎥")
st.title("🎥 자연어 기반 비디오 씬(Scene) 검색기")
st.markdown("유튜브 링크 또는 영상 파일을 업로드하고, 찾고 싶은 장면을 자연어로 검색해보세요!")

# 서버(관리자) 환경 변수(.env)에서 API 키를 가져와서 고정으로 사용 (UI 노출 없음)
api_key = os.environ.get("GEMINI_API_KEY", "")

# 소스 선택
source_type = st.radio("영상 소스를 선택하세요", ["유튜브 링크", "로컬 파일 업로드"])

video_path = None
youtube_url = ""
uploaded_file = None

if source_type == "유튜브 링크":
    youtube_url = st.text_input("유튜브 URL을 입력하세요 (예: https://www.youtube.com/watch?v=...)")
else:
    uploaded_file = st.file_uploader("MP4 파일을 업로드하세요", type=["mp4", "mov", "avi"])

query = st.text_input("찾고 싶은 장면을 묘사해주세요 (예: 사람이 텐트를 치는 장면)")

if st.button("장면 찾기", type="primary"):
    if not api_key:
        st.error("서버에 Gemini API Key가 설정되지 않았습니다. (.env 파일을 확인해주세요)")
        st.stop()
    if not query:
        st.warning("찾고 싶은 장면을 입력해주세요.")
        st.stop()
        
    temp_video_path = None
    try:
        # 한글 파일명으로 인한 Unicode 오류 방지를 위해 영문/숫자 임시 파일 생성
        temp_dir = tempfile.gettempdir()
        temp_filename = f"temp_video_{uuid.uuid4().hex}.mp4"
        temp_video_path = os.path.join(temp_dir, temp_filename)

        # 소스에 따른 영상 준비
        if source_type == "유튜브 링크":
            if not youtube_url:
                st.warning("유튜브 URL을 입력해주세요.")
                st.stop()
            with st.spinner("유튜브 영상을 다운로드 중입니다 (720p~1080p)..."):
                download_youtube_video(youtube_url, temp_video_path)
                
        else: # 로컬 파일
            if not uploaded_file:
                st.warning("영상을 업로드해주세요.")
                st.stop()
            with open(temp_video_path, "wb") as f:
                f.write(uploaded_file.read())
                
        # 분석 실행
        result = analyze_video(api_key, temp_video_path, query)
        
        st.success("🎉 분석 완료!")
        st.markdown("### 🔎 검색 결과")
        st.info(result)
        
    except Exception as e:
        st.error(f"처리 중 오류가 발생했습니다: {str(e)}")
        
    finally:
        # 로컬 임시 파일 삭제 (클린업)
        if temp_video_path and os.path.exists(temp_video_path):
            try:
                os.remove(temp_video_path)
            except Exception as e:
                st.error(f"임시 파일 삭제 중 오류: {str(e)}")
