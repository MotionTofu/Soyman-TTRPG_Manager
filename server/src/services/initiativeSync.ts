/**
 * Брошенное число инициативы между листом персонажа и очередью боя Мастера.
 *
 * Хранилище одно — лист (`initiative` в статблоке `dnd_character`). Строка
 * очереди — зеркало: игрок называет своё число, оно доезжает Мастеру; Мастер
 * поправил вслух названное — оно возвращается на лист. Последняя правка
 * побеждает в обе стороны. Второго хранилища у одного числа быть не должно:
 * ровно из-за двух хранилищ одной величины и затевался весь разбор.
 *
 * Почему очередь не открыта игроку напрямую: `GET /initiative-entries` отдаёт
 * её целиком — хиты врагов, состояния, отметки мёртвых. Один запрос показал бы
 * игроку весь бой. Поэтому игрок пишет только свой лист (маршрут
 * `/api/player/initiative`, проверка владения там же), а зеркалит сервер.
 *
 * Строка в очереди не создаётся никогда. Кого позвать в бой — решает Мастер;
 * игрок, листающий чарник за день до игры, не должен насыпать ему бойцов.
 */
import { db } from "../db/db";
import { broadcastCharacterUpdate, broadcastToGm } from "./realtime";
import { normalizeDndCharacter } from "@soyman/shared";

/** Лист `dnd_character` персонажа, если он есть. */
function characterSheet(characterId: number): { id: number; content: string } | undefined {
  return db
    .prepare(
      `SELECT id, content FROM statblocks
        WHERE owner_type = 'character' AND owner_id = ? AND format = 'dnd_character'
        ORDER BY id LIMIT 1`
    )
    .get(characterId) as { id: number; content: string } | undefined;
}

/**
 * Строка этого персонажа в очереди — из самой свежей сессии, где она есть.
 *
 * «Самой свежей», потому что персонаж мог остаться в очередях прошлых игр:
 * `DELETE /initiative-entries` Мастер жмёт не всегда, и в живой базе строки
 * лежат в сессиях, законченных недели назад. Писать во все — значит менять
 * записи прошлых боёв.
 */
function queueRow(characterId: number): { id: number; session_id: number } | undefined {
  return db
    .prepare(
      `SELECT id, session_id FROM initiative_entries
        WHERE entity_type = 'character' AND entity_id = ?
        ORDER BY session_id DESC, id DESC LIMIT 1`
    )
    .get(characterId) as { id: number; session_id: number } | undefined;
}

/** Пишет одно поле листа, не трогая остальные (лист правят с двух сторон). */
function patchSheet(sheetId: number, content: string, initiative: number | null): void {
  let data: Record<string, unknown>;
  try {
    const parsed = JSON.parse(content || "{}");
    data = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    data = {};
  }
  data.initiative = initiative;
  db.prepare(
    "UPDATE statblocks SET content = ?, updated_at = strftime('%Y-%m-%d %H:%M:%f', 'now') WHERE id = ?"
  ).run(JSON.stringify(data), sheetId);
}

export interface RollSyncResult {
  /** Число, которое теперь стоит и на листе, и в зеркале. */
  initiative: number | null;
  /** Строка очереди, если она была; `null` — Мастер персонажа в бой не звал. */
  entryId: number | null;
  sessionId: number | null;
}

/**
 * Игрок назвал (или сбросил) своё число.
 *
 * `null` — сброс: игрок стирает свой бросок перед новым. Ноль сбросом НЕ
 * является: инициатива 0 законна (Ловкость −5 и единица на кубике), и
 * подменять ею «не бросал» значит вписать за игрока число, которого он не
 * называл.
 */
export function setCharacterRoll(characterId: number, initiative: number | null): RollSyncResult {
  const sheet = characterSheet(characterId);
  if (sheet) patchSheet(sheet.id, sheet.content, initiative);

  const row = queueRow(characterId);
  if (row) {
    db.prepare("UPDATE initiative_entries SET initiative = ? WHERE id = ?").run(initiative, row.id);
    // Трекер смонтирован дважды (колонка пульта и поисковая панель, находка №4
    // аудита), поэтому событие — не «обнови такую-то строку», а «очередь этой
    // сессии изменилась»: перезагрузятся оба экземпляра и разойтись им нечем.
    broadcastToGm("initiative-updated", { sessionId: row.session_id, entryId: row.id, characterId });
  }
  broadcastCharacterUpdate(characterId);
  return { initiative, entryId: row?.id ?? null, sessionId: row?.session_id ?? null };
}

/**
 * Мастер поправил число в очереди — возвращаем его на лист.
 *
 * Зовётся только для строк персонажей: у существа листа игрока нет, и
 * зеркалить некуда.
 */
export function mirrorQueueRollToSheet(entryId: number): void {
  const row = db
    .prepare(
      `SELECT entity_type, entity_id, initiative FROM initiative_entries WHERE id = ?`
    )
    .get(entryId) as { entity_type: string | null; entity_id: number | null; initiative: number | null } | undefined;
  if (!row || row.entity_type !== "character" || row.entity_id == null) return;
  const sheet = characterSheet(row.entity_id);
  if (!sheet) return;
  // Ничего не изменилось — не будим лист: правка хитов или состояния через ту
  // же ручку не должна каждый раз переписывать статблок и слать событие.
  const current = normalizeDndCharacter(safeParse(sheet.content)).initiative;
  if (current === row.initiative) return;
  patchSheet(sheet.id, sheet.content, row.initiative);
  broadcastCharacterUpdate(row.entity_id);
}

function safeParse(content: string): unknown {
  try {
    return JSON.parse(content || "{}");
  } catch {
    return {};
  }
}

/**
 * Лист сохранён — довезти брошенное число до очереди.
 *
 * Зовётся из обоих маршрутов записи статблока (мастерского и игроцкого), а не
 * только из узкой ручки игрока: лист правится с двух сторон и с двух ролей, а
 * зеркало должно работать от любого сохранения. Иначе «хранилище — лист»
 * молча перестаёт быть правдой, стоит числу приехать не тем путём.
 *
 * Молчит, если число не менялось: через ту же запись идут хиты, состояния и
 * всё остальное содержимое листа.
 */
export function mirrorSheetRollToQueue(characterId: number): void {
  const sheet = characterSheet(characterId);
  if (!sheet) return;
  const roll = normalizeDndCharacter(safeParse(sheet.content)).initiative;
  const row = queueRow(characterId);
  if (!row) return;
  const current = (
    db.prepare("SELECT initiative FROM initiative_entries WHERE id = ?").get(row.id) as {
      initiative: number | null;
    }
  ).initiative;
  if (current === roll) return;
  db.prepare("UPDATE initiative_entries SET initiative = ? WHERE id = ?").run(roll, row.id);
  broadcastToGm("initiative-updated", { sessionId: row.session_id, entryId: row.id, characterId });
}

export interface QueueStanding {
  /** Число, которое стоит в очереди у Мастера; `null` — не брошено. */
  initiative: number | null;
  /** Место в очереди, 1 — первый ход. `null`, если персонажа в бой не звали. */
  place: number | null;
}

/**
 * Что показать игроку на его листе: своё число и своё место в очереди.
 *
 * Отдаётся только это. Содержимое очереди — хиты врагов, состояния, отметки
 * мёртвых, скрытые бойцы — игроку не уходит; даже общее число участников не
 * отдаётся, чтобы «3-й из восьми» не выдавал засаду, которую Мастер ещё не
 * показал.
 *
 * Порядок — тот же, что у Мастера в трекере (`byInitiative`): число по
 * убыванию, при равенстве модификатор инициативы, потом имя, потом id. Строки
 * без числа стоят в конце: у Мастера они падают вниз тем же правилом.
 */
export function queueStanding(characterId: number): QueueStanding {
  const row = queueRow(characterId);
  if (!row) return { initiative: null, place: null };
  const ordered = db
    .prepare(
      `SELECT id, initiative FROM initiative_entries
        WHERE session_id = ?
        ORDER BY (initiative IS NULL), initiative DESC, dex_modifier DESC, name COLLATE NOCASE, id`
    )
    .all(row.session_id) as { id: number; initiative: number | null }[];
  const index = ordered.findIndex((e) => e.id === row.id);
  const mine = ordered[index];
  return {
    initiative: mine?.initiative ?? null,
    place: index >= 0 ? index + 1 : null,
  };
}
