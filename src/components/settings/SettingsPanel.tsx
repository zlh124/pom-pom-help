"use client";

import { useState } from "react";

type Summary = {
  gameVersion: string;
  dataVersion: string | null;
  syncedAt: string | null;
  characters: number;
  lightCones: number;
  relicSets: number;
  items: number;
  aliases: number;
  wikiChars: number;
  chunks: number;
  model: string;
  baseUrl: string;
  thinking: string;
  embedding: string;
};

export default function SettingsPanel({ summary }: { summary: Summary }) {
  const [cleared, setCleared] = useState(false);

  const clearLocal = () => {
    try {
      sessionStorage.clear();
      localStorage.clear();
      setCleared(true);
    } catch {
      setCleared(false);
    }
  };

  return (
    <div className="space-y-4">
      <section className="gold-frame rounded-2xl bg-[#101632]/80 p-4">
        <h2 className="mb-3 text-[13px] font-semibold tracking-wide text-gold">数据状态</h2>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-[12px]">
          <Item label="游戏数据版本" value={summary.dataVersion ?? "未同步"} />
          <Item label="配置版本" value={summary.gameVersion} />
          <Item label="角色" value={String(summary.characters)} />
          <Item label="光锥" value={String(summary.lightCones)} />
          <Item label="遗器套" value={String(summary.relicSets)} />
          <Item label="物品" value={String(summary.items)} />
          <Item label="别名" value={String(summary.aliases)} />
          <Item label="BWIKI 角色页" value={String(summary.wikiChars)} />
          <Item label="语料分块" value={String(summary.chunks)} />
          <Item label="上次同步" value={summary.syncedAt ? new Date(summary.syncedAt).toLocaleString("zh-CN") : "—"} />
        </dl>
      </section>

      <section className="gold-frame rounded-2xl bg-[#101632]/80 p-4">
        <h2 className="mb-3 text-[13px] font-semibold tracking-wide text-gold">模型</h2>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-[12px]">
          <Item label="模型" value={summary.model} />
          <Item label="接口" value={summary.baseUrl} />
          <Item label="思考模式" value={summary.thinking} />
          <Item label="向量检索" value={summary.embedding} />
        </dl>
        <p className="mt-3 text-[11px] leading-relaxed text-white/35">
          模型与密钥通过服务端环境变量配置（.env.local），不会暴露到浏览器。
        </p>
      </section>

      <section className="gold-frame rounded-2xl bg-[#101632]/80 p-4">
        <h2 className="mb-2 text-[13px] font-semibold tracking-wide text-gold">本地数据</h2>
        <p className="text-[12px] leading-relaxed text-white/45">
          对话与答题进度只保存在浏览器本地 / 本机 SQLite，不上传任何服务器。清除后不可恢复。
        </p>
        <button
          type="button"
          onClick={clearLocal}
          className="mt-3 rounded-lg border border-crimson/40 px-3 py-1.5 text-[12px] text-crimson/85 transition-colors hover:bg-crimson/10"
        >
          {cleared ? "已清除本地缓存" : "清除本地对话 / 答题进度"}
        </button>
      </section>

      <section className="rounded-2xl border border-white/10 p-4">
        <h2 className="mb-2 text-[13px] font-semibold tracking-wide text-gold/80">关于</h2>
        <p className="text-[11px] leading-relaxed text-white/35">
          「帕姆帮帮」是《崩坏：星穹铁道》4.2 版本限时上线的游戏内 AI 助手（已于 2026-05-25 暂时下线优化）。本项目是
          非官方粉丝复刻，仅用于学习与个人研究，与米哈游无关。游戏数据来源 StarRailRes（AGPL-3.0），攻略语料来自
          BWIKI 与社区贡献（CC BY-SA 4.0），帕姆 3D 模型版权归原作者所有。
        </p>
        <p className="mt-2 text-[11px] text-white/25">
          <a className="underline decoration-white/20 underline-offset-2 hover:text-gold" href="/">
            ← 回到列车
          </a>
        </p>
      </section>
    </div>
  );
}

function Item({ label, value }: { label: string; value: string }) {
  return (
    <div className="contents">
      <dt className="text-white/35">{label}</dt>
      <dd className="truncate text-white/75">{value}</dd>
    </div>
  );
}
