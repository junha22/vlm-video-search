import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  // 개발용 'N' 배지가 사이드바 하단 문구를 가리지 않도록 오른쪽 아래로 이동
  devIndicators: { position: "bottom-right" },
};

export default nextConfig;
