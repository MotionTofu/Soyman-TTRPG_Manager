import type { Database } from "better-sqlite3";

/**
 * Перенос скорости из свободного текста в структуру.
 *
 * Зачем. Рядом с легаси-полем `speed` («30 фт.») у листа давно живёт
 * `speeds` со своим редактором — ходьба, полёт, плавание, лазание, копание.
 * Штраф истощения (5.5 отнимает 5 футов за уровень) и показ в клетках
 * считаются от `speeds.walk`, и на листах, где заполнен только текст, оба
 * не работают вовсе. В базе владельца таких листов пять из шести.
 *
 * Переносится **только однозначное**: текст, состоящий ровно из числа и
 * единицы («30 фт.», «30 футов»). Всё остальное — «9 клеток, лазание 3»,
 * «30 фт. (40 в облике волка)» — остаётся текстом: разбирать его догадками
 * значит подменить написанное Мастером своим прочтением. Текст, который
 * перенесён, стирается: число целиком уехало в структуру, и оставить его
 * значило бы показывать одно и то же дважды.
 */

const MIGRATION_KEY = "dnd_speed_structured";

/** «30 фт.», «30 футов», «30 ft» — и ничего больше. */
const PLAIN_SPEED = /^\s*(\d{1,3})\s*(фт\.?|футов|фута|ft\.?|feet)\s*$/i;

export function migrateDndSpeedStructure(database: Database): void {
  const done = database.prepare("SELECT value FROM app_settings WHERE key = ?").get(MIGRATION_KEY);
  if (done) return;

  let moved = 0;
  let kept = 0;

  const run = database.transaction(() => {
    const rows = database
      .prepare("SELECT id, content FROM statblocks WHERE format = 'dnd_character'")
      .all() as { id: number; content: string }[];
    const update = database.prepare("UPDATE statblocks SET content = ? WHERE id = ?");

    for (const row of rows) {
      let data: Record<string, unknown>;
      try {
        const parsed = JSON.parse(row.content || "{}");
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) continue;
        data = parsed as Record<string, unknown>;
      } catch {
        continue;
      }
      const text = typeof data.speed === "string" ? data.speed : "";
      if (!text.trim()) continue;
      const speeds = (data.speeds ?? {}) as Record<string, unknown>;
      // Структура уже заполнена — своё не трогаем.
      if (typeof speeds.walk === "number") continue;
      const m = PLAIN_SPEED.exec(text);
      if (!m) {
        kept++;
        continue;
      }
      data.speeds = { ...speeds, walk: Number(m[1]) };
      data.speed = "";
      update.run(JSON.stringify(data), row.id);
      moved++;
    }

    database
      .prepare("INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, datetime('now'))")
      .run(MIGRATION_KEY);
  });

  run();
  if (moved > 0 || kept > 0) {
    console.log(`[db] Скорость персонажей: перенесено в структуру ${moved}, оставлено текстом ${kept} (разбирается неоднозначно)`);
  }
}
