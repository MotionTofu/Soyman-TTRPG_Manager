import { Router } from "express";
import { db } from "../db/db";

export const randomArticleRouter = Router();

/**
 * Случайная статья из «Справочника» любой системы — для блока «Напомню!» на
 * главной.
 *
 * Кандидат — запись с непустым описанием, лежащая ВНУТРИ группы: сами группы
 * верхнего уровня («Типы урона», «Состояния») тела не имеют, они контейнеры.
 * Выбор случаен среди всех кандидатов сразу, а не «сначала система, потом
 * статья»: иначе система с тремя статьями выпадала бы так же часто, как
 * система с сотней.
 *
 * `exclude` — id предыдущей показанной статьи: без него случайность рано или
 * поздно выдаёт ту же запись дважды подряд, и блок выглядит зависшим. Если
 * кроме неё кандидатов нет, она же и возвращается — пустой блок вместо
 * повтора был бы хуже.
 */
const PICK = `
  SELECT
    e.id,
    e.name,
    e.description,
    s.name AS system_name,
    sec.name AS section_name,
    p.name AS group_name,
    gp.name AS parent_group_name
  FROM compendium_entries e
  JOIN system_sections sec ON sec.id = e.section_id AND sec.kind = 'mechanics'
  JOIN systems s ON s.id = e.system_id AND s.archived_at IS NULL
  JOIN compendium_entries p ON p.id = e.parent_id
  LEFT JOIN compendium_entries gp ON gp.id = p.parent_id
  WHERE TRIM(COALESCE(e.description, '')) != ''
`;

interface Row {
  id: number;
  name: string;
  description: string;
  system_name: string;
  section_name: string;
  group_name: string | null;
  parent_group_name: string | null;
}

randomArticleRouter.get("/", (req, res) => {
  const exclude = Number(req.query.exclude);
  const pick = (skip: number | null): Row | undefined =>
    db
      .prepare(`${PICK}${skip != null ? " AND e.id != ?" : ""} ORDER BY RANDOM() LIMIT 1`)
      .get(...(skip != null ? [skip] : [])) as Row | undefined;

  const row = pick(Number.isFinite(exclude) ? exclude : null) ?? pick(null);
  if (!row) return res.json(null);

  // Путь читается сверху вниз, как в самом справочнике: без группы «Полёт» и
  // «Слепое зрение» не опознать, а раздел в одиночку — всегда одно и то же
  // слово «Справочник».
  const path = [row.system_name, row.section_name, row.parent_group_name, row.group_name].filter(
    (part): part is string => !!part
  );
  res.json({ id: row.id, name: row.name, description: row.description, path });
});
