/**
 * Что изменилось в чарнике с прошлого сохранения — по полям верхнего уровня.
 *
 * Зачем. Быстрые правки (пипс, галочка, хиты) уходят через очередь с
 * дебаунсом 400 мс, и до сих пор каждая слала весь JSON целиком. Две правки
 * в один дебаунс из разных окон сводились к «последний записавший выиграл»:
 * чужое изменение соседнего поля исчезало без следа, потому что снимка
 * отправителя оно не касалось. Сервер теперь принимает `contentPatch` и
 * кладёт его поверх сохранённого — а собрать патч можно только здесь, где
 * известно, каким лист был до правки.
 *
 * Глубины намеренно нет. Правка внутри `spellsByLevel` шлёт весь этот
 * массив: это ровно та единица, которой человек оперирует, и различать
 * «третье заклинание второго круга» значило бы завести свой формат патча
 * ради выигрыша, которого никто не заметит.
 */
export function topLevelPatch(
  baseJson: string,
  nextJson: string
): Record<string, unknown> | null {
  const base = parseObject(baseJson);
  const next = parseObject(nextJson);
  // Разобрать не вышло — патч собрать не из чего; вызывающий шлёт снимок.
  if (!base || !next) return null;

  const patch: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(next)) {
    if (JSON.stringify(value) !== JSON.stringify(base[key])) patch[key] = value;
  }
  // Убранное поле стирается явным null: без него сервер вернул бы его из
  // сохранённого, и удаление не пережило бы сохранения.
  for (const key of Object.keys(base)) {
    if (!(key in next)) patch[key] = null;
  }
  return patch;
}

function parseObject(raw: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(raw || "{}");
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
