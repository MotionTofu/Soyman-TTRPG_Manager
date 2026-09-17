// Only the catalog is accepted here; no campaign or account records are imported.
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
    return { id: e.id, system_id: 1, section_id: e.section_id, parent_id: e.parent_id ?? null, name: e.name, name_original: e.name_original || '', aliases: Array.isArray(e.aliases) ? e.aliases.filter(a => typeof a === 'string') : [], kind: e.kind, level: e.level ?? null, position: e.position || 0, data: structuredClone(e.data), description: typeof e.description === 'string' ? e.description : '' };
  });
  if (entries.some(e => e.parent_id != null && !ids.has(e.parent_id))) throw Error('В справочнике отсутствует родитель записи');
  return { system: { id: 1, name: input.system.name, code: 'dnd55', description: input.system.description || '' }, sections: cleanSections, entries };
}

