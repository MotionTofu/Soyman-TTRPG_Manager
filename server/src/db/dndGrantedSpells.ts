import type { Database } from "better-sqlite3";

/**
 * Починка ссылок «Обретаемые заклинания» и перевод их на имя как на ключ.
 *
 * Зачем. Вид и подкласс держат список обретаемых заклинаний в
 * `data.granted_spells` — по `id` записи справочника. В базе владельца **ни
 * одна из 288 ссылок в 38 записях не вела никуда**: id взяты из файла
 * импорта, а импортёр завёл заклинания заново, со своими id. Лист честно
 * просил `/systems/entries/32108`, получал 404, глотал его в `catch {}` и
 * молча не давал ни одного заклинания. Снаружи это выглядело как «подкласс
 * не принёс заклинания», хотя список у подкласса заполнен.
 *
 * Решение — то же, что и у навыков (гриллинг 2026-09-04): ключом становится
 * `name_original`, английское имя. `id` остаётся быстрым путём, но перестаёт
 * быть единственным: как только он не сходится, ссылка сводится по
 * оригиналу. Тогда следующий импорт модуля, меняющий id, ничего не сломает.
 *
 * Имена в списке приехали в виде «Лечащее слово [Healing Word]» — английское
 * имя лежит прямо в них, поэтому все 288 ссылок сводятся без единой потери.
 * Миграция при этом:
 * - чинит `id`, только если он никуда не ведёт;
 * - дописывает `original` каждому пункту (его читает лист, когда id промахнулся);
 * - приводит `name` к тому, как заклинание называется в справочнике, — но
 *   только когда ссылка свелась однозначно.
 */

const MIGRATION_KEY = "dnd_granted_spells_relinked";

interface Pick {
  id: number;
  name: string;
  grantLevel?: number;
  original?: string;
  [k: string]: unknown;
}

/** «Лечащее слово [Healing Word]» → { ru: "Лечащее слово", en: "Healing Word" }. */
function splitName(raw: string): { ru: string; en: string | null } {
  const m = /^(.*?)\s*\[(.+)\]\s*$/.exec(raw ?? "");
  return m ? { ru: m[1].trim(), en: m[2].trim() } : { ru: (raw ?? "").trim(), en: null };
}

function parseData(raw: string): Record<string, unknown> {
  try {
    const v = JSON.parse(raw || "{}");
    return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export function migrateDndGrantedSpells(database: Database): void {
  const done = database.prepare("SELECT value FROM app_settings WHERE key = ?").get(MIGRATION_KEY);
  if (done) return;

  let entriesTouched = 0;
  let relinked = 0;
  let unresolved = 0;

  const run = database.transaction(() => {
    const spells = database
      .prepare("SELECT id, name, name_original FROM compendium_entries WHERE kind = 'spell'")
      .all() as { id: number; name: string; name_original: string | null }[];

    const byOriginal = new Map<string, { id: number; name: string; original: string }>();
    const byName = new Map<string, { id: number; name: string; original: string }>();
    for (const s of spells) {
      const rec = { id: s.id, name: s.name, original: s.name_original ?? "" };
      if (s.name_original) {
        const key = s.name_original.toLowerCase();
        // Одноимённых оригиналов быть не должно; если вдруг есть — не
        // угадываем, а оставляем ссылку неразрешённой.
        if (byOriginal.has(key)) byOriginal.set(key, { ...rec, id: -1 });
        else byOriginal.set(key, rec);
      }
      const nameKey = s.name.toLowerCase();
      if (byName.has(nameKey)) byName.set(nameKey, { ...rec, id: -1 });
      else byName.set(nameKey, rec);
    }

    const alive = new Set(
      (database.prepare("SELECT id FROM compendium_entries").all() as { id: number }[]).map((r) => r.id)
    );

    const rows = database
      .prepare("SELECT id, data FROM compendium_entries WHERE data LIKE '%granted_spells%'")
      .all() as { id: number; data: string }[];
    const update = database.prepare("UPDATE compendium_entries SET data = ? WHERE id = ?");

    for (const row of rows) {
      const data = parseData(row.data);
      const picks = data.granted_spells;
      if (!Array.isArray(picks) || picks.length === 0) continue;

      let changed = false;
      const next = (picks as Pick[]).map((pick) => {
        const { ru, en } = splitName(pick.name);
        const hit =
          (en ? byOriginal.get(en.toLowerCase()) : undefined) ??
          byOriginal.get(ru.toLowerCase()) ??
          byName.get(ru.toLowerCase());

        // Ссылка не свелась однозначно — не трогаем её вовсе. Пустой id
        // лучше подменённого: подменённый молча даст не то заклинание.
        if (!hit || hit.id === -1) {
          if (!alive.has(pick.id)) unresolved++;
          return pick;
        }

        const out: Pick = { ...pick };
        if (!alive.has(pick.id) && pick.id !== hit.id) {
          out.id = hit.id;
          relinked++;
          changed = true;
        }
        if (!out.original && hit.original) {
          out.original = hit.original;
          changed = true;
        }
        if (out.name !== hit.name) {
          out.name = hit.name;
          changed = true;
        }
        return out;
      });

      if (!changed) continue;
      data.granted_spells = next;
      update.run(JSON.stringify(data), row.id);
      entriesTouched++;
    }

    database
      .prepare("INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, datetime('now'))")
      .run(MIGRATION_KEY);
  });

  run();
  if (entriesTouched > 0 || unresolved > 0) {
    console.log(
      `[db] Обретаемые заклинания: записей обновлено ${entriesTouched}, ссылок перевязано ${relinked}, не свелось ${unresolved}`
    );
  }
}
