import type { DndAbilityScores } from "../../types";
import { ABILITY_NAME_TO_KEY } from "./AbilityScores";

// Мультикласс (гриллинг 2026-09-25, Q15–Q17): второй и следующие классы дают
// урезанные владения — data.multiclass_profs записи класса (миграция
// class_multiclass_profs_v1). Нет поля — справочник не размечен: владений не
// выдаём, визард говорит «добери на листе».

export interface MulticlassProfs {
  armor: { id: number | null; name: string }[];
  tools: { id: number | null; name: string }[];
  /** Навыков на выбор: из списка класса, а при skillAny — любых (Бард). */
  skillCount: number;
  skillAny: boolean;
  toolChoice: { count: number; group: string } | null;
}

const refs = (v: unknown) =>
  (Array.isArray(v) ? v : [])
    .filter((r): r is { id?: unknown; name: string } => !!r && typeof r === "object" && typeof (r as { name?: unknown }).name === "string")
    .map((r) => ({ id: typeof r.id === "number" ? r.id : null, name: r.name }));

export function multiclassProfs(data: Record<string, unknown> | undefined): MulticlassProfs | null {
  const raw = data?.multiclass_profs;
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const tc = r.tool_choice as { count?: unknown; group?: unknown } | undefined;
  return {
    armor: refs(r.armor),
    tools: refs(r.tools),
    skillCount: typeof r.skill_count === "number" ? r.skill_count : 0,
    skillAny: r.skill_any === true,
    toolChoice: tc && typeof tc.count === "number" && typeof tc.group === "string" ? { count: tc.count, group: tc.group } : null,
  };
}

/** Требование 13+ («Сила 13 или Ловкость 13», «Ловкость 13 и Мудрость 13»)
 *  не выполнено. Непонятный текст — не «не выполнено»: предупреждение, не гейт (Q16). */
export function multiclassPrereqUnmet(text: string, abilities: DndAbilityScores): boolean {
  const alts = text.trim().split(/\s+или\s+/i).filter(Boolean);
  if (alts.length === 0) return false;
  let parsed = true;
  const met = alts.some((alt) =>
    alt.split(/\s+и\s+/i).every((part) => {
      const m = /^(\S+)\s+(\d+)$/.exec(part.trim());
      const key = m ? ABILITY_NAME_TO_KEY[m[1]] : undefined;
      if (!m || !key) {
        parsed = false;
        return true;
      }
      return abilities[key] >= Number(m[2]);
    })
  );
  return parsed && !met;
}
