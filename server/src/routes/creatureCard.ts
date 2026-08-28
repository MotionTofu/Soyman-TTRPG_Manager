import { Router } from "express";
import { db } from "../db/db";
import { toFileUrl } from "../services/filesystem";

export const creatureCardRouter = Router();

// Карточка существа (шаг 4 ревизии) — быстрый взгляд, который открывается на
// полотне, в докстанции пульта и в модалке меншена. Один запрос вместо трёх
// (сущность + статблок + шаблон): карточку зовут щелчком по ноде посреди боя,
// и три последовательных round-trip'а там видно глазом.
//
// Механику НЕ считаем здесь: КД, скорости, максимальный бонус атаки и СЛ
// вычисляет клиент теми же функциями, которыми рисует полный статблок
// (components/dnd/DndCreatureForm). Вторая реализация тех же формул на сервере
// разошлась бы с первой в первый же месяц.

type CardOwner = "being" | "compendium_entry";

// Обе таблицы отдают один набор полей карточки; у существа сеттинга к нему
// добавляются портрет и ссылка на шаблон, у записи бестиария их нет.
interface CardRow {
  id: number;
  name: string;
  description: string | null;
  combat_roles: string;
  tactics: string;
  secret: string | null;
  avatar_image_path?: string | null;
  base_monster_id?: number | null;
}

interface CardStatblock {
  id: number;
  kind: string;
  format: string;
  content: string;
  theme: string | null;
  density: string | null;
  avatar_image_url: string | null;
}

type StatblockRow = { avatar_image_path: string | null } & Omit<CardStatblock, "avatar_image_url">;

function parseList(raw: unknown): string[] {
  if (typeof raw !== "string" || !raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

function toCardStatblock(row: StatblockRow): CardStatblock {
  const { avatar_image_path, ...rest } = row;
  return { ...rest, avatar_image_url: avatar_image_path ? toFileUrl(avatar_image_path) : null };
}

// Первый dnd_creature: полный, если он есть, иначе краткий. Выбирать
// «активный» статблок руками — настройка ради редкого случая (шаг 4).
function pickStatblock(ownerType: CardOwner, ownerId: number): CardStatblock | null {
  const rows = db
    .prepare(
      `SELECT id, kind, format, content, theme, density, avatar_image_path
       FROM statblocks
       WHERE owner_type = ? AND owner_id = ? AND format = 'dnd_creature'
       ORDER BY CASE kind WHEN 'full' THEN 0 ELSE 1 END, id`
    )
    .all(ownerType, ownerId) as StatblockRow[];
  return rows[0] ? toCardStatblock(rows[0]) : null;
}

creatureCardRouter.get("/:type/:id", (req, res) => {
  const type = req.params.type as CardOwner;
  const id = Number(req.params.id);
  if (type !== "being" && type !== "compendium_entry") {
    return res.status(400).json({ error: "unsupported type" });
  }
  if (!Number.isFinite(id)) return res.status(400).json({ error: "bad id" });

  const row = (
    type === "being"
      ? db.prepare(
          `SELECT b.id, b.name, b.description, b.combat_roles, b.tactics, b.secret,
                  b.avatar_image_path, b.base_monster_id
           FROM setting_beings b WHERE b.id = ?`
        )
      : db.prepare(
          `SELECT ce.id, ce.name, ce.description, ce.combat_roles, ce.tactics, ce.secret
           FROM compendium_entries ce WHERE ce.id = ?`
        )
  ).get(id) as CardRow | undefined;
  if (!row) return res.status(404).json({ error: "not found" });

  // ?statblock_id=N — карточка на месте конкретного статблока: «краткий» на
  // странице существа показывает СВОЙ статблок, а не выбранный общим правилом
  // «полный, иначе краткий».
  const askedId = Number(req.query.statblock_id);
  const asked = Number.isFinite(askedId)
    ? (db
        .prepare(
          `SELECT id, kind, format, content, theme, density, avatar_image_path
           FROM statblocks WHERE id = ? AND owner_type = ? AND owner_id = ? AND format = 'dnd_creature'`
        )
        .get(askedId, type, id) as StatblockRow | undefined)
    : undefined;
  const statblock = asked ? toCardStatblock(asked) : pickStatblock(type, id);

  // Наследование от шаблона — НА ЛЕТУ, ничего не копируется в личность: копия
  // застыла бы, и правка тактики вида не дошла бы до уже созданных существ
  // (шаг 4). Секрет не наследуется никогда: он про конкретную личность, а
  // унаследованный был бы одинаков у двадцати гоблинов.
  let inherited: {
    from_id: number;
    from_name: string;
    description: string;
    combat_roles: string[];
    tactics: string[];
  } | null = null;
  const baseId = row.base_monster_id ?? null;
  if (baseId) {
    const base = db
      .prepare("SELECT id, name, description, combat_roles, tactics FROM compendium_entries WHERE id = ?")
      .get(baseId) as
      | { id: number; name: string; description: string | null; combat_roles: string; tactics: string }
      | undefined;
    if (base) {
      inherited = {
        from_id: base.id,
        from_name: base.name,
        description: base.description ?? "",
        combat_roles: parseList(base.combat_roles),
        tactics: parseList(base.tactics),
      };
    }
  }

  // Статблок берётся и у шаблона тоже: личность, склонированная с гоблина, но
  // без своего статблока, всё равно должна показывать КД и хиты гоблина — по
  // той же причине, по какой наследует тактику.
  const baseStatblock = !statblock && baseId ? pickStatblock("compendium_entry", baseId) : null;

  res.json({
    type,
    id: row.id,
    name: row.name,
    description: row.description ?? "",
    combat_roles: parseList(row.combat_roles),
    tactics: parseList(row.tactics),
    secret: row.secret ?? "",
    avatar_image_url: row.avatar_image_path ? toFileUrl(row.avatar_image_path) : null,
    statblock: statblock ?? baseStatblock,
    statblock_inherited: !statblock && !!baseStatblock,
    inherited,
  });
});
