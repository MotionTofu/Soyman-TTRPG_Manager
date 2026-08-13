// Расстановка меншенов в тексте, который уже лежит в базе.
//
// Модель ставить их почти не умеет: на четыре разобранные книги пришлось 17
// меншенов на 99 сцен. Читаешь «Мирт отправляет вас в Синий переулок» — и ни
// одно имя не нажимается, хотя обе сущности в базе есть.
//
// Проходов два, и отличаются они не поиском, а тем, откуда берутся кандидаты.
//
// **По приключению.** В сцене ищутся только сущности, уже связанные с ней самой:
// участники, места и предметы, которые импорт расставляет исправно (по три-пять
// на сцену в каждой книге). Точность отсюда высокая почти даром, и новых связей
// проход не создаёт — та, на которую он ссылается, уже стоит.
//
// **По сеттингу.** Тексты вне сцен — описания локаций, истории личностей, поля
// сообществ, сила предметов — связей между собой почти не имеют: на 180 находок
// в Вотердипе пришлось ноль пар, уже соединённых в графе. Якоря нет, поэтому
// кандидаты берутся из всего сеттинга, а точность держится на другом: имя
// должно отзываться ровно одной сущности. Что не проходит этот отбор,
// показывается, но галочкой не отмечается.

import { db } from "../db/db";
import { parseAliases } from "./names";

/** Где какие текстовые поля и как они называются для человека. */
const OWNER_TEXT: Record<string, { table: string; label: string; fields: Record<string, string> }> = {
  scene: {
    table: "story_scenes",
    label: "Сцена",
    fields: {
      summary: "Сводка",
      read_aloud: "Зачитать вслух",
      whats_happening: "Что происходит",
      entry_condition: "Условие входа",
      outcomes: "Исходы",
    },
  },
  location: {
    table: "setting_locations",
    label: "Локация",
    fields: { description: "Описание" },
  },
  being: {
    table: "setting_beings",
    label: "Личность",
    fields: { description: "Описание", history: "История", behavior: "Поведение" },
  },
  community: {
    table: "setting_communities",
    label: "Сообщество",
    fields: {
      description: "Описание",
      history: "История",
      current_situation: "Текущая ситуация",
      features: "Особенности",
      goals: "Цели",
    },
  },
  artifact: {
    table: "artifacts",
    label: "Предмет",
    fields: { owner: "Владелец", power: "Сила", history: "История", notes: "Заметки" },
  },
  adventure: {
    table: "story_arcs",
    label: "Приключение",
    fields: { description: "Синопсис", hook: "Завязка" },
  },
};

/** Типы, чьи страницы существуют: на них и можно сослаться. */
const LINKABLE: Record<string, { table: string; hasShortName: boolean }> = {
  location: { table: "setting_locations", hasShortName: true },
  being: { table: "setting_beings", hasShortName: true },
  community: { table: "setting_communities", hasShortName: false },
  artifact: { table: "artifacts", hasShortName: true },
};

export interface CrossLinkProposal {
  /** Чей это текст: «scene», «location», «being»… */
  ownerType: string;
  ownerId: number;
  ownerName: string;
  ownerLabel: string;
  field: string;
  fieldLabel: string;
  /** Тип и id цели: «being:410». */
  ref: string;
  targetName: string;
  /** Как имя написано в тексте: «Миртом», «Синего переулка». */
  matched: string;
  /** Кусок текста вокруг находки — по нему человек и решает. */
  context: string;
  /** Каким написанием поймалось: по нему видно, насколько находке верить. */
  via: string;
  /** Отмечать ли галочкой сразу. */
  suggested: boolean;
  /** Почему не отмечено: показывается рядом с группой. */
  doubt?: string;
}

interface Spelling {
  text: string;
  via: string;
  suggested: boolean;
  doubt?: string;
}

interface Candidate {
  ref: string;
  name: string;
  spellings: Spelling[];
}

/**
 * Имя может стоять в тексте в любом падеже: «Мирт» → «Миртом», «Мирта».
 * Окончание отрезать нечем — морфологии в проекте нет, — поэтому имя ищется
 * началом слова, а хвост из букв дописывается в подпись меншена: ссылка
 * получается на «Миртом» целиком, а не на «Мирт» с висящим «ом».
 *
 * Хвост ограничен тремя буквами: этого хватает любому падежу и не хватает,
 * чтобы «Мирт» поймал «Миртаграаль».
 */
const MAX_INFLECTION = 3;
const LETTER = /[\p{L}\p{M}]/u;

/** Границей слова служит всё, что не буква: имя не должно ловиться в середине. */
function findSpelling(text: string, spelling: string): { start: number; end: number }[] {
  const found: { start: number; end: number }[] = [];
  const haystack = text.toLowerCase();
  const needle = spelling.toLowerCase();
  if (!needle) return found;
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(needle, from);
    if (at < 0) break;
    from = at + needle.length;
    const before = text[at - 1];
    if (before && LETTER.test(before)) continue;
    // Хвост словоизменения — только у однословных имён: у «Синего переулка»
    // склоняется и первое слово, а его началом уже не поймать.
    let end = at + needle.length;
    if (!needle.includes(" ")) {
      let tail = 0;
      while (tail < MAX_INFLECTION && text[end] && LETTER.test(text[end])) {
        end++;
        tail++;
      }
      // Слово длиннее хвоста — значит это другое слово, а не падеж.
      if (text[end] && LETTER.test(text[end])) continue;
    } else if (text[end] && LETTER.test(text[end])) {
      continue;
    }
    found.push({ start: at, end });
  }
  return found;
}

/** Куски текста, уже занятые меншенами: внутрь них лезть нельзя. */
function mentionSpans(text: string): { start: number; end: number }[] {
  const spans: { start: number; end: number }[] = [];
  const re = /\[\[[^\]]*\]\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) spans.push({ start: m.index, end: m.index + m[0].length });
  return spans;
}

interface EntityRow {
  id: number;
  name: string;
  short_name: string | null;
  aliases: string;
  name_original: string;
  kind: string;
}

function spellingsOf(entity: EntityRow): Spelling[] {
  // Короткое имя заведено для подписи пина на карте, а не для прозы, и часто
  // это простое существительное: у локации «2. Фреска увечий» оно «Фреска»,
  // у «Карты сокровищ» — «Карта». В тексте такие слова стоят сами по себе
  // чаще, чем в значении сущности.
  const doubtShort = "короткое имя — часто простое слово";
  // Сущность, названная собственным видом, — тот же случай, но с названием:
  // локация «Коридор» вида «коридор». Слово «коридор» в тексте почти всегда
  // означает коридор, а не эту локацию.
  const named = entity.name.trim().toLowerCase();
  const selfNamed = !!entity.kind && named === entity.kind.trim().toLowerCase();
  const doubtKind = selfNamed ? "названа собственным видом" : undefined;
  return [
    { text: entity.name, via: "название", suggested: !selfNamed, doubt: doubtKind },
    { text: entity.name_original ?? "", via: "оригинал", suggested: true },
    ...parseAliases(entity.aliases).map((a) => ({ text: a, via: "синоним", suggested: true })),
    { text: entity.short_name ?? "", via: "короткое имя", suggested: false, doubt: doubtShort },
  ]
    .map((s) => ({ ...s, text: s.text.trim() }))
    .filter((s) => s.text.length >= 4);
}

function loadEntity(type: string, id: number): Candidate | null {
  const meta = LINKABLE[type];
  if (!meta) return null;
  const row = db
    .prepare(
      `SELECT id, name, ${meta.hasShortName ? "short_name" : "'' AS short_name"},
              aliases, name_original, ${meta.table === "setting_locations" ? "kind" : "'' AS kind"}
         FROM ${meta.table} WHERE id = ? AND archived_at IS NULL`
    )
    .get(id) as EntityRow | undefined;
  if (!row) return null;
  const spellings = spellingsOf(row);
  if (!spellings.length) return null;
  // Длинные написания вперёд: «Синий переулок» должен побеждать «Синий».
  spellings.sort((a, b) => b.text.length - a.text.length);
  return { ref: `${type}:${row.id}`, name: row.name, spellings };
}

/** Сущности, уже связанные именно с этой сценой: только среди них и ищем. */
function candidatesForScene(sceneId: number): Candidate[] {
  const rows = db
    .prepare(
      `SELECT to_type AS type, to_id AS id FROM generic_links
        WHERE from_type = 'scene' AND from_id = ?
       UNION
       SELECT from_type AS type, from_id AS id FROM generic_links
        WHERE to_type = 'scene' AND to_id = ?`
    )
    .all(sceneId, sceneId) as { type: string; id: number }[];
  return rows.map((r) => loadEntity(r.type, r.id)).filter((c): c is Candidate => !!c);
}

/** Все сущности сеттинга, на которые можно сослаться. */
function candidatesForSetting(settingId: number): Candidate[] {
  const out: Candidate[] = [];
  for (const [type, meta] of Object.entries(LINKABLE)) {
    const rows = db
      .prepare(`SELECT id FROM ${meta.table} WHERE setting_id = ? AND archived_at IS NULL`)
      .all(settingId) as { id: number }[];
    for (const row of rows) {
      const candidate = loadEntity(type, row.id);
      if (candidate) out.push(candidate);
    }
  }
  return out;
}

/**
 * Сколько сущностей сеттинга отзывается на одно написание. В Вотердипе таких
 * пересечений всего три на 438 написаний, но «черный посох» — это и титул
 * Ваджры, и башня, и угадывать за человека тут нечего.
 */
function ambiguousSpellings(candidates: Candidate[]): Set<string> {
  const owners = new Map<string, Set<string>>();
  for (const c of candidates) {
    for (const s of c.spellings) {
      const key = s.text.toLowerCase();
      if (!owners.has(key)) owners.set(key, new Set());
      owners.get(key)!.add(c.ref);
    }
  }
  return new Set([...owners.entries()].filter(([, refs]) => refs.size > 1).map(([key]) => key));
}

interface Doc {
  ownerType: string;
  ownerId: number;
  ownerName: string;
  text: Record<string, string>;
}

/** Тексты сцен приключения вместе с его главами. Только оригиналы сеттинга. */
function docsOfArc(arcId: number): Doc[] {
  const fields = Object.keys(OWNER_TEXT.scene.fields);
  return (
    db
      .prepare(
        `SELECT s.id, s.name, ${fields.map((f) => `s.${f}`).join(", ")}
           FROM story_scenes s
           JOIN story_arcs a ON a.id = s.arc_id
          WHERE (a.id = ? OR a.parent_id = ?)
            AND a.archived_at IS NULL
            AND s.campaign_id IS NULL AND s.archived_at IS NULL
          ORDER BY s.position, s.id`
      )
      .all(arcId, arcId) as Record<string, string | number>[]
  ).map((row) => ({
    ownerType: "scene",
    ownerId: Number(row.id),
    ownerName: String(row.name),
    text: Object.fromEntries(fields.map((f) => [f, String(row[f] ?? "")])),
  }));
}

/** Тексты сеттинга вне сцен: карточки сущностей и синопсисы приключений. */
function docsOfSetting(settingId: number): Doc[] {
  const docs: Doc[] = [];
  for (const [ownerType, meta] of Object.entries(OWNER_TEXT)) {
    if (ownerType === "scene") continue;
    const fields = Object.keys(meta.fields);
    const rows = db
      .prepare(
        `SELECT id, name, ${fields.join(", ")} FROM ${meta.table}
          WHERE setting_id = ? AND archived_at IS NULL`
      )
      .all(settingId) as Record<string, string | number>[];
    for (const row of rows) {
      docs.push({
        ownerType,
        ownerId: Number(row.id),
        ownerName: String(row.name),
        text: Object.fromEntries(fields.map((f) => [f, String(row[f] ?? "")])),
      });
    }
  }
  return docs;
}

const CONTEXT = 60;

/** Общее ядро: пройтись по текстам и предложить, что в них разметить. */
function scan(
  docs: Doc[],
  candidatesFor: (doc: Doc) => Candidate[],
  ambiguous: Set<string>
): CrossLinkProposal[] {
  const proposals: CrossLinkProposal[] = [];
  for (const doc of docs) {
    const candidates = candidatesFor(doc);
    if (!candidates.length) continue;
    const meta = OWNER_TEXT[doc.ownerType];
    for (const [field, fieldLabel] of Object.entries(meta.fields)) {
      const text = doc.text[field] ?? "";
      if (!text.trim()) continue;
      // Занятые куски копятся по ходу: две находки не должны накладываться,
      // а первой идёт та, что нашлась более длинным написанием.
      const busy = mentionSpans(text);
      for (const candidate of candidates) {
        // Ссылка сущности на саму себя смысла не имеет.
        if (candidate.ref === `${doc.ownerType}:${doc.ownerId}`) continue;
        for (const spelling of candidate.spellings) {
          const hits = findSpelling(text, spelling.text);
          if (!hits.length) continue;
          // Одна ссылка на сущность в поле: текст, где имя размечено пять раз
          // подряд, читать невозможно.
          const hit = hits.find((h) => !busy.some((b) => h.start < b.end && b.start < h.end));
          if (!hit) continue;
          busy.push(hit);
          const collides = ambiguous.has(spelling.text.toLowerCase());
          proposals.push({
            ownerType: doc.ownerType,
            ownerId: doc.ownerId,
            ownerName: doc.ownerName,
            ownerLabel: meta.label,
            field,
            fieldLabel,
            ref: candidate.ref,
            targetName: candidate.name,
            matched: text.slice(hit.start, hit.end),
            via: spelling.via,
            suggested: spelling.suggested && !collides,
            doubt: collides ? "так зовут не только её" : spelling.doubt,
            context:
              (hit.start > CONTEXT ? "…" : "") +
              text.slice(Math.max(0, hit.start - CONTEXT), hit.end + CONTEXT).trim() +
              (hit.end + CONTEXT < text.length ? "…" : ""),
          });
          break;
        }
      }
    }
  }
  return proposals;
}

/** Что проход предлагает разметить в сценах приключения. Ничего не пишет. */
export function planCrossLinks(arcId: number): CrossLinkProposal[] {
  // Кандидаты берутся из связей самой сцены, поэтому пересечения имён по всему
  // сеттингу здесь не при чём: две сущности с одним именем в одной сцене —
  // случай, которого в четырёх книгах не встретилось ни разу.
  return scan(docsOfArc(arcId), (doc) => candidatesForScene(doc.ownerId), new Set());
}

/** То же по всем текстам сеттинга вне сцен: там связей-якорей нет. */
export function planSettingCrossLinks(settingId: number): CrossLinkProposal[] {
  const candidates = candidatesForSetting(settingId);
  return scan(docsOfSetting(settingId), () => candidates, ambiguousSpellings(candidates));
}

export interface CrossLinkChoice {
  ownerType: string;
  ownerId: number;
  field: string;
  ref: string;
  matched: string;
}

const choiceId = (c: CrossLinkChoice | CrossLinkProposal) =>
  `${c.ownerType}|${c.ownerId}|${c.field}|${c.ref}|${c.matched}`;

/**
 * Записывает выбранное. Ищется всё заново по тому же правилу: между показом и
 * подтверждением текст мог измениться, и подставлять меншен по запомненному
 * смещению значило бы попасть в середину чужого слова.
 */
function write(proposals: CrossLinkProposal[], chosen: CrossLinkChoice[]): { written: number } {
  const wanted = new Set(chosen.map(choiceId));
  const linkMention = db.prepare(
    `INSERT OR IGNORE INTO generic_links (from_type, from_id, to_type, to_id, section)
     VALUES (?, ?, ?, ?, 'mention')`
  );
  const run = db.transaction(() => {
    let written = 0;
    for (const proposal of proposals) {
      if (!wanted.has(choiceId(proposal))) continue;
      const meta = OWNER_TEXT[proposal.ownerType];
      if (!meta || !meta.fields[proposal.field]) continue;
      const row = db
        .prepare(`SELECT ${proposal.field} AS value FROM ${meta.table} WHERE id = ?`)
        .get(proposal.ownerId) as { value: string } | undefined;
      if (!row) continue;
      const busy = mentionSpans(row.value);
      const hit = findSpelling(row.value, proposal.matched).find(
        (h) => !busy.some((b) => h.start < b.end && b.start < h.end)
      );
      if (!hit) continue;
      const next =
        row.value.slice(0, hit.start) +
        `[[${proposal.ref}|${row.value.slice(hit.start, hit.end)}]]` +
        row.value.slice(hit.end);
      db.prepare(`UPDATE ${meta.table} SET ${proposal.field} = ? WHERE id = ?`).run(
        next,
        proposal.ownerId
      );
      // Меншен, поставленный руками в редакторе, заводит связь с пометкой
      // «mention» — здесь то же самое, иначе текст и карточка «Связи»
      // разъедутся. Уже существующую связь INSERT OR IGNORE не трогает:
      // ключ таблицы не включает section.
      const [type, id] = proposal.ref.split(":");
      linkMention.run(proposal.ownerType, proposal.ownerId, type, Number(id));
      written++;
    }
    return { written };
  });
  return run();
}

export const applyCrossLinks = (arcId: number, chosen: CrossLinkChoice[]) =>
  write(planCrossLinks(arcId), chosen);

export const applySettingCrossLinks = (settingId: number, chosen: CrossLinkChoice[]) =>
  write(planSettingCrossLinks(settingId), chosen);

/** Снятие меншенов: подпись остаётся, ссылка уходит. */
function strip(docs: Doc[]): { removed: number } {
  const run = db.transaction(() => {
    let removed = 0;
    for (const doc of docs) {
      const meta = OWNER_TEXT[doc.ownerType];
      for (const field of Object.keys(meta.fields)) {
        const text = doc.text[field] ?? "";
        if (!text.includes("[[")) continue;
        const next = text.replace(/\[\[[^\]|]+\|([^\]]*)\]\]/g, (_, label: string) => {
          removed++;
          return label;
        });
        db.prepare(`UPDATE ${meta.table} SET ${field} = ? WHERE id = ?`).run(next, doc.ownerId);
      }
    }
    return { removed };
  });
  return run();
}

export const stripCrossLinks = (arcId: number) => strip(docsOfArc(arcId));
export const stripSettingCrossLinks = (settingId: number) => strip(docsOfSetting(settingId));
