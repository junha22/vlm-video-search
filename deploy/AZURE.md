# Azure for Students 배포 가이드

카드 없이 12개월 무료 VM(B2ats v2: CPU 2개 · 메모리 1GB) 한 대에 프론트엔드와 백엔드를 함께 올립니다.

```
브라우저 ──HTTPS──▶ Caddy ──▶ FastAPI (127.0.0.1:8000) · 로그인 화면(쿠키 세션)
                                          ├─ /api/...   백엔드
                                          └─ /          정적 프론트엔드 (frontend/out)
```

서버에서는 `YOUTUBE_MODE=url`로 동작합니다. 클라우드 IP는 유튜브가 다운로드를 차단하기 때문에, 유튜브 링크를 Gemini에 바로 넘겨서 분석합니다.
- 공개 영상만 분석할 수 있습니다.
- 무료 키는 하루 8시간 분량까지 분석할 수 있습니다.
- 미리보기는 유튜브 플레이어로 재생합니다.
- MP4 클립 다운로드는 직접 업로드한 파일만 됩니다.

## 1. VM 만들기 (portal.azure.com)

1. **가상 머신 → 만들기 → Azure 가상 머신**을 선택합니다.
2. **기본 사항** 탭을 이렇게 채웁니다.
   - 구독: Azure for Students
   - 리소스 그룹: **새로 만들기 `intentcut-rg`**. 나중에 이 그룹만 지우면 전부 삭제됩니다.
   - 지역: Korea Central (안 되면 가까운 아시아 지역)
   - 이미지: Ubuntu Server 24.04 LTS - x64 Gen2
   - 크기: **B2ats_v2** ("무료 서비스 사용 가능" 표시 확인)
   - 인증: SSH 공개 키, 사용자 이름 `azureuser`, 키 쌍 이름 `intentcut_key`
   - 인바운드 포트: HTTP(80), HTTPS(443), SSH(22)
3. **디스크** 탭에서 OS 디스크를 **표준 SSD**로 바꿉니다.
4. **관리** 탭에서 **자동 종료**가 켜져 있으면 끕니다.
5. 만들기를 누르고, 내려받은 키를 `C:\Users\<사용자>\.ssh\intentcut_key.pem`에 둡니다.
6. VM 개요 화면에서 **공용 IP 주소**를 확인합니다.
7. (선택) 공용 IP의 **구성 → DNS 이름 레이블**을 정하면 `<이름>.koreacentral.cloudapp.azure.com` 주소가 생깁니다.

## 2. 서버 설치 (PowerShell에서 SSH 접속)

```powershell
ssh -i $HOME\.ssh\intentcut_key.pem azureuser@<공용IP>
```

SSH로 접속한 서버에서 아래를 실행합니다.

```bash
git clone -b deploy/azure https://github.com/junha22/vlm-video-search.git ~/intentcut
bash ~/intentcut/deploy/setup.sh                  # 주소: <IP>.sslip.io
# 또는 DNS 이름 레이블을 만들었다면
bash ~/intentcut/deploy/setup.sh <이름>.koreacentral.cloudapp.azure.com
```

실행 중에 Gemini API 키, 로그인 아이디, 로그인 비밀번호를 차례로 묻습니다.

## 3. 프론트엔드 올리기 (PC의 PowerShell에서)

VM 메모리(1GB)로는 Next.js 빌드가 안 돼서 PC에서 빌드한 뒤 결과물만 올립니다.

```powershell
cd frontend
npm run build:static
scp -i $HOME\.ssh\intentcut_key.pem -r out azureuser@<공용IP>:~/intentcut/frontend/
ssh -i $HOME\.ssh\intentcut_key.pem azureuser@<공용IP> "sudo systemctl restart intentcut"
```

이제 `https://<주소>`로 접속하면 로그인 화면이 나옵니다. 휴대폰 LTE로 외부 접속도 확인해 보세요.

## 업데이트

- **백엔드 코드가 바뀌면**: 서버에서 `bash ~/intentcut/deploy/update.sh`를 실행합니다.
- **화면 코드가 바뀌면**: 3번을 다시 합니다.
- **설정을 바꾸려면**: 서버에서 `nano ~/intentcut/.env`로 수정한 뒤 `sudo systemctl restart intentcut`을 실행합니다.
- **아이디·비밀번호를 바꾸려면**: `bash ~/intentcut/deploy/setup.sh`를 다시 실행합니다. 바꾸면 기존 로그인은 모두 풀립니다.

## 문제 해결

| 증상 | 확인 |
|---|---|
| 접속이 안 됨 | VM 네트워킹에서 80/443 인바운드가 허용됐는지 확인. `sudo systemctl status caddy` |
| 502 오류 | `sudo journalctl -u intentcut -n 50` |
| 화면 대신 `{"detail":"Not Found"}` | `frontend/out`을 올린 뒤 `sudo systemctl restart intentcut` |
| SSH에서 "UNPROTECTED PRIVATE KEY" 오류 | 키 파일을 `C:\Users\<사용자>\.ssh\`로 옮기기 |

## 삭제

포털에서 **리소스 그룹 `intentcut-rg` → 리소스 그룹 삭제**를 누르면 VM, 디스크, 공용 IP가 한 번에 지워집니다.
- VM만 지우면 디스크와 공용 IP가 남아 크레딧이 계속 줄어듭니다.
- 카드를 등록하지 않았으니 요금이 청구되지는 않습니다.
