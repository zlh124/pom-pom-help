"use client";

import type { Card, LightConeCard, MaterialCard, RelicCard, Source, TeamCard } from "@/lib/cards";

const CONFIDENCE_LABEL: Record<string, string> = {
  curated: "人工校对",
  community: "社区语料",
  derived: "数据推导",
};

function ConfidenceBadge({ value }: { value?: string }) {
  if (!value) return null;
  return (
    <span className="rounded-full border border-gold/40 bg-gold/10 px-2 py-0.5 text-[11px] text-gold">
      {CONFIDENCE_LABEL[value] ?? value}
    </span>
  );
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
    <div className="animate-fade-up gold-frame mt-3 overflow-hidden rounded-[var(--radius)] bg-[#101632]/90">
      <div className="flex items-center justify-between gap-3 border-b border-gold/25 px-4 py-2.5">
        <h3 className="text-[13px] font-semibold tracking-wide text-gold">{title}</h3>
        <div className="flex items-center gap-2">{badge}</div>
      </div>
      <div className="px-4 py-3 text-[13px] leading-relaxed text-[#e6e1f2]">{children}</div>
      {footer ? <div className="border-t border-white/5 px-4 py-2 text-[11px] text-white/45">{footer}</div> : null}
      {sources && sources.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2 border-t border-white/5 px-4 py-2 text-[11px] text-white/45">
          <span>出处</span>
          {sources.slice(0, 3).map((s, i) => (
            <a
              key={`${s.url ?? s.label}-${i}`}
              href={s.url}
              target="_blank"
              rel="noreferrer noopener"
              className="rounded border border-white/10 px-1.5 py-0.5 text-white/60 hover:border-gold/40 hover:text-gold"
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
    <ToolCard title={card.title} badge={<ConfidenceBadge value={card.confidence} />} sources={card.sources}>
      <div className="flex flex-wrap gap-2">
        {card.sets.map((s) => (
          <span
            key={s.name}
            className="rounded-lg border border-teal/40 bg-teal/10 px-2.5 py-1 text-[12px] text-teal"
            title={s.note}
          >
            {s.name}
            <span className="ml-1 text-white/50">×{s.pieces}</span>
          </span>
        ))}
        {!card.sets.length ? <span className="text-white/40">暂无套装数据</span> : null}
      </div>
      {card.mainStats.length > 0 ? (
        <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-[12px]">
          {card.mainStats.map((m) => (
            <div key={m.slot} className="contents">
              <dt className="text-white/45">{m.slot}</dt>
              <dd className="text-white/85">{m.stats.join(" / ")}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {card.subStats.length > 0 ? (
        <p className="mt-3 text-[12px] text-white/60">
          <span className="text-white/40">副词条优先级：</span>
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
            <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded bg-gold/15 text-[11px] font-bold text-gold">
              {item.rank}
            </span>
            <span className="text-white/90">{item.name}</span>
            {item.obtain ? <span className="text-[11px] text-white/40">{item.obtain}</span> : null}
          </li>
        ))}
      </ul>
    </ToolCard>
  );
}

function TeamView({ card }: { card: TeamCard }) {
  return (
    <ToolCard title={card.title} badge={<ConfidenceBadge value={card.confidence} />} sources={card.sources}>
      <div className="flex flex-wrap gap-2">
        {card.slots.map((slot) => (
          <div
            key={`${slot.name}-${slot.role ?? ""}`}
            className="min-w-[86px] rounded-lg border border-gold/25 bg-white/[0.03] px-2.5 py-2"
          >
            <div className="text-[13px] text-white/90">{slot.name}</div>
            {slot.role ? <div className="mt-0.5 text-[11px] text-gold/80">{slot.role}</div> : null}
          </div>
        ))}
      </div>
      {card.note ? <p className="mt-2.5 text-[12px] leading-relaxed text-white/55">{card.note}</p> : null}
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
            <div className="mb-1.5 text-[12px] text-gold/80">{group.label}</div>
            <div className="flex flex-wrap gap-1.5">
              {group.items.map((item) => (
                <span
                  key={item.name}
                  className="rounded border border-white/10 bg-white/[0.04] px-2 py-1 text-[12px] text-white/80"
                  title={item.from.join("、")}
                >
                  {item.name}
                  {item.num ? <span className="ml-1 text-white/40">×{item.num}</span> : null}
                </span>
              ))}
            </div>
            <div className="mt-1 text-[11px] text-white/35">
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
