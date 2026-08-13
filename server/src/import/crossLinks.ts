// Расстановка меншенов в тексте уже импортированных сцен.
//
// Модель ставить их почти не умеет: на четыре разобранные книги пришлось 17
// меншенов на 99 сцен. Читаешь «Мирт отправляет вас в Синий переулок» — и ни
// одно имя не нажимается, хотя обе сущности в базе есть и к сцене привязаны.
//
// Ключевое ограничение прохода: в сцене ищутся только те сущности, что уже
// связаны с ней самой — через участников, места и предметы, которые импорт
// расставляет исправно (по три-пять на сцену в каждой книге). Искать по всему
// сеттингу значило бы ловить «Вотердип» в каждой второй строке и вести «коридор»
// на одну из трёх локаций с таким именем. От этого же ограничения проход
// бесплатно получает главное: новых generic_links он не создаёт — связь, на
// которую он ссылается, уже стоит.

import { db } from "../db/db";
import { parseAliases } from "./names";

/** Поля сцены, в которых расставляются ссылки. */
const SCENE_TEXT = ["summary", "read_aloud", "whats_happening", "entry_condition", "outcomes"] as const;
type SceneField = (typeof SCENE_TEXT)[number];

const FIELD_LABELS: Record<SceneField, string> = {
  summary: "Сводка",
  read_aloud: "Зачитать вслух",
  whats_happening: "Что происходит",
  entry_condition: "Условие входа",
  outcomes: "Исходы",
};

/** Типы, чьи страницы существуют: на них и можно сослаться. */
const LINKABLE: Record<string, { table: string; hasShortName: boolean }> = {
  location: { table: "setting_locations", hasShortName: true },
  being: { table: "setting_beings", hasShortName: true },
  community: { table: "setting_communities", hasShortName: false },
  artifact: { table: "artifacts", hasShortName: true },
};

export interface CrossLinkProposal {
  sceneId: number;
  sceneName: string;
  field: SceneField;
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
  /** Отмечать ли галочкой сразу. Короткие имена — нет, см. ниже. */
  suggested: boolean;
}

interface Spelling {
  text: string;
  via: string;
  suggested: boolean;
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

  const out: Candidate[] = [];
  for (const row of rows) {
    const meta = LINKABLE[row.type];
    if (!meta) continue;
    const entity = db
      .prepare(
        `SELECT name, ${meta.hasShortName ? "short_name" : "'' AS short_name"},
                aliases, name_original
           FROM ${meta.table} WHERE id = ? AND archived_at IS NULL`
      )
      .get(row.id) as
      | { name: string; short_name: string | null; aliases: string; name_original: string }
      | undefined;
    if (!entity) continue;
    // Короткое имя заведено для подписи пина на карте, а не для прозы, и часто
    // это простое существительное: у локации «2. Фреска увечий» оно «Фреска»,
    // у «Карты сокровищ» — «Карта». В тексте такие слова стоят сами по себе
    // чаще, чем в значении сущности, поэтому находка по ним показывается, но
    // галочкой сразу не отмечается.
    const spellings: Spelling[] = [
      { text: entity.name, via: "название", suggested: true },
      { text: entity.name_original ?? "", via: "оригинал", suggested: true },
      ...parseAliases(entity.aliases).map((a) => ({
        text: a,
        via: "синоним",
        suggested: true,
      })),
      { text: entity.short_name ?? "", via: "короткое имя", suggested: false },
    ]
      .map((s) => ({ ...s, text: s.text.trim() }))
      .filter((s) => s.text.length >= 4);
    if (!spellings.length) continue;
    // Длинные написания вперёд: «Синий переулок» должен побеждать «Синий».
    spellings.sort((a, b) => b.text.length - a.text.length);
    out.push({ ref: `${row.type}:${row.id}`, name: entity.name, spellings });
  }
  return out;
}

interface SceneRow {
  id: number;
  name: string;
  summary: string;
  read_aloud: string;
  whats_happening: string;
  entry_condition: string;
  outcomes: string;
}

/** Сцены приключения вместе с его главами. Только оригиналы сеттинга. */
function scenesOfArc(arcId: number): SceneRow[] {
  return db
    .prepare(
      `SELECT s.id, s.name, s.summary, s.read_aloud, s.whats_happening, s.entry_condition, s.outcomes
         FROM story_scenes s
         JOIN story_arcs a ON a.id = s.arc_id
        WHERE (a.id = ? OR a.parent_id = ?)
          AND a.archived_at IS NULL
          AND s.campaign_id IS NULL AND s.archived_at IS NULL
        ORDER BY s.position, s.id`
    )
    .all(arcId, arcId) as SceneRow[];
}

const CONTEXT = 60;

/**
 * Что проход предлагает расставить. Ничего не пишет: находки показываются
 * человеку, и он решает — как на экране сверки при импорте.
 */
export function planCrossLinks(arcId: number): CrossLinkProposal[] {
  const proposals: CrossLinkProposal[] = [];
  for (const scene of scenesOfArc(arcId)) {
    const candidates = candidatesForScene(scene.id);
    if (!candidates.length) continue;
    for (const field of SCENE_TEXT) {
      const text = scene[field] ?? "";
      if (!text.trim()) continue;
      const busy = mentionSpans(text);
      // Занятые куски копятся по ходу: две находки не должны накладываться,
      // а первой идёт та, что нашлась более длинным написанием.
      for (const candidate of candidates) {
        for (const spelling of candidate.spellings) {
          const hits = findSpelling(text, spelling.text);
          if (!hits.length) continue;
          // Одна ссылка на сущность в поле: текст, где имя размечено пять раз
          // подряд, читать невозможно.
          const hit = hits.find(
            (h) => !busy.some((b) => h.start < b.end && b.start < h.end)
          );
          if (!hit) continue;
          busy.push(hit);
          proposals.push({
            sceneId: scene.id,
            sceneName: scene.name,
            field,
            fieldLabel: FIELD_LABELS[field],
            ref: candidate.ref,
            targetName: candidate.name,
            matched: text.slice(hit.start, hit.end),
            via: spelling.via,
            suggested: spelling.suggested,
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

export interface CrossLinkChoice {
  sceneId: number;
  field: SceneField;
  ref: string;
  matched: string;
}

/**
 * Записывает выбранное. Ищется всё заново по тому же правилу: между показом и
 * подтверждением текст мог измениться, и подставлять меншен по запомненному
 * смещению значило бы попасть в середину чужого слова.
 */
export function applyCrossLinks(arcId: number, chosen: CrossLinkChoice[]): { written: number } {
  const wanted = new Set(chosen.map((c) => `${c.sceneId}|${c.field}|${c.ref}|${c.matched}`));
  const run = db.transaction(() => {
    let written = 0;
    for (const proposal of planCrossLinks(arcId)) {
      const id = `${proposal.sceneId}|${proposal.field}|${proposal.ref}|${proposal.matched}`;
      if (!wanted.has(id)) continue;
      const row = db
        .prepare(`SELECT ${proposal.field} AS value FROM story_scenes WHERE id = ?`)
        .get(proposal.sceneId) as { value: string } | undefined;
      if (!row) continue;
      const hits = findSpelling(row.value, proposal.matched);
      const busy = mentionSpans(row.value);
      const hit = hits.find((h) => !busy.some((b) => h.start < b.end && b.start < h.end));
      if (!hit) continue;
      const next =
        row.value.slice(0, hit.start) +
        `[[${proposal.ref}|${row.value.slice(hit.start, hit.end)}]]` +
        row.value.slice(hit.end);
      db.prepare(`UPDATE story_scenes SET ${proposal.field} = ? WHERE id = ?`).run(
        next,
        proposal.sceneId
      );
      written++;
    }
    return { written };
  });
  return run();
}

/** Снятие всех меншенов сцен приключения: подпись остаётся, ссылка уходит. */
export function stripCrossLinks(arcId: number): { removed: number } {
  const run = db.transaction(() => {
    let removed = 0;
    for (const scene of scenesOfArc(arcId)) {
      for (const field of SCENE_TEXT) {
        const text = scene[field] ?? "";
        if (!text.includes("[[")) continue;
        const next = text.replace(/\[\[[^\]|]+\|([^\]]*)\]\]/g, (_, label: string) => {
          removed++;
          return label;
        });
        db.prepare(`UPDATE story_scenes SET ${field} = ? WHERE id = ?`).run(next, scene.id);
      }
    }
    return { removed };
  });
  return run();
}
