"use client";

/** 全局错误兜底：任何客户端异常都不再显示 Next 默认错误页 */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="relative z-10 flex min-h-dvh items-center justify-center px-4">
      <div className="w-full max-w-[420px] overflow-hidden rounded-2xl border border-white/60 bg-[#fbf6ea] shadow-[0_18px_50px_rgba(4,8,24,0.45)]">
        <div className="border-b border-[#efe2c4] bg-gradient-to-r from-[#b5343f] to-[#8f2730] px-4 py-2.5 text-center text-[12px] tracking-[0.24em] text-[#fbe9cf]">
          帕姆帮帮 · 出故障了
        </div>
        <div className="px-5 py-6 text-center text-[#5a4a30]">
          <p className="text-[14px]">呜……列车长这边的通讯器出了点小故障帕。</p>
          <p className="mt-1.5 text-[11.5px] text-[#9a8a70]">{error.message?.slice(0, 120) || "未知错误"}</p>
          <button
            type="button"
            onClick={() => reset()}
            className="mt-4 rounded-xl bg-gradient-to-b from-[#efd495] to-[#d3a94f] px-5 py-2 text-[13px] font-semibold text-[#4b3306] shadow-sm transition-all hover:brightness-105"
          >
            重试一下
          </button>
          <p className="mt-3 text-[10.5px] text-[#b3a58b]">
            如果一直失败，可以<a className="underline underline-offset-2" href="/">回到首页</a>重新开始
          </p>
        </div>
      </div>
    </main>
  );
}
