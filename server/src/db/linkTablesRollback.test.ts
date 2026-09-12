// Откат объединения двух таблиц связей (решения 2026-09-12, «Два графа»).
//
// Повод: копир `generic_links → entity_relations`, подписанный «one-time», шёл
// при каждом открытии базы. Добавленная связь попадала в граф только после
// перезапуска сервера, удалённая оставалась там навсегда, а зона сцены и
// «приложить ресурс» писали в таблицу мнений, читая списки, — и добавленное не
// показывалось вовсе.
//
// Шаг разбирает наделанное по одному признаку: списочная строка — та, у
// которой есть секция и пусты тон, подпись и описание. Строка с подписью не
// трогается, даже если у неё есть секция: это работа Мастера, а не копия.

import { describe, it, expect, beforeAll } from "vitest";
import type Database from "better-sqlite3";
import fs from "fs";
import os from "os";
import path from "path";
import { openDatabase } from "./db";

function rows(db: Database.Database, sql: string) {
  return db.prepare(sql).all() as Record<string, unknown>[];
}

describe("откат объединения таблиц связей", () => {
  let dir: string;
  let after: Database.Database;

  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "soyman-link-rollback-"));
    const first = openDatabase(dir);

    // Связь-список, как её пишет исправленная зона.
    first
      .prepare(
        `INSERT INTO generic_links (from_type, from_id, to_type, to_id, section, origin)
         VALUES ('scene', 311, 'being', 23, 'scene_plot_characters', 'planned')`
      )
      .run();

    const relation = first.prepare(
      `INSERT INTO entity_relations (from_type, from_id, to_type, to_id, tone, label, description, section, origin, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'planned', '2026-09-08 12:26:45')`
    );
    // 1. Копия той самой связи — её оставил копир.
    relation.run("scene", 311, "being", 23, "neutral", "", "", "scene_plot_characters");
    // 2. Списочная строка, которой в списках нет: её положила сломанная зона
    //    сцены. Должна переехать в generic_links, а не пропасть.
    relation.run("scene", 311, "being", 560, "neutral", "", "", "scene_plot_characters");
    // 3. Мнение — секции нет, есть тон и подпись. Не трогать.
    relation.run("being", 21, "being", 82, "negative", "ненавидит", "старая вражда", null);
    // 4. Мнение с секцией: так пишет зона «Связанное», если ей дать секцию.
    //    Подпись непустая — значит не копия, и шаг обязан пройти мимо.
    relation.run("community", 8, "being", 21, "positive", "покровитель", "", "hooks");
    first.close();

    after = openDatabase(dir);
  });

  it("копию списочной строки убирает", () => {
    const left = rows(
      after,
      `SELECT id FROM entity_relations WHERE from_type='scene' AND from_id=311 AND to_type='being' AND to_id=23`
    );
    expect(left).toHaveLength(0);
  });

  it("строку, которой нет в списках, переносит в generic_links", () => {
    const moved = rows(
      after,
      `SELECT section, origin, created_at FROM generic_links
        WHERE from_type='scene' AND from_id=311 AND to_type='being' AND to_id=560`
    );
    expect(moved).toHaveLength(1);
    expect(moved[0].section).toBe("scene_plot_characters");
    // Дата создания сохраняется: это работа Мастера от 8 сентября, а не новая
    // связь, и в списке «откуда пришло» она должна стоять на своём месте.
    expect(moved[0].created_at).toBe("2026-09-08 12:26:45");
    expect(rows(after, `SELECT id FROM entity_relations WHERE to_id=560 AND from_id=311`)).toHaveLength(0);
  });

  it("мнения не трогает — ни без секции, ни с секцией и подписью", () => {
    const opinions = rows(
      after,
      `SELECT from_type, to_id, tone, label, section FROM entity_relations ORDER BY id`
    );
    expect(opinions).toHaveLength(2);
    expect(opinions[0]).toMatchObject({ from_type: "being", to_id: 82, tone: "negative", label: "ненавидит" });
    expect(opinions[1]).toMatchObject({ from_type: "community", to_id: 21, label: "покровитель", section: "hooks" });
  });

  it("повторное открытие базы ничего не меняет", () => {
    const before = {
      links: rows(after, "SELECT id FROM generic_links").length,
      relations: rows(after, "SELECT id FROM entity_relations").length,
    };
    after.close();
    const again = openDatabase(dir);
    expect({
      links: rows(again, "SELECT id FROM generic_links").length,
      relations: rows(again, "SELECT id FROM entity_relations").length,
    }).toEqual(before);
    again.close();
  });
});
