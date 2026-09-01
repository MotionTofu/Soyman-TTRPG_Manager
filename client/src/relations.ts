import type { RelationEntityType, RelationTone } from "./types";

// Пастельные тона — та же hue, но s<45 l~80, чтобы не рвать бюджет акцента (15%)
// и читаться на paper/paper-2 в noir/peace/aberrant.
export const RELATION_TONES: { key: RelationTone; label: string; color: string }[] = [
  { key: "positive", label: "Позитивное", color: "#b7d6bd" },
  { key: "negative", label: "Негативное", color: "#dfb4b7" },
  { key: "neutral", label: "Нейтральное", color: "#d0d0d4" },
  { key: "mixed", label: "Смешанное", color: "#cfc2df" },
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
