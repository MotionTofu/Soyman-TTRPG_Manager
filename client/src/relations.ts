import type { RelationEntityType, RelationTone } from "./types";

export const RELATION_TONES: { key: RelationTone; label: string; color: string }[] = [
  { key: "positive", label: "Позитивное", color: "#4c9a5b" },
  { key: "negative", label: "Негативное", color: "#b0454b" },
  { key: "neutral", label: "Нейтральное", color: "#8a8a95" },
  { key: "mixed", label: "Смешанное", color: "#8968b0" },
];

export const RELATION_TONE_LABELS: Record<RelationTone, string> = Object.fromEntries(
  RELATION_TONES.map((t) => [t.key, t.label])
) as Record<RelationTone, string>;

export const RELATION_TONE_COLORS: Record<RelationTone, string> = Object.fromEntries(
  RELATION_TONES.map((t) => [t.key, t.color])
) as Record<RelationTone, string>;

// The three entity kinds that can carry a typed relation today (per the
// user's original ask: "личности и фракции" — beings, player characters,
// and factions/communities).
export const RELATION_ENTITY_TYPES: { key: RelationEntityType; label: string }[] = [
  { key: "being", label: "Существо" },
  { key: "character", label: "Персонаж" },
  { key: "community", label: "Фракция" },
];
