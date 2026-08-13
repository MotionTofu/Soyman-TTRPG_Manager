// Подбор монстра из компендиума системы для записи бестиария.
//
// В файле книги у монстра есть compendium_hints — как он называется в системе
// («Гоблин-воин»). Формат обещает, что импортёр попробует найти их и предложит
// связать; здесь это и делается.
//
// Сеттинг с системой не связан: у settings нет system_id, а Вотердип живёт
// одновременно в кампании на D&D 5.5 и в кампании на Legend in the Mist.
// Поэтому искать надо в компендиумах всех систем, до которых дотягиваются
// кампании сеттинга, — ровно поэтому being_compendium_links и сделана
// многие-ко-многим. Автоматически ничего не связывается: выбор за человеком.

import { db } from "../db/db";
import { NameMatch, normalizeName, similarity } from "./names";

interface Candidate {
  id: number;
  name: string;
  system: string;
  /** Все написания, по которым эту запись можно узнать. */
  names: string[];
}

/**
 * Имена компендиума несут оригинал в скобках: «Нимблрайт [Nimblewright]»,
 * «Гоблин–пси-командир [Goblin Psi Commander] PBSO». Искать нужно по обеим
 * половинам: перевод книги совпадёт с русской, name_original — с английской.
 */
function spellings(name: string): string[] {
  const out = [name];
  const bracket = name.match(/\[([^\]]+)\]/);
  if (bracket) {
    out.push(bracket[1]);
    // Хвост после скобки — пометка источника вроде «PBSO», не часть имени.
    out.push(name.slice(0, bracket.index).trim());
  }
  return out.filter((n) => n.trim());
}

/** Записи бестиария всех систем, в которых водят кампании по этому сеттингу. */
export function compendiumCandidates(settingId: number | null): Candidate[] {
  if (settingId == null) return [];
  const rows = db
    .prepare(
      `SELECT e.id, e.name, sys.name AS system
         FROM compendium_entries e
         JOIN systems sys ON sys.id = e.system_id
        WHERE e.kind = 'monster'
          AND e.system_id IN (SELECT DISTINCT system_id FROM campaigns WHERE setting_id = ?)
        ORDER BY sys.name, e.name`
    )
    .all(settingId) as { id: number; name: string; system: string }[];
  return rows.map((row) => ({ ...row, names: spellings(row.name) }));
}

/**
 * Кандидаты для одной записи бестиария. Точные совпадения показываются все;
 * похожие — только если точных не нашлось вовсе, иначе «похоже» лишь мусорит
 * рядом с уверенным попаданием. Порог тот же, что на экране сверки.
 */
export function matchCompendium(names: string[], candidates: Candidate[]): NameMatch[] {
  const wanted = names.filter((n) => n && n.trim());
  if (!wanted.length) return [];

  const exact: NameMatch[] = [];
  const seen = new Set<number>();
  for (const candidate of candidates) {
    const hit = candidate.names.find((cn) =>
      wanted.some((w) => normalizeName(w) === normalizeName(cn))
    );
    if (!hit) continue;
    seen.add(candidate.id);
    exact.push({
      ref: `compendium:${candidate.id}`,
      name: candidate.name,
      hint: candidate.system,
      reason: "совпадает название в компендиуме",
      exact: true,
    });
  }
  if (exact.length) return exact;

  const fuzzy: (NameMatch & { score: number })[] = [];
  for (const candidate of candidates) {
    if (seen.has(candidate.id)) continue;
    let score = 0;
    for (const w of wanted) for (const cn of candidate.names) score = Math.max(score, similarity(w, cn));
    if (score >= 0.5) {
      fuzzy.push({
        ref: `compendium:${candidate.id}`,
        name: candidate.name,
        hint: candidate.system,
        reason: "похоже по написанию",
        exact: false,
        score,
      });
    }
  }
  fuzzy.sort((a, b) => b.score - a.score);
  return fuzzy.slice(0, 3).map(({ score, ...match }) => {
    void score;
    return match;
  });
}

/**
 * Отсев идентификаторов, пришедших с экрана сверки: связать запись бестиария
 * можно только с монстром системы, в которую сеттинг действительно играет.
 * Клиент присылает то, что показали ему мы, но проверить дешевле, чем потом
 * искать в базе связь на монстра из чужой системы.
 */
export function validCompendiumIds(settingId: number, ids: number[]): number[] {
  const wanted = [...new Set(ids.filter((id) => Number.isInteger(id) && id > 0))];
  if (!wanted.length) return [];
  const allowed = new Set(compendiumCandidates(settingId).map((c) => c.id));
  return wanted.filter((id) => allowed.has(id));
}
