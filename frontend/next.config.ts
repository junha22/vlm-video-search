import type { NextConfig } from "next";

// npm run build:static → FastAPI 가 같은 주소에서 제공할 정적 파일(out/) 생성
// 정적 export 는 cacheComponents/partialPrefetching 과 함께 쓸 수 없어 그 빌드에서만 끔
const isStaticExport = process.env.NEXT_OUTPUT === "export";

const nextConfig: NextConfig = {
  ...(isStaticExport ? { output: "export" as const } : { cacheComponents: true, partialPrefetching: true }),
  // 개발용 'N' 배지가 사이드바 하단 문구를 가리지 않도록 오른쪽 아래로 이동
  devIndicators: { position: "bottom-right" },
};

export default nextConfig;
