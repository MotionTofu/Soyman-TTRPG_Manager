// Улики и поля узла в импорте книги (adventure-import/1) и в выгрузке-загрузке
// приключения (adventure-export/1). Временная база; живая не затрагивается.

import { describe, it, expect, beforeAll } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

let db: typeof import("../db/db").db;
let validateImport: typeof import("./validate").validateImport;
let applyImport: typeof import("./apply").applyImport;
let story: typeof import("../routes/story");

beforeAll(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "import-clues-test-"));
  process.env.DB_DIR = tmp;
  process.env.VAULT_ROOT = tmp;
  db = (await import("../db/db")).db;
  validateImport = (await import("./validate")).validateImport;
  applyImport = (await import("./apply")).applyImport;
  story = await import("../routes/story");
}, 120000);

const book = {
  format: "adventure-import/1",
  setting: { key: "set.salt", name: "Соль и фонари" },
  locations: [{ key: "loc.market", name: "Ночной рынок" }],
  adventures: [
    {
      key: "adv.alchemist",
      name: "Пропавший алхимик",
      scenes: [
        {
          key: "scn.workshop",
          name: "Мастерская Орина",
          node_type: "place",
          node_role: "start",
          about: "loc.market",
          clues: [
            { text: "Фонарь с клеймом гильдии", how: "обыскать", to: "scn.guild" },
            { text: "Письмо: «не ищи меня»", to: "sec.fake" },
            { text: "Пятно масла" },
          ],
          next: [{ to: "scn.guild", label: "дверь во двор" }],
        },
        { key: "scn.guild", name: "Гильдия фонарщиков", node_type: "organization" },
        { key: "scn.lab", name: "Лаборатория", kind: "ending" },
        { key: "scn.patrol", name: "Патруль", node_role: "proactive", trigger: "подняли шум" },
      ],
      secrets: [
        { key: "sec.fake", title: "Орин инсценировал похищение" },
        { key: "sec.old", kind: "clue", title: "Старая улика", content: "в подвале" },
      ],
    },
  ],
};

describe("импорт книги: улики и узлы", () => {
  let arcId = 0;
  const scene = (name: string) =>
    db.prepare("SELECT * FROM story_scenes WHERE arc_id = ? AND name = ?").get(arcId, name) as Record<string, unknown>;

  it("раскладывает тип, роль, триггер, «о ком» и улики с целями", () => {
    const v = validateImport(book);
    expect(v.ok).toBe(true);
    expect(v.counts.улики).toBe(3);
    const res = applyImport(v.data!, { settingId: null, fileName: "book.json" });
    arcId = Number(res.keys["adv.alchemist"].split(":")[1]);

    const workshop = scene("Мастерская Орина");
    expect(workshop).toMatchObject({ node_type: "place", node_role: "start", subject_type: "location" });
    expect(scene("Лаборатория").node_role).toBe("finale");
    expect(scene("Патруль")).toMatchObject({ node_role: "proactive", node_trigger: "подняли шум" });

    const clues = db.prepare("SELECT * FROM story_clues WHERE scene_id = ? ORDER BY position").all(workshop.id) as Record<
      string,
      unknown
    >[];
    expect(clues.map((c) => [c.text, c.target_type])).toEqual([
      ["Фонарь с клеймом гильдии", "scene"],
      ["Письмо: «не ищи меня»", "secret"],
      ["Пятно масла", null],
    ]);
    expect(clues[0].target_id).toBe(scene("Гильдия фонарщиков").id);
    // Проход остался проходом.
    expect(db.prepare("SELECT label FROM story_scene_transitions WHERE from_scene_id = ?").get(workshop.id)).toEqual({
      label: "дверь во двор",
    });
    // Старый вид «Улика» — в лоток, а не в тайны.
    expect(db.prepare("SELECT text FROM story_clues WHERE arc_id = ? AND scene_id IS NULL").all(arcId)).toEqual([
      { text: "Старая улика — в подвале" },
    ]);
    expect(db.prepare("SELECT COUNT(*) AS n FROM story_secrets WHERE arc_id = ?").get(arcId)).toEqual({ n: 1 });
  });

  it("выгрузка и загрузка приключения переносят улики, узлы, лоток и тайну на холсте", async () => {
    const secretId = (db.prepare("SELECT id FROM story_secrets WHERE arc_id = ?").get(arcId) as { id: number }).id;
    db.prepare("INSERT INTO canvas_boards (scope_type, scope_id) VALUES ('arc', ?)").run(arcId);
    const board = db.prepare("SELECT id FROM canvas_boards WHERE scope_type = 'arc' AND scope_id = ?").get(arcId) as { id: number };
    db.prepare("INSERT INTO canvas_nodes (board_id, node_type, node_id, x, y) VALUES (?, 'secret', ?, 40, 50)").run(board.id, secretId);

    const data = story.buildAdventureExportData(arcId)!;
    const settingId = (db.prepare("SELECT setting_id FROM story_arcs WHERE id = ?").get(arcId) as { setting_id: number })
      .setting_id;
    const copyId = (await story.importAdventureExport(settingId, data, { withImages: false }))!;
    const copyScene = (name: string) =>
      db.prepare("SELECT * FROM story_scenes WHERE arc_id = ? AND name = ?").get(copyId, name) as Record<string, unknown>;

    expect(copyScene("Мастерская Орина")).toMatchObject({ node_type: "place", node_role: "start", subject_type: "location" });
    expect(copyScene("Патруль").node_trigger).toBe("подняли шум");
    const clues = db
      .prepare("SELECT text, target_type, target_id FROM story_clues WHERE scene_id = ? ORDER BY position")
      .all(copyScene("Мастерская Орина").id) as { text: string; target_type: string; target_id: number }[];
    const copySecret = (db.prepare("SELECT id FROM story_secrets WHERE arc_id = ?").get(copyId) as { id: number }).id;
    expect(clues[0]).toMatchObject({ target_type: "scene", target_id: copyScene("Гильдия фонарщиков").id });
    expect(clues[1]).toMatchObject({ target_type: "secret", target_id: copySecret });
    expect(db.prepare("SELECT COUNT(*) AS n FROM story_clues WHERE arc_id = ? AND scene_id IS NULL").get(copyId)).toEqual({ n: 1 });
    const copyBoard = db.prepare("SELECT id FROM canvas_boards WHERE scope_type = 'arc' AND scope_id = ?").get(copyId) as {
      id: number;
    };
    expect(
      db.prepare("SELECT node_id, x FROM canvas_nodes WHERE board_id = ? AND node_type = 'secret'").get(copyBoard.id)
    ).toEqual({ node_id: copySecret, x: 40 });
  });
});
