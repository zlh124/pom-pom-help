import { z } from "zod";

/** 卡片 = 服务端产出的结构化数据，前端按 kind 渲染（生成式 UI） */

export const sourceSchema = z.object({
  label: z.string(),
  url: z.string().url().optional(),
});
export type Source = z.infer<typeof sourceSchema>;

export const relicCardSchema = z.object({
  kind: z.literal("relic"),
  character: z.string(),
  title: z.string().default("遗器推荐"),
  sets: z
    .array(
      z.object({
        name: z.string(),
        pieces: z.number().int().min(2).max(4),
        note: z.string().optional(),
      }),
    )
    .default([]),
  mainStats: z
    .array(
      z.object({
        slot: z.string(),
        stats: z.array(z.string()),
      }),
    )
    .default([]),
  subStats: z.array(z.string()).default([]),
  rating: z.string().optional(),
  confidence: z.enum(["curated", "community", "derived"]).default("community"),
  sources: z.array(sourceSchema).default([]),
});
export type RelicCard = z.infer<typeof relicCardSchema>;

export const lightConeCardSchema = z.object({
  kind: z.literal("lightcone"),
  character: z.string(),
  title: z.string().default("光锥推荐"),
  items: z
    .array(
      z.object({
        name: z.string(),
        rank: z.string().default("A"),
        obtain: z.string().optional(),
      }),
    )
    .default([]),
  note: z.string().optional(),
  confidence: z.enum(["curated", "community", "derived"]).default("community"),
  sources: z.array(sourceSchema).default([]),
});
export type LightConeCard = z.infer<typeof lightConeCardSchema>;

export const teamCardSchema = z.object({
  kind: z.literal("team"),
  title: z.string().default("配队推荐"),
  archetype: z.string(),
  slots: z
    .array(
      z.object({
        name: z.string(),
        role: z.string().optional(),
        isFlex: z.boolean().optional(),
      }),
    )
    .default([]),
  note: z.string().optional(),
  confidence: z.enum(["curated", "community", "derived"]).default("community"),
  sources: z.array(sourceSchema).default([]),
});
export type TeamCard = z.infer<typeof teamCardSchema>;

export const materialCardSchema = z.object({
  kind: z.literal("material"),
  character: z.string(),
  title: z.string().default("材料清单"),
  groups: z
    .array(
      z.object({
        label: z.string(),
        items: z.array(
          z.object({
            name: z.string(),
            num: z.number().optional(),
            from: z.array(z.string()).default([]),
          }),
        ),
      }),
    )
    .default([]),
  note: z.string().optional(),
  confidence: z.enum(["curated", "community", "derived"]).default("derived"),
  sources: z.array(sourceSchema).default([]),
});
export type MaterialCard = z.infer<typeof materialCardSchema>;

export const cardSchema = z.discriminatedUnion("kind", [
  relicCardSchema,
  lightConeCardSchema,
  teamCardSchema,
  materialCardSchema,
]);
export type Card = z.infer<typeof cardSchema>;

export function safeCard(input: unknown): Card | null {
  const parsed = cardSchema.safeParse(input);
  return parsed.success ? parsed.data : null;
}
