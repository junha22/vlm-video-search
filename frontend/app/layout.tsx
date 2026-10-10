import type { Metadata } from "next";
import { Inter, JetBrains_Mono, Noto_Sans_KR } from "next/font/google";
import "./globals.css";
import "./shell.css";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });
const notoKr = Noto_Sans_KR({ variable: "--font-noto-kr", subsets: ["latin"], weight: ["400", "500", "600", "700", "800"] });
const jetbrains = JetBrains_Mono({ variable: "--font-jetbrains", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "IntentCut · 의도 기반 편집 구간 추천",
  description: "제작 의도(Editing Brief)를 입력하면 Gemini가 여러 영상에서 최적의 IN/OUT 편집 구간을 추천합니다.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ko" className={`${inter.variable} ${notoKr.variable} ${jetbrains.variable}`}>
      <body>{children}</body>
    </html>
  );
}
