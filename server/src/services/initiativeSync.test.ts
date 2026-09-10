// Зеркало брошенной инициативы между листом персонажа и очередью боя.
// DB_DIR выставляется ДО импорта db (побочный эффект — открытие базы),
// поэтому импорты динамические. Живая база не затрагивается.

import { describe, it, expect, beforeAll } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

let db: import("better-sqlite3").Database;
let sync: typeof import("./initiativeSync");
let characterId = 0;
let sheetId = 0;
let sessionId = 0;
let oldSessionId = 0;

/** Брошенное число, как его видит лист. */
function sheetRoll(): number | null {
  const row = db.prepare("SELECT content FROM statblocks WHERE id = ?").get(sheetId) as { content: string };
  return JSON.parse(row.content).initiative ?? null;
}

function queueRoll(entryId: number): number | null {
  return (db.prepare("SELECT initiative FROM initiative_entries WHERE id = ?").get(entryId) as {
    initiative: number | null;
  }).initiative;
}

function addEntry(session: number, entity: "character" | "being", entityId: number): number {
  return Number(
    (
      db
        .prepare(
          `INSERT INTO initiative_entries (session_id, entity_type, entity_id, name, dex_modifier, kind)
           VALUES (?, ?, ?, 'X', 0, 'creature')`
        )
        .run(session, entity, entityId) as { lastInsertRowid: unknown }
    ).lastInsertRowid
  );
}

beforeAll(async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "initiative-sync-"));
  process.env.DB_DIR = tmpDir;
  ({ db } = await import("../db/db"));
  sync = await import("./initiativeSync");

  const num = (r: unknown) => Number((r as { lastInsertRowid: unknown }).lastInsertRowid);
  const settingId = num(db.prepare("INSERT INTO settings (name, folder_path) VALUES ('S','Settings/S')").run());
  const campaignId = num(
    db.prepare("INSERT INTO campaigns (name, setting_id, folder_path) VALUES ('C',?,'Campaigns/C')").run(settingId)
  );
  const playerId = num(db.prepare("INSERT INTO players (name) VALUES ('И')").run());
  characterId = num(
    db
      .prepare("INSERT INTO characters (player_id, campaign_id, character_name) VALUES (?,?,'Джарольд')")
      .run(playerId, campaignId)
  );
  sheetId = num(
    db
      .prepare(
        `INSERT INTO statblocks (owner_type, owner_id, kind, format, content)
         VALUES ('character', ?, 'full', 'dnd_character', ?)`
      )
      .run(characterId, JSON.stringify({ characterName: "Джарольд", initiative: null }))
  );
  oldSessionId = num(
    db.prepare("INSERT INTO sessions (campaign_id, date, status) VALUES (?,'2026-08-01','held')").run(campaignId)
  );
  sessionId = num(
    db.prepare("INSERT INTO sessions (campaign_id, date, status) VALUES (?,'2026-09-10','planned')").run(campaignId)
  );
}, 120_000);

describe("игрок называет своё число", () => {
  it("число попадает и на лист, и в очередь", () => {
    const entryId = addEntry(sessionId, "character", characterId);
    const res = sync.setCharacterRoll(characterId, 17);
    expect(res.initiative).toBe(17);
    expect(res.entryId).toBe(entryId);
    expect(sheetRoll()).toBe(17);
    expect(queueRoll(entryId)).toBe(17);
  });

  it("сброс стирает в обоих местах, строку не удаляя", () => {
    const entryId = addEntry(sessionId, "character", characterId);
    sync.setCharacterRoll(characterId, 12);
    sync.setCharacterRoll(characterId, null);
    expect(sheetRoll()).toBe(null);
    expect(queueRoll(entryId)).toBe(null);
    // Строка осталась: кого звать в бой — решает Мастер, а не игрок.
    expect(db.prepare("SELECT COUNT(*) AS c FROM initiative_entries WHERE id = ?").get(entryId)).toEqual({ c: 1 });
  });

  it("ноль — это число, а не сброс", () => {
    const entryId = addEntry(sessionId, "character", characterId);
    sync.setCharacterRoll(characterId, 0);
    expect(sheetRoll()).toBe(0);
    expect(queueRoll(entryId)).toBe(0);
  });

  it("без строки в очереди число живёт только на листе", () => {
    // Игрок листает чарник за день до игры. Строка не создаётся: насыпать
    // Мастеру бойцов, которых он не звал, игрок не должен.
    const before = (db.prepare("SELECT COUNT(*) AS c FROM initiative_entries").get() as { c: number }).c;
    const res = sync.setCharacterRoll(characterId, 9);
    expect(res.entryId).not.toBe(null); // строки от прошлых тестов ещё есть
    expect((db.prepare("SELECT COUNT(*) AS c FROM initiative_entries").get() as { c: number }).c).toBe(before);
    expect(sheetRoll()).toBe(9);
  });

  it("пишется только самая свежая сессия", () => {
    // Персонаж остаётся в очередях прошлых игр: «Очистить» Мастер жмёт не
    // всегда. Писать во все — значит переписывать записи законченных боёв.
    const old = addEntry(oldSessionId, "character", characterId);
    const fresh = addEntry(sessionId, "character", characterId);
    db.prepare("UPDATE initiative_entries SET initiative = 3 WHERE id = ?").run(old);
    sync.setCharacterRoll(characterId, 20);
    expect(queueRoll(fresh)).toBe(20);
    expect(queueRoll(old)).toBe(3);
  });
});

describe("Мастер правит — число возвращается на лист", () => {
  it("правка строки персонажа доезжает до листа", () => {
    const entryId = addEntry(sessionId, "character", characterId);
    sync.setCharacterRoll(characterId, 17);
    // Игрок ошибся вслух, Мастер поправил в очереди.
    db.prepare("UPDATE initiative_entries SET initiative = 15 WHERE id = ?").run(entryId);
    sync.mirrorQueueRollToSheet(entryId);
    expect(sheetRoll()).toBe(15);
  });

  it("строка существа лист не трогает", () => {
    const beingEntry = addEntry(sessionId, "being", 999);
    db.prepare("UPDATE initiative_entries SET initiative = 4 WHERE id = ?").run(beingEntry);
    const before = sheetRoll();
    sync.mirrorQueueRollToSheet(beingEntry);
    expect(sheetRoll()).toBe(before);
  });

  it("правка соседнего поля лист не переписывает", () => {
    // Через ту же ручку идут хиты и состояния. Каждый щелчок по хитам не
    // должен переписывать статблок и будить лист игрока.
    const entryId = addEntry(sessionId, "character", characterId);
    sync.setCharacterRoll(characterId, 11);
    const stamp = (db.prepare("SELECT updated_at FROM statblocks WHERE id = ?").get(sheetId) as {
      updated_at: string;
    }).updated_at;
    db.prepare("UPDATE initiative_entries SET current_hp = 5 WHERE id = ?").run(entryId);
    sync.mirrorQueueRollToSheet(entryId);
    expect(
      (db.prepare("SELECT updated_at FROM statblocks WHERE id = ?").get(sheetId) as { updated_at: string }).updated_at
    ).toBe(stamp);
  });
});

describe("зеркало от обычного сохранения листа", () => {
  it("сохранение листа довозит число до очереди", () => {
    // Лист сохраняется и обычным путём — не только узкой ручкой. Иначе
    // «хранилище — лист» перестаёт быть правдой, стоит числу приехать не тем
    // путём.
    const entryId = addEntry(sessionId, "character", characterId);
    const row = db.prepare("SELECT content FROM statblocks WHERE id = ?").get(sheetId) as { content: string };
    const data = JSON.parse(row.content);
    data.initiative = 19;
    db.prepare("UPDATE statblocks SET content = ? WHERE id = ?").run(JSON.stringify(data), sheetId);
    sync.mirrorSheetRollToQueue(characterId);
    expect(queueRoll(entryId)).toBe(19);
  });

  it("сохранение без изменения числа очередь не трогает", () => {
    const entryId = addEntry(sessionId, "character", characterId);
    sync.setCharacterRoll(characterId, 8);
    db.prepare("UPDATE initiative_entries SET current_hp = 3 WHERE id = ?").run(entryId);
    sync.mirrorSheetRollToQueue(characterId);
    expect(queueRoll(entryId)).toBe(8);
  });
});

describe("место в очереди для строки-напоминания", () => {
  it("считает место тем же порядком, что видит Мастер", () => {
    // Своя сессия, чтобы прошлые тесты не мешали.
    const num = (r: unknown) => Number((r as { lastInsertRowid: unknown }).lastInsertRowid);
    const campaignId = (db.prepare("SELECT campaign_id FROM characters WHERE id = ?").get(characterId) as {
      campaign_id: number;
    }).campaign_id;
    const fresh = num(
      db.prepare("INSERT INTO sessions (campaign_id, date, status) VALUES (?,'2026-12-31','planned')").run(campaignId)
    );
    const mine = addEntry(fresh, "character", characterId);
    const a = addEntry(fresh, "being", 1);
    const b = addEntry(fresh, "being", 2);
    db.prepare("UPDATE initiative_entries SET initiative = 22 WHERE id = ?").run(a);
    db.prepare("UPDATE initiative_entries SET initiative = 5 WHERE id = ?").run(b);
    db.prepare("UPDATE initiative_entries SET initiative = 14 WHERE id = ?").run(mine);

    expect(sync.queueStanding(characterId)).toEqual({ initiative: 14, place: 2 });
  });

  it("без числа персонаж стоит в конце, но место у него есть", () => {
    // Мастер позвал в бой, число ещё не назвали — строка должна сказать
    // «не брошена», а не исчезнуть.
    const num = (r: unknown) => Number((r as { lastInsertRowid: unknown }).lastInsertRowid);
    const campaignId = (db.prepare("SELECT campaign_id FROM characters WHERE id = ?").get(characterId) as {
      campaign_id: number;
    }).campaign_id;
    const fresh = num(
      db.prepare("INSERT INTO sessions (campaign_id, date, status) VALUES (?,'2027-01-01','planned')").run(campaignId)
    );
    const other = addEntry(fresh, "being", 3);
    db.prepare("UPDATE initiative_entries SET initiative = 9 WHERE id = ?").run(other);
    addEntry(fresh, "character", characterId);

    expect(sync.queueStanding(characterId)).toEqual({ initiative: null, place: 2 });
  });

  it("персонажа в бой не звали — места нет", () => {
    const lone = Number(
      (
        db
          .prepare("INSERT INTO characters (player_id, campaign_id, character_name) VALUES (1, 1, 'Никто')")
          .run() as { lastInsertRowid: unknown }
      ).lastInsertRowid
    );
    expect(sync.queueStanding(lone)).toEqual({ initiative: null, place: null });
  });
});
