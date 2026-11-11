import { randomUUID } from "crypto";
import { Router } from "express";
import { z } from "zod";
import { db } from "../db/db";

// Верстак — единственный сохраняемый черновик печати (гриллинг 2026-11-11,
// В1–В18; .scratch/web-sources/extension-decisions.md). Сервер хранит блоки и
// их порядок; листы раскладывает клиент, потому что высоту текста знает только
// вёрстка. Только Мастер: игрокам общий гейт /api этот путь не открывает.

export const workbenchRouter = Router();

export interface WorkbenchBlock {
  id: string;
  position: number;
  kind: "fragment" | "card" | "text" | "page_break";
  width: "full" | "half";
  title: string;
  text: string;
  url: string | null;
  page_title: string | null;
  captured_at: string | null;
  show_source: number;
  entry_id: number | null;
  card_mode: string | null;
  client_id: string | null;
  revision: number;
  created_at: string;
  updated_at: string;
}

const CARD_MODES = ["description", "card"] as const;
const nextPosition = () =>
  (db.prepare("SELECT COALESCE(MAX(position), -1) + 1 AS p FROM workbench_blocks").get() as { p: number }).p;
const getBlock = (id: string) => db.prepare("SELECT * FROM workbench_blocks WHERE id = ?").get(id) as WorkbenchBlock | undefined;
export const workbenchCount = () => (db.prepare("SELECT COUNT(*) AS n FROM workbench_blocks").get() as { n: number }).n;

export interface FragmentInput {
  client_id?: string | null;
  url: string;
  page_title: string;
  heading: string;
  text: string;
  captured_at: string;
  title?: string;
  show_source?: boolean;
}

/**
 * Фрагмент с сайта — в конец черновика. Заголовок по умолчанию — главный
 * заголовок страницы (В16). Тот же client_id второй раз ничего не добавляет:
 * очередь расширения повторяет отправку, пока не получит ответ.
 */
export function addFragment(input: FragmentInput): { id: string; duplicate: boolean } {
  if (input.client_id) {
    const existing = db.prepare("SELECT id FROM workbench_blocks WHERE client_id = ?").get(input.client_id) as { id: string } | undefined;
    if (existing) return { id: existing.id, duplicate: true };
  }
  const id = randomUUID();
  db.prepare(`INSERT INTO workbench_blocks (id, position, kind, title, text, url, page_title, captured_at, show_source, client_id)
    VALUES (?, ?, 'fragment', ?, ?, ?, ?, ?, ?, ?)`).run(
    id, nextPosition(), (input.title ?? input.heading).trim().slice(0, 300), input.text.trim(), input.url,
    input.page_title.trim(), input.captured_at, input.show_source ? 1 : 0, input.client_id ?? null);
  return { id, duplicate: false };
}

workbenchRouter.get("/blocks", (_req, res) => {
  res.json(db.prepare("SELECT * FROM workbench_blocks ORDER BY position, created_at").all());
});

const newBlockInput = z.object({ kind: z.enum(["text", "page_break"]) });

// «+ Свой текст» и «+ С новой страницы» (В7).
workbenchRouter.post("/blocks", (req, res) => {
  const parsed = newBlockInput.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Можно добавить свой текст или разрыв страницы" });
  const id = randomUUID();
  db.prepare("INSERT INTO workbench_blocks (id, position, kind) VALUES (?, ?, ?)").run(id, nextPosition(), parsed.data.kind);
  res.status(201).json(getBlock(id));
});

const cardsInput = z.object({ entry_ids: z.array(z.number().int().positive()).min(1).max(500) });

// Мешок и компендиум добавляют карточки; те, что уже на верстаке, второй раз
// не попадают (В10).
workbenchRouter.post("/cards", (req, res) => {
  const parsed = cardsInput.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Нет записей компендиума" });
  const added = db.transaction(() => {
    const have = new Set((db.prepare("SELECT entry_id FROM workbench_blocks WHERE kind = 'card'").all() as { entry_id: number }[]).map((r) => r.entry_id));
    const exists = db.prepare("SELECT kind FROM compendium_entries WHERE id = ?");
    const insert = db.prepare("INSERT INTO workbench_blocks (id, position, kind, width, entry_id, card_mode) VALUES (?, ?, 'card', 'half', ?, 'card')");
    let position = nextPosition();
    let n = 0;
    for (const entryId of new Set(parsed.data.entry_ids)) {
      if (have.has(entryId) || !exists.get(entryId)) continue;
      insert.run(randomUUID(), position++, entryId);
      n++;
    }
    return n;
  })();
  res.json({ added, count: workbenchCount() });
});

const patchInput = z.object({
  width: z.enum(["full", "half"]).optional(),
  title: z.string().max(300).optional(),
  text: z.string().max(200_000).optional(),
  show_source: z.boolean().optional(),
  card_mode: z.enum(CARD_MODES).optional(),
  // Правка текста идёт от версии, которую видел Мастер. Если другое окно
  // успело сохранить своё, сервер отказывает и отдаёт текущий блок (В12).
  base_revision: z.number().int().optional(),
  force: z.boolean().optional(),
});

workbenchRouter.put("/blocks/:id", (req, res) => {
  const parsed = patchInput.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Неверная правка блока" });
  const patch = parsed.data;
  const block = getBlock(req.params.id);
  if (!block) return res.status(404).json({ error: "Блока уже нет на верстаке" });
  const textual = patch.title !== undefined || patch.text !== undefined;
  if (textual && !patch.force && patch.base_revision !== block.revision) return res.status(409).json({ block });
  const sets: string[] = [];
  const args: unknown[] = [];
  const put = (column: string, value: unknown) => { sets.push(`${column} = ?`); args.push(value); };
  if (patch.width !== undefined) put("width", patch.width);
  if (patch.title !== undefined) put("title", patch.title.trim());
  if (patch.text !== undefined) put("text", patch.text);
  if (patch.show_source !== undefined) put("show_source", patch.show_source ? 1 : 0);
  if (patch.card_mode !== undefined) put("card_mode", patch.card_mode);
  if (!sets.length) return res.json(block);
  db.prepare(`UPDATE workbench_blocks SET ${sets.join(", ")}, revision = revision + 1, updated_at = datetime('now') WHERE id = ?`)
    .run(...args, block.id);
  res.json(getBlock(block.id));
});

const orderInput = z.object({ ids: z.array(z.string()).max(5000) });

workbenchRouter.put("/order", (req, res) => {
  const parsed = orderInput.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Неверный порядок" });
  db.transaction(() => {
    const set = db.prepare("UPDATE workbench_blocks SET position = ? WHERE id = ?");
    parsed.data.ids.forEach((id, index) => set.run(index, id));
  })();
  res.json({ ok: true });
});

// «Убрать» отдаёт блок целиком: плашка «Вернуть» кладёт его обратно (В18).
workbenchRouter.delete("/blocks/:id", (req, res) => {
  const block = getBlock(req.params.id);
  if (!block) return res.status(404).json({ error: "Блока уже нет на верстаке" });
  db.prepare("DELETE FROM workbench_blocks WHERE id = ?").run(block.id);
  res.json(block);
});

const restoreInput = z.object({
  id: z.string().min(1).max(64),
  position: z.number(),
  kind: z.enum(["fragment", "card", "text", "page_break"]),
  width: z.enum(["full", "half"]),
  title: z.string().max(300),
  text: z.string().max(200_000),
  url: z.string().max(4096).nullable(),
  page_title: z.string().max(1000).nullable(),
  captured_at: z.string().max(40).nullable(),
  show_source: z.number().int(),
  entry_id: z.number().int().nullable(),
  card_mode: z.enum(CARD_MODES).nullable(),
  client_id: z.string().max(64).nullable(),
});

workbenchRouter.post("/blocks/restore", (req, res) => {
  const parsed = restoreInput.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Блок не вернуть" });
  const b = parsed.data;
  if (getBlock(b.id)) return res.json(getBlock(b.id));
  // client_id мог уже занять повтор из расширения — тогда без него.
  const clientId = b.client_id && !db.prepare("SELECT 1 FROM workbench_blocks WHERE client_id = ?").get(b.client_id) ? b.client_id : null;
  db.prepare(`INSERT INTO workbench_blocks (id, position, kind, width, title, text, url, page_title, captured_at, show_source, entry_id, card_mode, client_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(b.id, b.position, b.kind, b.width, b.title, b.text, b.url, b.page_title,
    b.captured_at, b.show_source ? 1 : 0, b.entry_id, b.card_mode, clientId);
  res.status(201).json(getBlock(b.id));
});

// «Очистить верстак» (В6) — подтверждение на клиенте.
workbenchRouter.delete("/blocks", (_req, res) => {
  db.prepare("DELETE FROM workbench_blocks").run();
  res.json({ ok: true });
});
