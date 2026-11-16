import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "帕姆帮帮（非官方复刻）",
  description:
    "《崩坏：星穹铁道》帕姆帮帮网页复刻 —— 帕姆列车长的 AI 助手。非官方粉丝项目，与米哈游无关。",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#070b1c",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body className="starfield min-h-dvh">{children}</body>
    </html>
  );
}
