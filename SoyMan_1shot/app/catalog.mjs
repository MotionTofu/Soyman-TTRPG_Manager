// Only the catalog is accepted here; no campaign or account records are imported.
// Canonical artifact serialization shared by the node-only release builder
// (catalog-release.mjs) and the browser runtime (catalog-manager.mjs): plain
// JSON, no node:crypto, so importing this module never pulls node builtins
// into the browser bundle (vite dev serves CJS as-is and crashes on them,
// while the production bundler merely tree-shakes them away).
export function serializeArtifact(value) {
  return JSON.stringify(value);
}
export function repairSpellLevels(catalog, reference) {
  const known = new Map(reference.entries.map(e => [e.id, e]));
  return { ...catalog, entries: catalog.entries.map(e => {
    const source = known.get(e.id);
    return e.kind === 'spell' && e.level == null && source?.kind === 'spell' && source.name === e.name && Number.isInteger(source.level)
      ? { ...e, level: source.level } : e;
  }) };
}
export function parseCatalog(input) {
  if (!input || typeof input !== 'object' || !input.system || !Array.isArray(input.sections) || !Array.isArray(input.entries)) throw Error('Нужна JSON-выгрузка системы из SoyMan');
  if (typeof input.system.name !== 'string' || !(/d&d|днд/i.test(input.system.name) || ['phb', 'dnd55'].includes(input.system.code))) throw Error('Выберите выгрузку D&D 5.5');
  if (input.entries.length > 50000 || input.sections.length > 1000) throw Error('Справочник слишком большой');
  const ids = new Set(), sections = new Set();
  const cleanSections = input.sections.map(s => {
    if (!Number.isSafeInteger(s.id) || sections.has(s.id) || typeof s.kind !== 'string' || typeof s.name !== 'string') throw Error('Некорректные разделы справочника');
    sections.add(s.id); return { id: s.id, system_id: 1, name: s.name, kind: s.kind, position: s.position || 0 };
  });
  const entries = input.entries.map(e => {
    if (!Number.isSafeInteger(e.id) || ids.has(e.id) || !sections.has(e.section_id) || typeof e.name !== 'string' || typeof e.kind !== 'string' || !e.data || typeof e.data !== 'object' || Array.isArray(e.data)) throw Error('Некорректные записи справочника');
    ids.add(e.id);
    const embedded = value => value && typeof value === 'object' && typeof value.mime === 'string' && typeof value.base64 === 'string'
      ? `data:${value.mime};base64,${value.base64}` : null;
    const large = typeof e.avatar_large_url === 'string' ? e.avatar_large_url : embedded(e.avatar_data);
    const preview = typeof e.avatar_preview_url === 'string' ? e.avatar_preview_url : embedded(e.avatar_preview_data) || large;
    const creature = cleanCreature(e.creature);
    // Глобальный ключ — цель ссылок [[compendium_entry@…]] в описаниях.
    // Каталог приходит и импортом, поэтому формат проверяется.
    const uid = typeof e.uid === 'string' && /^[0-9a-f]{8}(-?[0-9a-f]{4}){3}-?[0-9a-f]{12}$/i.test(e.uid) ? e.uid.toLowerCase() : null;
    return { id: e.id, ...(uid ? { uid } : {}), system_id: 1, section_id: e.section_id, parent_id: e.parent_id ?? null, name: e.name, name_original: e.name_original || '', aliases: Array.isArray(e.aliases) ? e.aliases.filter(a => typeof a === 'string') : [], kind: e.kind, level: e.level ?? null, position: e.position || 0, data: structuredClone(e.data), description: typeof e.description === 'string' ? e.description : '', avatar_preview_url: preview, avatar_large_url: large, ...(creature ? { creature } : {}) };
  });
  if (entries.some(e => e.parent_id != null && !ids.has(e.parent_id))) throw Error('В справочнике отсутствует родитель записи');
  return { system: { id: 1, name: input.system.name, code: 'dnd55', description: input.system.description || '' }, sections: cleanSections, entries };
}


// Карточка существа бестиария для игрока (гриллинг 2026-09-23): то же, что
// отдаёт игроку основной SoyMan (server/src/routes/player.ts,
// /creature-card/compendium_entry) — статблок, роли, тактика. Секрета в
// справочнике нет вовсе: prepare-catalog его не выбирает.
function cleanCreature(value) {
  if (!value || typeof value !== 'object') return null;
  const list = v => Array.isArray(v) ? v.filter(x => typeof x === 'string') : [];
  const s = value.statblock;
  const statblock = s && typeof s === 'object' && s.format === 'dnd_creature' && typeof s.content === 'string'
    ? { id: Number.isSafeInteger(s.id) ? s.id : 0, kind: typeof s.kind === 'string' ? s.kind : 'full', format: 'dnd_creature', content: s.content, theme: typeof s.theme === 'string' ? s.theme : null, density: typeof s.density === 'string' ? s.density : null }
    : null;
  return { combat_roles: list(value.combat_roles), tactics: list(value.tactics), statblock };
}
// Карта глобальных ключей в формате /mentions/index основного SoyMan
// (client/src/mentions.ts): ссылки в описаниях оживают без сервера. Ключи —
// без дефисов, как в тексте ссылок (normUid).
export function mentionIndexPayload(entries) {
  return { owners: {}, entities: { compendium_entry: (entries ?? []).filter(e => typeof e.uid === 'string').map(e => [e.id, e.uid.replace(/-/g, '').toLowerCase(), null]) } };
}
export function creatureCardPayload(entry, avatarUrl) {
  const creature = entry.creature || { combat_roles: [], tactics: [], statblock: null };
  return {
    type: 'compendium_entry', id: entry.id, name: entry.name, description: entry.description || '',
    combat_roles: creature.combat_roles, tactics: creature.tactics, secret: '',
    avatar_image_url: avatarUrl ?? null,
    statblock: creature.statblock ? { ...creature.statblock, avatar_image_url: null } : null,
    statblock_inherited: false, inherited: null,
  };
}
// Поиск записей справочника вместо серверного /search: имя, синонимы и
// оригинальное название, без учёта регистра и различия ё/е.
const fold = text => String(text || '').toLocaleLowerCase('ru').replaceAll('ё', 'е');
export function searchEntries(entries, query, kinds, limit = 50) {
  const q = fold(query).trim();
  if (!q) return [];
  const wanted = kinds && kinds.length ? new Set(kinds) : null;
  const byId = new Map(entries.map(e => [e.id, e]));
  const results = [];
  for (const e of entries) {
    if (wanted && !wanted.has(e.kind)) continue;
    if (!fold([e.name, ...(e.aliases || []), e.name_original].join(' ')).includes(q)) continue;
    const parent = e.parent_id != null ? byId.get(e.parent_id)?.name : null;
    results.push({ type: 'compendium_entry', id: e.id, title: e.name, subtitle: `${e.kind}${parent ? ` · ${parent}` : ''}`, system_id: 1, section_id: e.section_id, kind: e.kind, level: e.level });
  }
  // Сначала имена, которые начинаются с запроса: «кот» — это Кот, а не …кот… в середине.
  const starts = r => (fold(r.title).startsWith(q) ? 0 : 1);
  return results.sort((a, b) => starts(a) - starts(b) || a.title.localeCompare(b.title, 'ru')).slice(0, limit);
}
