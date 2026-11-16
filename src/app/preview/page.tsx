"use client";

import dynamic from "next/dynamic";

const PomPomStage = dynamic(() => import("@/components/pompom/PomPomStage"), {
  ssr: false,
  loading: () => <div className="flex h-full w-full items-center justify-center text-xs text-gold/50">载入帕姆中…</div>,
});

/** 仅用于截图/调试 3D 立绘（不影响主页面） */
export default function PreviewPage() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-[#0a0e24]">
      <div style={{ width: 480, height: 640, background: "#0a0e24" }}>
        <PomPomStage className="h-full w-full" />
      </div>
    </main>
  );
}
