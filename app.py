import streamlit as st
import os
import time
import tempfile
import yt_dlp
import uuid
import json
from dotenv import load_dotenv
from google import genai

# .env 파일 환경 변수 로드
load_dotenv()
api_key = os.environ.get("GEMINI_API_KEY", "")

# ----------------- 설정 및 상태 초기화 -----------------
st.set_page_config(page_title="의도 기반 편집 구간 추천 시스템", layout="wide", page_icon="✂️")

if "videos" not in st.session_state:
    st.session_state.videos = [] # [{'id', 'name', 'local_path', 'gemini_file', 'selected'}]
if "chat_history" not in st.session_state:
    st.session_state.chat_history = []
if "clips" not in st.session_state:
    st.session_state.clips = []
if "total_tokens" not in st.session_state:
    st.session_state.total_tokens = 0
if "current_model" not in st.session_state:
    st.session_state.current_model = "gemini-3.1-pro"

model_options = {
    "Gemini 3.1 Pro": "gemini-3.1-pro",
    "Gemini 3.8 Flash": "gemini-3.8-flash",
    "Gemini 3.8 Flash (에이전틱)": "gemini-3.8-flash-agentic",
    "Gemini 3.1 Flash-Lite": "gemini-3.1-flash-lite"
}

# 입력창 하단 상태 바 스타일 (모델 선택 / 토큰 사용량)
st.html("""
<style>
.st-key-input_status_bar {
    margin-top: -0.75rem;
    padding: 0 0.25rem;
    min-height: 0;
}
.st-key-input_status_bar [data-testid="stSelectbox"] [role="group"] {
    min-height: 1.75rem;
    background-color: transparent;
    border-color: transparent;
    opacity: 0.75;
}
.st-key-input_status_bar [data-testid="stSelectbox"] [role="group"]:hover,
.st-key-input_status_bar [data-testid="stSelectbox"] [role="group"]:focus-within {
    background-color: rgba(128, 128, 128, 0.12);
    opacity: 1;
}
.st-key-input_status_bar [data-testid="stSelectbox"] input {
    font-size: 0.8rem;
    cursor: pointer;
}
/* 지원 브라우저에서는 드롭다운 폭을 모델명 길이에 맞춘다 (미지원 시 고정 폭 유지) */
@supports (field-sizing: content) {
    .st-key-input_status_bar [data-testid="stElementContainer"]:has([data-testid="stSelectbox"]) {
        flex: 0 0 auto;
        width: auto;
    }
    .st-key-input_status_bar [data-testid="stSelectbox"] input {
        field-sizing: content;
        flex: 0 1 auto;
        width: auto;
        min-width: 0;
    }
}
/* 드롭다운 목록은 트리거 폭을 따르므로, 상태 바의 드롭다운이 열렸을 때만 최소 폭을 준다 */
body:has(.st-key-input_status_bar [role="combobox"][aria-expanded="true"]) [data-testid="stSelectboxVirtualDropdown"] {
    min-width: 15rem;
}
.st-key-input_status_bar [data-testid="stCaptionContainer"] {
    font-size: 0.8rem;
    white-space: nowrap;
}
</style>
""")

# ----------------- 핵심 로직 함수 -----------------
def get_client():
    if not api_key:
        st.error("서버에 Gemini API Key가 설정되지 않았습니다. (.env 파일을 확인해주세요)")
        st.stop()
    return genai.Client(api_key=api_key)

def download_youtube_video(url, output_path):
    ydl_opts = {
        'format': 'bestvideo[ext=mp4][height<=1080]+bestaudio[ext=m4a]/best[ext=mp4][height<=1080]/best',
        'outtmpl': output_path,
        'quiet': True,
        'no_warnings': True,
        'extractor_args': {'youtube': {'player_client': ['android', 'web']}},
    }
    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        ydl.download([url])

def poll_video_processing(client, file_name):
    while True:
        video_file = client.files.get(name=file_name)
        if video_file.state == "ACTIVE":
            break
        elif video_file.state == "FAILED":
            raise Exception("비디오 처리에 실패했습니다.")
        time.sleep(3)

# ----------------- UI Layout (3-Column) -----------------
col_left, col_mid, col_right = st.columns([1, 2, 1.5], gap="large")

# ========================================================
# [왼쪽 패널] 영상 소스 관리
# ========================================================
with col_left:
    st.subheader("📁 영상 소스 관리")
    
    # 1. 로컬 파일 다중 업로드
    uploaded_files = st.file_uploader("로컬 영상 업로드", type=["mp4", "mov", "avi"], accept_multiple_files=True)
    if st.button("로컬 영상 추가", use_container_width=True):
        client = get_client()
        for uf in uploaded_files:
            if any(v['name'] == uf.name for v in st.session_state.videos):
                continue # 중복 방지
                
            with st.spinner(f"'{uf.name}' 업로드 중..."):
                temp_dir = tempfile.gettempdir()
                temp_path = os.path.join(temp_dir, f"temp_{uuid.uuid4().hex}.mp4")
                with open(temp_path, "wb") as f:
                    f.write(uf.read())
                
                gemini_file = client.files.upload(file=temp_path, config={'display_name': uf.name})
                poll_video_processing(client, gemini_file.name)
                
                st.session_state.videos.append({
                    'id': str(uuid.uuid4()),
                    'name': uf.name,
                    'local_path': temp_path,
                    'gemini_file': gemini_file,
                    'selected': True
                })
        st.rerun()

    st.markdown("---")
    # 2. 유튜브 영상 추가
    yt_url = st.text_input("유튜브 링크 추가")
    if st.button("유튜브 영상 추가", use_container_width=True):
        if yt_url:
            client = get_client()
            with st.spinner("유튜브 다운로드 및 업로드 중..."):
                temp_dir = tempfile.gettempdir()
                vid_id = str(uuid.uuid4())
                temp_path = os.path.join(temp_dir, f"yt_{vid_id}.mp4")
                download_youtube_video(yt_url, temp_path)
                
                display_name = f"Youtube_{vid_id[:6]}"
                gemini_file = client.files.upload(file=temp_path, config={'display_name': display_name})
                poll_video_processing(client, gemini_file.name)
                
                st.session_state.videos.append({
                    'id': vid_id,
                    'name': display_name,
                    'local_path': temp_path,
                    'gemini_file': gemini_file,
                    'selected': True
                })
            st.rerun()

    st.markdown("---")
    st.markdown("**목록 (검색 대상 선택)**")
    
    # 3. 다중 영상 목록 및 체크박스 (삭제 기능 포함)
    for i, vid in enumerate(st.session_state.videos):
        c1, c2 = st.columns([5, 1])
        with c1:
            is_checked = st.checkbox(f"🎬 {vid['name']}", value=vid['selected'], key=f"chk_{vid['id']}")
            st.session_state.videos[i]['selected'] = is_checked
        with c2:
            if st.button("❌", key=f"del_{vid['id']}", help="영상 삭제"):
                client = get_client()
                try: client.files.delete(name=vid['gemini_file'].name) # 원격 삭제
                except: pass
                if os.path.exists(vid['local_path']):
                    os.remove(vid['local_path']) # 로컬 삭제
                st.session_state.videos.pop(i)
                st.rerun()


# ========================================================
# [가운데 패널] 대화형 검색 (의도 기반)
# ========================================================
with col_mid:
    st.subheader("💬 대화형 검색 (제작 의도 입력)")
    
    # 질의 확장 ON/OFF 토글 실험기능
    use_expansion = st.toggle("✨ 질의 확장 (Query Expansion) 적용", value=True, help="사용자의 추상적 의도를 AI가 스스로 분해하여 검색 품질을 높입니다.")
    
    st.markdown("---")
    # 대화 이력 렌더링
    for chat in st.session_state.chat_history:
        with st.chat_message(chat['role']):
            st.markdown(chat['content'])
            if chat.get('expanded_queries'):
                st.info("🔍 **확장된 질의:** " + " / ".join(chat['expanded_queries']))

    # 채팅 입력
    user_intent = st.chat_input("예: 부대 홍보영상 도입부에 쓸 활기찬 훈련 장면")

    # 입력창 하단 상태 바: 왼쪽 분석 모델 선택, 오른쪽 누적 토큰
    with st.container(key="input_status_bar", horizontal=True, horizontal_alignment="distribute", vertical_alignment="center", gap=None):
        current_idx = list(model_options.values()).index(st.session_state.current_model) if st.session_state.current_model in model_options.values() else 0
        selected_model_display = st.selectbox("분석 모델", list(model_options.keys()), index=current_idx, label_visibility="collapsed", width=210)
        st.session_state.current_model = model_options[selected_model_display]
        st.caption(f"{st.session_state.total_tokens:,} tokens", width="content")

    if user_intent:
        selected_vids = [v for v in st.session_state.videos if v['selected']]
        if not selected_vids:
            st.warning("선택된 영상이 없습니다. 왼쪽 패널에서 영상을 추가하고 체크해주세요.")
        else:
            # 1. 사용자 채팅 기록
            st.session_state.chat_history.append({'role': 'user', 'content': user_intent})
            
            client = get_client()
            with st.spinner("AI가 제작 의도를 분석하고 최적의 편집점을 추출하고 있습니다... (최대 1~2분 소요)"):
                
                expansion_prompt = """1. 질의 확장: 이 의도를 표현하기 위해 첨부된 영상들에서 찾아야 할 구체적인 시각적/청각적 장면 3가지를 도출하라.""" if use_expansion else """1. 질의 확장: 사용 안함. 입력된 의도 그대로만 탐색하라."""
                
                # Chain-of-Thought 구조의 프롬프트 및 JSON 강제 출력
                prompt = f"""너는 최고 수준의 영상 편집자이자 AI 분석가야. 
사용자의 [제작 의도: {user_intent}]를 바탕으로, 첨부된 영상들에서 가장 완벽하게 부합하는 클립을 추천해야 해.
각 영상의 이름은 파일의 display_name 속성(메타데이터)으로 구분해.

다음 순서대로 생각하고 분석해:
{expansion_prompt}
2. 컷 탐색: 확장된 장면들이 각 영상의 몇 분 몇 초(타임스탬프)에 등장하는지 면밀히 스캔해.
3. 최종 편집 추천: 탐색된 컷들 중 '제작 의도'에 가장 완벽하게 맞는 IN/OUT 타임스탬프 3개를 엄선해. 
   각 클립이 왜 추천되었는지 '추천 이유(2~3줄)'와 '신뢰도(높음/중간/낮음)'를 평가해.

출력은 반드시 아래의 JSON 형식으로만 작성해. 마크다운 기호(```json)나 다른 설명은 절대 추가하지 마.
{{
  "expanded_queries": ["확장된 질의1", "확장된 질의2", "확장된 질의3"],
  "clips": [
    {{
      "video_name": "영상의 display_name",
      "start_time": 시작초(정수, 예: 12),
      "end_time": 종료초(정수, 예: 18),
      "reason": "추천 이유",
      "confidence": "높음"
    }}
  ]
}}
"""
                contents = [v['gemini_file'] for v in selected_vids]
                contents.append(prompt)
                
                max_retries = 3
                response_text = ""
                for attempt in range(max_retries):
                    try:
                        response = client.models.generate_content(
                            model=st.session_state.current_model,
                            contents=contents,
                            # 온도(temperature)를 낮춰 JSON 구조의 안정성 확보
                            config={'temperature': 0.2} 
                        )
                        response_text = response.text
                        
                        if hasattr(response, 'usage_metadata') and response.usage_metadata:
                            st.session_state.total_tokens += response.usage_metadata.total_token_count
                        break
                    except Exception as e:
                        if "503" in str(e) and attempt < max_retries - 1:
                            time.sleep(3)
                            continue
                        st.error(f"서버 오류 발생: {e}")
                        st.stop()
                
                # 결과(JSON) 파싱
                cleaned_text = response_text.replace("```json", "").replace("```", "").strip()
                try:
                    result_data = json.loads(cleaned_text)
                    st.session_state.clips = result_data.get('clips', [])
                    
                    st.session_state.chat_history.append({
                        'role': 'assistant',
                        'content': f"총 {len(st.session_state.clips)}개의 추천 클립을 찾았습니다. 오른쪽 패널을 확인해주세요!",
                        'expanded_queries': result_data.get('expanded_queries', [])
                    })
                except Exception as e:
                    st.error("AI 응답을 JSON으로 분석하는 데 실패했습니다.")
                    st.code(response_text)
            
            st.rerun()


# ========================================================
# [오른쪽 패널] 추천 클립 패널
# ========================================================
with col_right:
    st.subheader("🎬 추천 클립 리스트")
    
    if not st.session_state.clips:
        st.info("아직 추천된 클립이 없습니다. 챗봇을 통해 의도를 입력해보세요.")
    else:
        for idx, clip in enumerate(st.session_state.clips):
            # 클립 카드 컨테이너
            with st.container(border=True):
                st.markdown(f"#### 🏆 {idx+1}위: `{clip.get('video_name')}`")
                st.markdown(f"**구간:** `{clip.get('start_time')}초 ~ {clip.get('end_time')}초` ⏱️ | **신뢰도:** {clip.get('confidence')}")
                st.write(clip.get('reason'))
                
                # 로컬 비디오 매칭 후 미리보기 재생
                match_vid = next((v for v in st.session_state.videos if v['name'] == clip.get('video_name')), None)
                if match_vid:
                    try:
                        # start_time을 지정하여 해당 구간부터 재생
                        st.video(match_vid['local_path'], start_time=int(clip.get('start_time', 0)))
                    except:
                        st.video(match_vid['local_path'])
                else:
                    st.warning("해당 비디오 소스를 찾을 수 없습니다.")
                
                # Human Review 버튼 (향후 액션 기능 추가 가능)
                c1, c2, c3 = st.columns(3)
                with c1:
                    st.button("⬇️ 다운로드", key=f"dl_{idx}")
                with c2:
                    st.button("👍 적합함", key=f"up_{idx}")
                with c3:
                    st.button("👎 부적합", key=f"down_{idx}")
