// Состав: кто и сколько участвует — у сцены и у набора.
//
// Роль определяется РАЗЪЁМОМ, в который воткнули, а не типом воткнутого.
// Существо бывает и участником, и обстановкой («в углу спит дракон, будить не
// надо»), а локация — и местом сцены, и предметом разговора.

import { db } from "../db/db";
import { kindOf } from "../db/entityKinds";
import { entityName } from "../services/entityNames";

/**
 * Разъёмы состава. Названия — ровно те же, что у панелей пульта сессии:
 * Локации, Сюжетные персонажи, Препятствия, Потенциальный лут.
 *
 * Одно имя на весь путь, от разметки сцены до стола. Раньше у сцены был один
 * разъём «участники», который на пульте оказывался в «Препятствиях», и Мастеру
 * приходилось держать в голове это соответствие; а панели «Сюжетные персонажи»
 * сцена не наполняла вовсе. Делить участников по типу воткнутого приложение не
 * может — тот же дракон бывает и врагом, и собеседником, — поэтому решает
 * Мастер, разъёмом.
 *
 * Секции те же, что у drop-зон на странице сцены: холст и страница правят одно
 * и то же, а не заводят параллельную разметку.
 */
export const CAST_SECTIONS: Record<string, string> = {
  location: "scene_location",
  plot_characters: "scene_plot_characters",
  obstacles: "scene_obstacles",
  loot: "scene_loot",
  audio: "scene_audio",
  battle: "scene_battle",
};
// legacy sections — читаем старые данные до миграции
export const LEGACY_CAST_SECTIONS: Record<string, string> = {
  participants: "scene_participants",
  items: "scene_items",
};

/**
 * Последствия сцены — единственная связь, которая идёт ИЗ сцены наружу, а не
 * втекает в неё. Сцена не собрана из падения крепости, она его вызывает:
 * слева втекает состав, справа вытекают последствия — и ход истории, и след в
 * мире.
 *
 * Отдельно от CAST_SECTIONS потому, что в состав она не входит: у неё другой
 * смысл, другой разъём и другое место в панели.
 */
export const CONSEQUENCE_SECTION = "scene_consequences";

/** Роль по секции — обратное соответствие, для показа рёбер на холсте. */
export const CAST_ROLE_BY_SECTION: Record<string, string> = Object.fromEntries(
  Object.entries(CAST_SECTIONS).map(([role, section]) => [section, role])
);

/**
 * Количество на связи. Пустая строка убирает спутника, а не хранит пустоту:
 * «один» — умолчание, и подписывать им каждую стрелку значит зашумить схему
 * ради нуля информации.
 */
export function setLinkQty(linkId: number, qty: string): void {
  const value = qty.trim();
  if (!value) {
    db.prepare("DELETE FROM link_cast WHERE link_id = ?").run(linkId);
    return;
  }
  db.prepare(
    `INSERT INTO link_cast (link_id, qty) VALUES (?, ?)
     ON CONFLICT(link_id) DO UPDATE SET qty = excluded.qty`
  ).run(linkId, value);
}

/** Количества пачкой: id связи → строка. */
export function qtyByLink(linkIds: number[]): Map<number, string> {
  if (linkIds.length === 0) return new Map();
  const rows = db
    .prepare(
      `SELECT link_id, qty FROM link_cast WHERE link_id IN (${linkIds.map(() => "?").join(",")})`
    )
    .all(...linkIds) as { link_id: number; qty: string }[];
  return new Map(rows.map((r) => [r.link_id, r.qty]));
}

/** Имя цели связи. «#37» — если запись исчезла, а связь осталась висеть. */
export function linkTargetName(type: string, id: number): string {
  // Куда ведёт связь, по-человечески. Виды — фасет `sceneLinkTarget` в реестре
  // (набор узлового редактора и набор звука в состав сцены втыкаются наравне с
  // существом), имя — общий модуль имён.
  if (!kindOf(type)?.sceneLinkTarget) return `#${id}`;
  return entityName(type, id) ?? `#${id}`;
}
