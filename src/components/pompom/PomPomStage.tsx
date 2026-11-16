"use client";

/**
 * PomPomStage — 网页左侧「帕姆立绘栏」的 3D 客户端组件。
 *
 * - 用 three.js 原生 API（FBXLoader）加载 public/model/PomPom.fbx；
 * - 待机动效：模型自带动画（AnimationMixer）优先，否则程序化浮动/呼吸/眨眼；
 * - WebGL 不可用或模型加载失败时降级为静态海报 public/model/pompom-poster.png；
 * - 性能：像素比 ≤1.5、low-power、约 40fps、离屏/切后台暂停、卸载 dispose。
 *
 * 3D 细节都放在 ./pompomCore.js（也供 scripts/record-pompom.mjs 预览页复用），
 * 这个文件只负责 React 生命周期与降级 UI。
 */

import { useEffect, useRef, useState } from "react";

import { createPomPomStage, POMPOM_MODEL_URL, POMPOM_TEXTURE_URLS } from "./pompomCore";

type StageHandle = ReturnType<typeof createPomPomStage>;
type StageStatus = "loading" | "ready" | "fallback";

export interface PomPomStageProps {
  /** 预留换装位（帽子/礼服/围裙），当前忽略，仅透传到 data 属性。 */
  outfit?: string;
  className?: string;
  /** 3D 首帧渲染完成（静态海报降级时不会触发）。 */
  onReady?: () => void;
  /** 失败时展示的静态海报，默认 /model/pompom-poster.png。 */
  posterSrc?: string;
  /** 覆盖默认模型地址（测试用）。 */
  modelUrl?: string;
  /** 覆盖默认贴图地址（测试用）。 */
  textureUrls?: { body?: string; face?: string };
  /** 无障碍标签。 */
  ariaLabel?: string;
}

const DEFAULT_POSTER = "/model/pompom-poster.png";

export default function PomPomStage({
  outfit,
  className,
  onReady,
  posterSrc = DEFAULT_POSTER,
  modelUrl = POMPOM_MODEL_URL,
  textureUrls,
  ariaLabel = "帕姆列车长 3D 立绘",
}: PomPomStageProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const handleRef = useRef<StageHandle | null>(null);
  const onReadyRef = useRef(onReady);
  const [status, setStatus] = useState<StageStatus>("loading");
  const [progress, setProgress] = useState(0);
  const [posterFailed, setPosterFailed] = useState(false);

  onReadyRef.current = onReady;

  const textureBody = textureUrls?.body ?? POMPOM_TEXTURE_URLS.body;
  const textureFace = textureUrls?.face ?? POMPOM_TEXTURE_URLS.face;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let cancelled = false;
    const handle = createPomPomStage({
      container,
      modelUrl,
      textureUrls: { body: textureBody, face: textureFace },
      reducedMotion:
        typeof window !== "undefined" && window.matchMedia
          ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
          : false,
      onReady: () => {
        if (cancelled) return;
        setStatus("ready");
        onReadyRef.current?.();
      },
      onError: () => {
        if (cancelled) return;
        setStatus("fallback");
      },
      onProgress: (value: number) => {
        if (cancelled) return;
        setProgress(value);
      },
    });
    handleRef.current = handle;
    // createPomPomStage 是同步返回句柄的；同步失败（如无容器/非浏览器）时直接降级
    if (handle.error) setStatus("fallback");

    return () => {
      cancelled = true;
      handleRef.current = null;
      handle.dispose();
    };
  }, [modelUrl, textureBody, textureFace]);

  const isReady = status === "ready";

  return (
    <div
      className={`relative overflow-hidden ${className ?? ""}`}
      style={{
        background:
          "radial-gradient(120% 82% at 50% 0%, #1c2557 0%, #0d1330 55%, #070b1c 100%)",
      }}
      role="img"
      aria-label={ariaLabel}
      aria-busy={status === "loading"}
      data-outfit={outfit ?? "default"}
      data-status={status}
    >
      {/* 静态海报：加载中/降级时可见，3D 就绪后淡出（同时留作 WebGL 失败的兜底）。
          海报 404 时退化为纯 CSS 占位，绝不出现破图图标。 */}
      {posterFailed ? (
        <div
          aria-hidden="true"
          className={`pointer-events-none absolute inset-0 flex items-center justify-center transition-opacity duration-500 ${
            isReady ? "opacity-0" : "opacity-100"
          }`}
        >
          <div className="relative flex aspect-square w-[46%] max-w-44 items-center justify-center rounded-full border border-gold/40 bg-[radial-gradient(circle_at_50%_38%,rgba(217,180,106,0.20),rgba(11,16,38,0.65)_70%)] shadow-[inset_0_0_40px_rgba(217,180,106,0.18)]">
            <div className="absolute inset-[12%] rounded-full border border-gold/20" />
            <span className="font-[family-name:var(--font-display)] text-[clamp(14px,4vw,22px)] tracking-[0.32em] text-gold/90">
              帕姆
            </span>
          </div>
        </div>
      ) : (
        /* eslint-disable-next-line @next/next/no-img-element -- 海报是 public 静态资源，无需 next/image 优化 */
        <img
          src={posterSrc}
          alt=""
          aria-hidden="true"
          draggable={false}
          onError={() => setPosterFailed(true)}
          className={`pointer-events-none absolute inset-2 h-[calc(100%-1rem)] w-[calc(100%-1rem)] select-none object-contain object-center transition-opacity duration-500 ${
            isReady ? "opacity-0" : "opacity-100"
          }`}
        />
      )}

      {/* three.js 画布挂载点 */}
      <div
        ref={containerRef}
        aria-hidden="true"
        className={`absolute inset-0 transition-opacity duration-500 ${isReady ? "opacity-100" : "opacity-0"}`}
      />

      {status === "loading" && (
        <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center">
          <span className="rounded-full border border-gold/40 bg-night-900/70 px-2.5 py-1 font-body text-[10px] tracking-[0.18em] text-gold/90 backdrop-blur-sm">
            帕姆立绘加载中{progress > 0 ? ` ${Math.round(progress * 100)}%` : "…"}
          </span>
        </div>
      )}

      {status === "fallback" && (
        <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center">
          <span className="rounded-full border border-gold/35 bg-night-900/70 px-2.5 py-1 font-body text-[10px] tracking-[0.18em] text-gold/80 backdrop-blur-sm">
            静态立绘模式
          </span>
        </div>
      )}
    </div>
  );
}
