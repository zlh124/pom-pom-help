"use client";

import type { Card, LightConeCard, MaterialCard, RelicCard, Source, TeamCard } from "@/lib/cards";

const CONFIDENCE_LABEL: Record<string, { text: string; cls: string }> = {
  curated: { text: "人工校对", cls: "border-[#ddc79c] bg-[#f8f1e0] text-[#96763a]" },
  community: { text: "社区语料", cls: "border-[#d2d9e4] bg-[#f2f5fa] text-[#5d739a]" },
  derived: { text: "数据推导", cls: "border-[#d9d4ca] bg-[#f5f3ee] text-[#89816f]" },
};

function ConfidenceBadge({ value }: { value?: string }) {
  if (!value) return null;
  const meta = CONFIDENCE_LABEL[value] ?? { text: value, cls: "border-[#d9d4ca] bg-[#f5f3ee] text-[#89816f]" };
  return <span className={`rounded-full border px-2 py-0.5 text-[10.5px] ${meta.cls}`}>{meta.text}</span>;
}

export function ToolCard({
  title,
  badge,
  children,
  sources,
  footer,
}: {
  title: string;
  badge?: React.ReactNode;
  children: React.ReactNode;
  sources?: Source[];
  footer?: React.ReactNode;
}) {
  return (
    <div className="animate-fade-up mt-2.5 overflow-hidden rounded-2xl border border-[#ddd6c8] bg-[#f2f0eb] shadow-[0_4px_16px_rgba(30,30,60,0.06)]">
      <div className="flex items-center justify-between gap-3 border-b border-[#e4dfd4] px-3.5 py-2.5">
        <h3 className="text-[12.5px] font-semibold tracking-wide text-[#3f3a34]">{title}</h3>
        <div className="flex items-center gap-2">{badge}</div>
      </div>
      <div className="px-3.5 py-3 text-[12.5px] leading-relaxed text-[#4a453d]">{children}</div>
      {footer ? <div className="border-t border-[#e4dfd4] px-3.5 py-2 text-[10.5px] text-[#948c7f]">{footer}</div> : null}
      {sources && sources.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5 border-t border-[#e4dfd4] px-3.5 py-2 text-[10.5px] text-[#948c7f]">
          <span>出处</span>
          {sources.slice(0, 3).map((s, i) => (
            <a
              key={`${s.url ?? s.label}-${i}`}
              href={s.url}
              target="_blank"
              rel="noreferrer noopener"
              className="max-w-[220px] truncate rounded border border-[#ded7ca] bg-[#faf8f3] px-1.5 py-0.5 text-[#8a8275] transition-colors hover:border-[#d9b46a] hover:text-[#a2813c]"
            >
              {s.label}
            </a>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function RelicView({ card }: { card: RelicCard }) {
  return (
    <ToolCard
      title={card.title}
      badge={
        <>
          {card.rating ? <span className="rounded-full border border-[#dcc59a] bg-[#fbf5e6] px-2 py-0.5 text-[10.5px] text-[#a2813c]">评级 {card.rating}</span> : null}
          <ConfidenceBadge value={card.confidence} />
        </>
      }
      sources={card.sources}
    >
      <div className="flex flex-wrap gap-1.5">
        {card.sets.map((s) => (
          <span
            key={s.name}
            className="rounded-lg border border-[#bcdcd4] bg-[#e6f2ee] px-2.5 py-1 text-[12px] text-[#2b6f63]"
            title={s.note}
          >
            {s.name}
            <span className="ml-1 text-[#5d9288]">×{s.pieces}</span>
          </span>
        ))}
        {!card.sets.length ? <span className="text-[#948c7f]">暂无套装数据</span> : null}
      </div>
      {card.mainStats.length > 0 ? (
        <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-[12px]">
          {card.mainStats.map((m) => (
            <div key={m.slot} className="contents">
              <dt className="text-[#948c7f]">{m.slot}</dt>
              <dd className="text-[#423d35]">{m.stats.join(" / ")}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {card.subStats.length > 0 ? (
        <p className="mt-3 text-[12px] text-[#5b554b]">
          <span className="text-[#948c7f]">副词条优先级：</span>
          {card.subStats.join(" › ")}
        </p>
      ) : null}
    </ToolCard>
  );
}

function LightConeView({ card }: { card: LightConeCard }) {
  return (
    <ToolCard title={card.title} badge={<ConfidenceBadge value={card.confidence} />} sources={card.sources}>
      <ul className="space-y-2">
        {card.items.map((item) => (
          <li key={item.name} className="flex items-center gap-2.5">
            <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded bg-gradient-to-b from-[#f4dfa9] to-[#d9b46a] text-[11px] font-bold text-[#4d3708] shadow-sm">
              {item.rank}
            </span>
            <span className="text-[#423d35]">{item.name}</span>
            {item.obtain ? <span className="text-[10.5px] text-[#948c7f]">{item.obtain}</span> : null}
          </li>
        ))}
      </ul>
    </ToolCard>
  );
}

function TeamView({ card }: { card: TeamCard }) {
  return (
    <ToolCard title={card.title} badge={<ConfidenceBadge value={card.confidence} />} sources={card.sources}>
      <div className="flex flex-wrap gap-1.5">
        {card.slots.map((slot) => (
          <div
            key={`${slot.name}-${slot.role ?? ""}`}
            className="min-w-[82px] rounded-xl border border-[#e0d6be] bg-[#f6f1e4] px-2.5 py-2"
          >
            <div className="text-[12.5px] text-[#423d35]">{slot.name}</div>
            {slot.role ? <div className="mt-0.5 text-[10.5px] text-[#a2813c]">{slot.role}</div> : null}
          </div>
        ))}
      </div>
      {card.note ? <p className="mt-2.5 text-[11.5px] leading-relaxed text-[#6e675b]">{card.note}</p> : null}
    </ToolCard>
  );
}

function MaterialView({ card }: { card: MaterialCard }) {
  return (
    <ToolCard
      title={card.title}
      badge={<ConfidenceBadge value={card.confidence} />}
      sources={card.sources}
      footer="材料数量按行迹满级聚合，仅供参考"
    >
      <div className="space-y-3">
        {card.groups.map((group) => (
          <div key={group.label}>
            <div className="mb-1.5 text-[11.5px] font-medium text-[#a2813c]">{group.label}</div>
            <div className="flex flex-wrap gap-1.5">
              {group.items.map((item) => (
                <span
                  key={item.name}
                  className="rounded-lg border border-[#ddd6c8] bg-[#faf8f3] px-2 py-1 text-[11.5px] text-[#4a453d]"
                  title={item.from.join("、")}
                >
                  {item.name}
                  {item.num ? <span className="ml-1 text-[#948c7f]">×{item.num}</span> : null}
                </span>
              ))}
            </div>
            <div className="mt-1 text-[10.5px] text-[#a29a8c]">
              {Array.from(new Set(group.items.flatMap((i) => i.from))).slice(0, 3).join(" · ") || "获取途径以游戏内为准"}
            </div>
          </div>
        ))}
      </div>
    </ToolCard>
  );
}

export function CardRenderer({ card }: { card: Card }) {
  switch (card.kind) {
    case "relic":
      return <RelicView card={card} />;
    case "lightcone":
      return <LightConeView card={card} />;
    case "team":
      return <TeamView card={card} />;
    case "material":
      return <MaterialView card={card} />;
    default:
      return null;
  }
}
