import type { CompendiumEntry, Statblock } from "../../types";
import { write } from "../../data/hooks";
import { compendiumAffects } from "../../data/compendiumEntries";
import { statblockAffects } from "../../data/statblocks";
import type { Affect } from "../../data/entities";
import { ROLE_ORDER, toEntryData, toStatblockContent, type LitmChallengeProfileData } from "./litmChallenge";

/** Что задевает сохранение вызова: запись, её статблоки и каталог раздела. */
export function litmChallengeAffects(entry: Pick<CompendiumEntry, "id" | "system_id">): Affect[] {
  return [...compendiumAffects(entry), ...statblockAffects("compendium_entry", entry.id), { path: "/statblocks?owner_type=compendium_entry" }];
}

/** Запись + статблок одним сохранением: имя и место — в записи (по ним строит
 *  каталог), профиль целиком — в статблоке `litm_challenge`. */
export async function saveLitmChallenge(entry: CompendiumEntry, statblock: Statblock | undefined, p: LitmChallengeProfileData): Promise<void> {
  let prev: Record<string, unknown> = {};
  try {
    prev = statblock?.content ? JSON.parse(statblock.content) : {};
  } catch {
    prev = {};
  }
  await write.put(`/systems/entries/${entry.id}`, {
    name: p.title.trim() || entry.name,
    name_original: p.titleEn.trim(),
    description: p.description,
    data: toEntryData(p, entry.data ?? {}),
  });
  const content = JSON.stringify(toStatblockContent({ ...p, title: p.title.trim() || entry.name }, prev));
  if (statblock) await write.put(`/statblocks/${statblock.id}`, { content });
  else await write.post("/statblocks", { owner_type: "compendium_entry", owner_id: entry.id, kind: "full", format: "litm_challenge", content });
}

/** Пустые строки форма не сохраняет: последствие из пустой строки textarea — шум. */
export function cleanProfile(p: LitmChallengeProfileData): LitmChallengeProfileData {
  return {
    ...p,
    roles: ROLE_ORDER.filter((r) => p.roles.includes(r)).concat(p.roles.filter((r) => !ROLE_ORDER.includes(r))),
    limitList: p.limitList.filter((l) => l.name.trim()).map((l) => ({ ...l, name: l.name.trim(), max: l.max.trim() || "-", note: l.arrow ? l.note?.trim() ?? "" : "" })),
    tagList: p.tagList.filter((t) => t.text.trim()).map((t) => ({ ...t, text: t.text.trim(), group: t.group?.trim() ?? "" })),
    mightList: p.mightList.filter((m) => m.name.trim()).map((m) => ({ ...m, name: m.name.trim(), vulnerability: m.vulnerability?.trim() ?? "" })),
    threatList: p.threatList.filter((t) => t.name.trim() || t.lead.trim() || t.consequences.some((c) => c.trim()))
      .map((t) => ({ ...t, name: t.name.trim(), lead: t.lead.trim(), consequences: t.consequences.map((c) => c.trim()).filter(Boolean) })),
    specialList: p.specialList.filter((s) => s.name.trim() || s.text.trim()).map((s) => ({ ...s, name: s.name.trim(), text: s.text.trim() })),
  };
}
