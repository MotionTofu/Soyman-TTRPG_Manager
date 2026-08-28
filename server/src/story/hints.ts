// Тихие подсказки на нодах холста (блок G1).
//
// Одно вычисление, две подачи: приглушённый чип на ноде сцены («что я забыл»)
// и счётчик с обходом в тулбаре («где структуризация не дошла»). Второе нужно
// потому, что 183 сцены из 202 на живой базе пришли импортом и доводятся
// руками: без счётчика и прыжка Мастер чинит то, что попалось на глаза, а
// холст на 91 сцену глазами не обойти.
//
// Отбор проверок идёт по двум условиям СРАЗУ, а не по частоте срабатывания:
//   1) отсутствие — в самом деле дефект, а не законный вариант;
//   2) чинится на месте, жестом на холсте, а не походом в другой раздел.
// По условию 1 выброшена главная кандидатка — «нет исходящих переходов»: она
// зажигается на 130 сценах из 202, но порядок сцен внутри приключения держится
// на `position`, а не на стрелках, и линейная глава законно живёт без единой.
// Осталось четыре проверки, см. SCENE_HINT_KINDS.
//
// Частота срабатывания как критерий отбора не годится вовсе: она описывает
// качество импортёра, а не работу Мастера (183 сцены пришли восемью батчами
// 13–14 августа). Тот же урок стоит в CanvRevision.md про updated_at.

import { db } from "../db/db";
import { CAST_SECTIONS } from "./cast";

/**
 * Виды подсказок. `rare` отделяет точечные дыры от массовой доводки импорта:
 * обход счётчика идёт сперва по редким, иначе два `branch` без выхода утонут
 * в двух десятках сцен без локации и не попадутся Мастеру никогда.
 */
export const SCENE_HINT_KINDS = {
  no_place: { rare: false, label: "Нет места" },
  branch_dead_end: { rare: true, label: "Развилка никуда не ведёт" },
  outcome_no_target: { rare: true, label: "У исхода проверки нет цели" },
  mentioned_not_cast: { rare: false, label: "Упомянут, но не в составе" },
} as const;

export type SceneHintKind = keyof typeof SCENE_HINT_KINDS;

export interface SceneHint {
  kind: SceneHintKind;
  /** Готовый текст для чипа и подсказки при наведении. */
  text: string;
  /** Заполнено только у `mentioned_not_cast` — то, что можно заглушить. */
  entity_type?: string;
  entity_id?: number;
}

/** Подсказки одной сцены. Сцены без единой подсказки в ответ не попадают. */
export interface SceneHints {
  scene_id: number;
  hints: SceneHint[];
}

interface HintSceneRow {
  id: number;
  kind: string;
  name: string;
  summary: string;
  read_aloud: string;
  whats_happening: string;
  outcomes: string;
  entry_condition: string;
  /** Оригинал сеттинга у копии кампании: заглушки живут на нём. */
  source_scene_id: number | null;
}

/** Слова русского и латиницы. Дефис делит: «Полу-эльф» ищется по обоим словам. */
const WORD_RE = /[0-9A-Za-zЀ-ӿԀ-ԯ]+/gu;

function words(text: string): string[] {
  return (text.match(WORD_RE) ?? []).map((w) => w.toLowerCase());
}

/**
 * Имена сеттинга, по которым ищем упоминания. Ключ — имя, разобранное в
 * слова: сравнение идёт по словам, а не подстрокой, иначе «Ара» находится
 * внутри «характера». Короче четырёх букв не берём совсем.
 */
function nameIndex(settingId: number): { index: Map<string, { type: string; id: number; name: string }>; maxWords: number } {
  const specs: [string, string][] = [
    ["being", "setting_beings"],
    ["location", "setting_locations"],
    ["artifact", "artifacts"],
    ["community", "setting_communities"],
  ];
  const index = new Map<string, { type: string; id: number; name: string }>();
  let maxWords = 1;
  specs.forEach(([type, table]) => {
    const rows = db
      .prepare(`SELECT id, name FROM ${table} WHERE setting_id = ? AND name IS NOT NULL AND TRIM(name) <> ''`)
      .all(settingId) as { id: number; name: string }[];
    rows.forEach((r) => {
      if (r.name.trim().length < 4) return;
      const key = words(r.name).join(" ");
      if (!key) return;
      const n = key.split(" ").length;
      if (n > maxWords) maxWords = n;
      // Первое имя выигрывает: два тёзки в одном сеттинге — забота Мастера, а
      // подсказка на обоих означала бы два чипа про одно слово в тексте.
      if (!index.has(key)) index.set(key, { type, id: r.id, name: r.name });
    });
  });
  return { index, maxWords };
}

/**
 * Считает подсказки для набора сцен. Ничего не пишет в базу — ровно по уроку
 * из CanvRevision.md: чтение доски раньше делало три записи на каждый клик.
 */
export function sceneHints(scenes: HintSceneRow[], settingId: number | null): SceneHints[] {
  if (scenes.length === 0) return [];
  const ids = scenes.map((s) => s.id);
  const ph = ids.map(() => "?").join(",");

  // Место сцены.
  const placed = new Set(
    (
      db
        .prepare(
          `SELECT DISTINCT from_id AS id FROM generic_links
           WHERE from_type = 'scene' AND section = ? AND from_id IN (${ph})`
        )
        .all(CAST_SECTIONS.location, ...ids) as { id: number }[]
    ).map((r) => r.id)
  );

  // Что уже воткнуто в состав — по всем разъёмам сразу: упоминание закрыто
  // любым из них, роль здесь не важна.
  const cast = new Map<number, Set<string>>();
  (
    db
      .prepare(
        `SELECT from_id, to_type, to_id FROM generic_links
         WHERE from_type = 'scene' AND from_id IN (${ph})`
      )
      .all(...ids) as { from_id: number; to_type: string; to_id: number }[]
  ).forEach((l) => {
    let set = cast.get(l.from_id);
    if (!set) cast.set(l.from_id, (set = new Set()));
    set.add(`${l.to_type}:${l.to_id}`);
  });

  // Развилка без выхода: вид выставлен рукой и заявляет ветвление.
  const hasOut = new Set(
    (
      db
        .prepare(
          `SELECT DISTINCT from_scene_id AS id FROM story_scene_transitions WHERE from_scene_id IN (${ph})`
        )
        .all(...ids) as { id: number }[]
    ).map((r) => r.id)
  );

  // Исходы проверок: считаем только те проверки, где цель проставлена хотя бы
  // у одного исхода. «Две двери проставил, третью забыл» — дефект; ни одной
  // не проставил — ещё не начатая работа, и чип об этом молчит.
  const outcomeGap = new Map<number, number>();
  (
    db
      .prepare(
        `SELECT c.scene_id, c.id AS check_id,
                SUM(CASE WHEN o.target_id IS NULL THEN 1 ELSE 0 END) AS empty,
                SUM(CASE WHEN o.target_id IS NULL THEN 0 ELSE 1 END) AS filled
         FROM story_scene_checks c
         JOIN story_check_outcomes o ON o.check_id = c.id
         WHERE c.scene_id IN (${ph})
         GROUP BY c.id`
      )
      .all(...ids) as { scene_id: number; check_id: number; empty: number; filled: number }[]
  ).forEach((r) => {
    if (r.filled > 0 && r.empty > 0) outcomeGap.set(r.scene_id, (outcomeGap.get(r.scene_id) ?? 0) + r.empty);
  });

  // Заглушки «это не оно». Ключ — оригинал сеттинга: оборот речи одинаков во
  // всех кампаниях, и глушить его по разу на кампанию — издевательство.
  const dismissKeys = scenes.map((s) => s.source_scene_id ?? s.id);
  const dPh = dismissKeys.map(() => "?").join(",");
  const dismissed = new Set(
    (
      db
        .prepare(`SELECT scene_id, entity_type, entity_id FROM scene_hint_dismissals WHERE scene_id IN (${dPh})`)
        .all(...dismissKeys) as { scene_id: number; entity_type: string; entity_id: number }[]
    ).map((r) => `${r.scene_id}:${r.entity_type}:${r.entity_id}`)
  );

  // Заглушённые на весь сеттинг (Н13): выбрасываются из словаря имён СРАЗУ, а
  // не отсеиваются на выходе, — иначе «Вотердип» продолжал бы перебираться на
  // каждой сцене ради того, чтобы быть отброшенным.
  const { index, maxWords } =
    settingId == null ? { index: new Map<string, { type: string; id: number; name: string }>(), maxWords: 1 } : nameIndex(settingId);
  if (settingId != null && index.size > 0) {
    const muted = new Set(
      (
        db
          .prepare("SELECT entity_type, entity_id FROM setting_hint_mutes WHERE setting_id = ?")
          .all(settingId) as { entity_type: string; entity_id: number }[]
      ).map((r) => `${r.entity_type}:${r.entity_id}`)
    );
    if (muted.size > 0) {
      [...index.entries()].forEach(([key, e]) => {
        if (muted.has(`${e.type}:${e.id}`)) index.delete(key);
      });
    }
  }

  const out: SceneHints[] = [];
  scenes.forEach((s) => {
    const hints: SceneHint[] = [];

    if (!placed.has(s.id) && s.kind !== "ending") {
      // У концовки места чаще не нужно, чем нужно, — единственное исключение.
      hints.push({ kind: "no_place", text: SCENE_HINT_KINDS.no_place.label });
    }
    if (s.kind === "branch" && !hasOut.has(s.id)) {
      hints.push({ kind: "branch_dead_end", text: SCENE_HINT_KINDS.branch_dead_end.label });
    }
    const gap = outcomeGap.get(s.id);
    if (gap) {
      hints.push({
        kind: "outcome_no_target",
        text: gap === 1 ? "У исхода проверки нет цели" : `Без цели исходов: ${gap}`,
      });
    }

    if (index.size > 0) {
      const text = [s.name, s.summary, s.read_aloud, s.whats_happening, s.outcomes, s.entry_condition]
        .filter(Boolean)
        .join(" ");
      const toks = words(text);
      const seen = new Set<string>();
      const dismissKey = s.source_scene_id ?? s.id;
      const linked = cast.get(s.id) ?? new Set<string>();
      for (let i = 0; i < toks.length; i += 1) {
        for (let len = 1; len <= maxWords && i + len <= toks.length; len += 1) {
          const found = index.get(toks.slice(i, i + len).join(" "));
          if (!found) continue;
          const key = `${found.type}:${found.id}`;
          if (seen.has(key) || linked.has(key)) continue;
          if (dismissed.has(`${dismissKey}:${key}`)) continue;
          seen.add(key);
          hints.push({
            kind: "mentioned_not_cast",
            text: `${found.name} — упомянут, но не в составе`,
            entity_type: found.type,
            entity_id: found.id,
          });
        }
      }
    }

    if (hints.length > 0) out.push({ scene_id: s.id, hints });
  });
  return out;
}

/** Колонки, которых `sceneHints` ждёт от строки сцены. */
export const HINT_SCENE_COLUMNS =
  "id, kind, name, summary, read_aloud, whats_happening, outcomes, entry_condition, source_scene_id";
