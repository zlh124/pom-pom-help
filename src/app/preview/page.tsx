"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";

const PomPomStage = dynamic(() => import("@/components/pompom/PomPomStage"), {
  ssr: false,
  loading: () => <div className="flex h-full w-full items-center justify-center text-xs text-[#8a8275]">载入帕姆中…</div>,
});

type Bg = "dark" | "light" | "transparent";

const BG_STYLE: Record<Bg, React.CSSProperties> = {
  dark: { background: "#0a0e24" },
  light: { background: "linear-gradient(180deg,#f4f9ff 0%,#e2ecfd 50%,#cfdff7 100%)" },
  transparent: { background: "transparent" },
};

/** 3D 立绘调试/海报生成页：/preview?bg=light|transparent&w=480&h=640 */
export default function PreviewPage() {
  const [bg, setBg] = useState<Bg>("dark");
  const [size, setSize] = useState({ w: 480, h: 640 });

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const requested = params.get("bg");
    if (requested === "light" || requested === "transparent" || requested === "dark") setBg(requested);
    const w = Number(params.get("w"));
    const h = Number(params.get("h"));
    if (w > 0 && h > 0) setSize({ w, h });
  }, []);

  useEffect(() => {
    document.title = `PomPomStage preview (${bg})`;
    if (bg === "transparent") {
      const prev = document.body.getAttribute("style");
      document.body.setAttribute("data-preview-transparent", "1");
      document.body.style.background = "transparent";
      const style = document.createElement("style");
      style.id = "preview-transparent";
      style.textContent = "body::before,body::after{display:none!important}html{background:transparent!important}";
      document.head.appendChild(style);
      return () => {
        style.remove();
        document.body.removeAttribute("data-preview-transparent");
        if (prev) document.body.setAttribute("style", prev);
        else document.body.removeAttribute("style");
      };
    }
    document.body.removeAttribute("data-preview-transparent");
    const style = document.getElementById("preview-transparent");
    if (style) style.remove();
    return undefined;
  }, [bg]);

  return (
    <main className="flex min-h-dvh items-center justify-center" style={BG_STYLE[bg]}>
      <div id="pompom-preview" style={{ width: size.w, height: size.h, ...BG_STYLE[bg] }}>
        <PomPomStage className="h-full w-full" />
      </div>
    </main>
  );
}
