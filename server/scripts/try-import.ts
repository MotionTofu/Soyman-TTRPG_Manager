// Прогон импортёра на чистой временной базе и временном хранилище.
//   DB_DIR=... VAULT_ROOT=... npx tsx scripts/try-import.ts <файл.json>
import fs from "fs";
import { db } from "../src/db/db";
import { validateImport } from "../src/import/validate";
import { applyImport, rollbackBatch, knownKeysFor } from "../src/import/apply";

const file = process.argv[2];
const raw = JSON.parse(fs.readFileSync(file, "utf8"));

const result = validateImport(raw);
console.log("ok:", result.ok);
console.log("ошибок:", result.errors.length, "предупреждений:", result.warnings.length);
for (const e of result.errors.slice(0, 10)) console.log("  ✗", e.path, "—", e.message);
for (const w of result.warnings.slice(0, 10)) console.log("  ⚠", w.path, "—", w.message);
console.log("разбор:", result.counts);
if (!result.ok || !result.data) process.exit(1);

const applied = applyImport(result.data, { settingId: null, fileName: file });
console.log("\nзаписано:", applied.counts);
console.log("сеттинг:", applied.settingId, "батч:", applied.batchId);

const one = (sql: string, ...args: unknown[]) =>
  (db.prepare(sql).get(...(args as [])) as Record<string, number>).n;

const s = applied.settingId;
console.log("\n--- в базе ---");
console.log("локаций:", one("SELECT COUNT(*) n FROM setting_locations WHERE setting_id = ?", s));
console.log("  с родителем:", one("SELECT COUNT(*) n FROM setting_locations WHERE setting_id = ? AND parent_id IS NOT NULL", s));
console.log("статей локаций:", one("SELECT COUNT(*) n FROM location_chapters lc JOIN setting_locations l ON l.id = lc.location_id WHERE l.setting_id = ?", s));
console.log("существ:", one("SELECT COUNT(*) n FROM setting_beings WHERE setting_id = ?", s));
console.log("  бестиарий:", one("SELECT COUNT(*) n FROM setting_beings WHERE setting_id = ? AND category = 'bestiary'", s));
console.log("  с локацией:", one("SELECT COUNT(*) n FROM being_locations bl JOIN setting_beings b ON b.id = bl.being_id WHERE b.setting_id = ?", s));
console.log("сообществ:", one("SELECT COUNT(*) n FROM setting_communities WHERE setting_id = ?", s));
console.log("предметов:", one("SELECT COUNT(*) n FROM artifacts WHERE setting_id = ?", s));
console.log("дуг:", one("SELECT COUNT(*) n FROM story_arcs WHERE setting_id = ?", s));
console.log("  приключений:", one("SELECT COUNT(*) n FROM story_arcs WHERE setting_id = ? AND kind = 'adventure'", s));
console.log("  глав:", one("SELECT COUNT(*) n FROM story_arcs WHERE setting_id = ? AND kind = 'chapter'", s));
console.log("сцен:", one("SELECT COUNT(*) n FROM story_scenes WHERE setting_id = ?", s));
console.log("  с зачитыванием:", one("SELECT COUNT(*) n FROM story_scenes WHERE setting_id = ? AND read_aloud != ''", s));
console.log("  в главах:", one("SELECT COUNT(*) n FROM story_scenes sc JOIN story_arcs a ON a.id = sc.arc_id WHERE sc.setting_id = ? AND a.kind = 'chapter'", s));
console.log("проверок:", one("SELECT COUNT(*) n FROM story_scene_checks c JOIN story_scenes sc ON sc.id = c.scene_id WHERE sc.setting_id = ?", s));
console.log("наград:", one("SELECT COUNT(*) n FROM story_scene_rewards r LEFT JOIN story_scenes sc ON sc.id = r.scene_id LEFT JOIN story_arcs a ON a.id = r.arc_id WHERE sc.setting_id = ? OR a.setting_id = ?", s, s));
console.log("вех:", one("SELECT COUNT(*) n FROM story_milestones m JOIN story_arcs a ON a.id = m.arc_id WHERE a.setting_id = ?", s));
console.log("  со сценой:", one("SELECT COUNT(*) n FROM story_milestones m JOIN story_arcs a ON a.id = m.arc_id WHERE a.setting_id = ? AND m.scene_id IS NOT NULL", s));
console.log("тайн:", one("SELECT COUNT(*) n FROM story_secrets sr JOIN story_arcs a ON a.id = sr.arc_id WHERE a.setting_id = ?", s));
console.log("переходов:", one("SELECT COUNT(*) n FROM story_scene_transitions t JOIN story_scenes sc ON sc.id = t.from_scene_id WHERE sc.setting_id = ?", s));
console.log("связей сцен:", one("SELECT COUNT(*) n FROM generic_links g JOIN story_scenes sc ON sc.id = g.from_id WHERE g.from_type = 'scene' AND sc.setting_id = ?", s));
console.log("отношений:", one("SELECT COUNT(*) n FROM entity_relations"));
console.log("событий календаря:", one("SELECT COUNT(*) n FROM setting_calendar_events WHERE setting_id = ?", s));

const leftover = db
  .prepare("SELECT name, read_aloud FROM story_scenes WHERE setting_id = ? AND read_aloud LIKE '%[[%'")
  .all(s) as { name: string; read_aloud: string }[];
console.log("\nнеподменённых меншенов в зачитывании:", leftover.length);
const sample = db
  .prepare("SELECT summary FROM story_scenes WHERE setting_id = ? AND summary LIKE '%[[%' LIMIT 2")
  .all(s) as { summary: string }[];
for (const row of sample) console.log("  пример:", row.summary.slice(0, 160));

console.log("\nключей в карте:", Object.keys(knownKeysFor(s)).length);

console.log("\n--- откат ---");
console.log(rollbackBatch(applied.batchId));
console.log("осталось локаций:", one("SELECT COUNT(*) n FROM setting_locations WHERE setting_id = ?", s));
console.log("осталось сцен:", one("SELECT COUNT(*) n FROM story_scenes WHERE setting_id = ?", s));
console.log("осталось связей:", one("SELECT COUNT(*) n FROM generic_links WHERE from_type = 'scene'"));
console.log("осталось отношений:", one("SELECT COUNT(*) n FROM entity_relations"));
console.log("осталось сеттингов:", one("SELECT COUNT(*) n FROM settings"));
