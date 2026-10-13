// 단일 서버 배포용 정적 빌드 → frontend/out (FastAPI 가 같은 주소에서 함께 제공)
// NEXT_PUBLIC_API_URL=/ 이면 lib/api.ts 가 끝의 / 를 지워 API 주소가 상대 경로(/api/...)가 됨
import { spawnSync } from "node:child_process";

const result = spawnSync("npx next build", {
  stdio: "inherit",
  shell: true,
  env: { ...process.env, NEXT_OUTPUT: "export", NEXT_PUBLIC_API_URL: "/" },
});
process.exit(result.status ?? 1);
