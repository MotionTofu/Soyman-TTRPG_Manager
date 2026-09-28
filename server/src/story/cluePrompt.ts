// «Предложить улики» (гриллинг «Узловой дизайн» 2026-09-28, Q28/Q29).
//
// Как импорт книги: приложение само нейросеть не зовёт. Мастер копирует
// запрос со структурой приключения во внешний чат, а ответ вставляет обратно.
// Узлы в запросе названы короткими метками S<id> / T<id> — модели проще
// сослаться на метку, чем повторить имя без опечатки.

import { db } from "../db/db";
import type { ClueGraph } from "./clues";
import { nodeCounts } from "./clues";
import { withLibraryContent } from "./library";

const cut = (s: string, n: number) => {
  const t = s.replace(/\[\[[^|\]]*\|([^\]]*)\]\]/g, "$1").replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

export function cluePrompt(graph: ClueGraph): string {
  const counts = nodeCounts(graph);
  const chapterName = new Map(
    (
      db
        .prepare(`SELECT id, name FROM story_arcs WHERE id IN (${graph.arc_ids.map(() => "?").join(",")})`)
        .all(...graph.arc_ids) as { id: number; name: string }[]
    ).map((a) => [a.id, a.name])
  );
  const secrets = db
    .prepare(
      `SELECT id, title, content FROM story_secrets WHERE arc_id IN (${graph.arc_ids.map(() => "?").join(",")})
       AND kind = 'secret' ORDER BY position, id`
    )
    .all(...graph.arc_ids) as { id: number; title: string; content: string }[];
  const label = (c: { target_type: string | null; target_id: number | null }) =>
    c.target_type === "scene" ? `S${c.target_id}` : c.target_type === "secret" ? `T${c.target_id}` : "—";

  const nodeLines: string[] = [];
  for (const n of graph.nodes.values()) {
    const row = withLibraryContent(
      db.prepare("SELECT * FROM story_scenes WHERE id = ?").get(n.shown_id) as {
        id: number;
        library_scene_id: number | null;
        summary: string;
        whats_happening: string;
      }
    );
    const c = counts.get(n.id)!;
    const exempt = n.role === "start" || n.role === "proactive" || n.role === "dead_end" || c.passage_in;
    const need = exempt ? "" : c.clue_in < 3 ? ` · НУЖНО ЕЩЁ ${3 - c.clue_in}` : "";
    const own = graph.clues
      .filter((x) => x.node_id === n.id && !x.proposed)
      .map((x) => `    улика «${cut(x.text, 80)}» → ${label(x)}`);
    nodeLines.push(
      [
        `S${n.id} «${n.name}»${n.arc_id !== graph.root_arc_id ? ` [${chapterName.get(n.arc_id as number) ?? ""}]` : ""}` +
          ` · ${n.node_type ?? "тип не задан"} · ${n.role}${n.trigger ? ` · приходит сам: ${cut(n.trigger, 120)}` : ""}` +
          ` · входящих улик ${c.clue_in}${need}`,
        `    ${cut(row.summary || row.whats_happening || "", 400) || "(описания нет)"}`,
        ...own,
      ].join("\n")
    );
  }
  const secretLines = secrets.map((t) => {
    const inbound = graph.clues.filter((x) => x.target_type === "secret" && x.target_id === t.id && !x.proposed).length;
    return `T${t.id} «${t.title}» · входящих улик ${inbound}${inbound < 3 ? ` · НУЖНО ЕЩЁ ${3 - inbound}` : ""}\n    ${cut(t.content, 300)}`;
  });

  return `Ты помогаешь мастеру настольной ролевой игры довести приключение до правила трёх улик
(Джастин Александер, «узловой дизайн»): к каждому выводу — узлу или тайне — должно вести
не меньше трёх улик, потому что партия пропустит одну, не поймёт вторую и проигнорирует третью.

Улика — то, что партия может найти в одном узле и что указывает на другой узел или раскрывает
тайну. Находят её в узле-источнике: обыскав комнату, расспросив персонажа, проследив, проверкой.
Проход (надёжный переход «после боя их уводят») — не улика, его не предлагай.

Что нужно: предложи новые улики для узлов и тайн, помеченных «НУЖНО ЕЩЁ». Каждая улика —
конкретная находка, согласная с тем, что уже происходит в узле-источнике (не противоречь его
описанию). Разнообразь способы: предмет, свидетель, наблюдение, документ, след. Не дублируй
существующие улики. Узлы с ролью start и proactive входящих улик не требуют; dead_end —
тупик, улики туда не веди.

Узлы приключения:
${nodeLines.join("\n")}

Тайны:
${secretLines.join("\n") || "(тайн нет)"}

Ответь ТОЛЬКО JSON без пояснений:
{"clues": [{"from": "S12", "to": "S15", "text": "что находят", "how": "как найти"}]}
"from" — метка узла, где улику находят (всегда S…); "to" — метка узла (S…) или тайны (T…).`;
}

/** Метки из ответа модели → id узла или тайны. */
export function parseLabel(v: unknown): { type: "scene" | "secret"; id: number } | null {
  const m = /^\s*([ST])(\d+)\s*$/i.exec(String(v ?? ""));
  if (!m) return null;
  return { type: m[1].toUpperCase() === "S" ? "scene" : "secret", id: Number(m[2]) };
}

/**
 * Ответ модели — как вставили: в ```json-обёртке, с текстом до и после.
 * Берём первый JSON-объект или массив целиком.
 */
export function parseProposals(raw: string): unknown[] | null {
  const start = raw.search(/[[{]/);
  if (start === -1) return null;
  const end = Math.max(raw.lastIndexOf("}"), raw.lastIndexOf("]"));
  try {
    const parsed = JSON.parse(raw.slice(start, end + 1)) as unknown;
    if (Array.isArray(parsed)) return parsed;
    const list = (parsed as { clues?: unknown }).clues;
    return Array.isArray(list) ? list : null;
  } catch {
    return null;
  }
}
