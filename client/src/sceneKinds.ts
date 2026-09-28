import type { NodeRole, NodeType, SceneKind, SceneStatus } from "./types";

// Узел по Александрийцу (гриллинг 2026-09-28, Q7): тип — что это в мире,
// роль — как узел считает правило трёх улик. Заменяют прежний «вид» сцены
// (SCENE_KINDS ниже остаётся для импорта и старых данных).
export const NODE_TYPES: { key: NodeType; label: string }[] = [
  { key: "place", label: "Место" },
  { key: "person", label: "Персона" },
  { key: "organization", label: "Организация" },
  { key: "event", label: "Событие" },
  { key: "activity", label: "Действие" },
];
export const NODE_ROLES: { key: NodeRole; label: string }[] = [
  { key: "normal", label: "Обычный" },
  { key: "start", label: "Старт" },
  { key: "dead_end", label: "Тупик" },
  { key: "finale", label: "Финал" },
  { key: "proactive", label: "Проактивный" },
];
export const NODE_TYPE_LABELS: Record<string, string> = Object.fromEntries(NODE_TYPES.map((t) => [t.key, t.label]));
export const NODE_ROLE_LABELS: Record<string, string> = Object.fromEntries(NODE_ROLES.map((r) => [r.key, r.label]));

/** «Персона · Проактивный», «Финал», «Узел» — подпись узла в списках. */
export function nodeLabel(s: { node_type?: string | null; node_role?: string | null }): string {
  const parts = [
    s.node_type ? NODE_TYPE_LABELS[s.node_type] : null,
    s.node_role && s.node_role !== "normal" ? NODE_ROLE_LABELS[s.node_role] : null,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : "Узел";
}

export const SCENE_KINDS: { key: SceneKind; label: string }[] = [
  { key: "scene", label: "Сцена" },
  { key: "encounter", label: "Столкновение" },
  { key: "branch", label: "Развилка" },
  { key: "ending", label: "Концовка" },
];

export const SCENE_KIND_LABELS: Record<string, string> = Object.fromEntries(
  SCENE_KINDS.map((k) => [k.key, k.label])
);

// Playthrough progress, tracked per campaign in campaign_scene_state — never
// on the scene row itself, which would spawn a copy-on-write override.
export const SCENE_STATUSES: { key: SceneStatus; label: string }[] = [
  { key: "pending", label: "Не начата" },
  { key: "done", label: "Пройдена" },
  { key: "skipped", label: "Пропущена" },
];

// "3 сцены" / "1 сцена" / "5 сцен" — used by the adventures list and by a
// collapsed chapter's summary line.
export function sceneWord(n: number): string {
  return plural(n, "сцена", "сцены", "сцен");
}

// "5 глав" / "1 глава" / "3 главы" — рядом со счётчиком сцен в списке приключений.
export function chapterWord(n: number): string {
  return plural(n, "глава", "главы", "глав");
}

// «1 запись» / «2 записи» / «5 записей» — на экране сверки, у счётчика того,
// что импорт заведёт в компендиуме системы.
export function entryWord(n: number): string {
  return plural(n, "запись", "записи", "записей");
}

export function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}
