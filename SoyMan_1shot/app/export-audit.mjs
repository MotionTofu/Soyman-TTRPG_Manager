// This inventory deliberately does not certify a runnable export. Assets and
// indirect rule dependencies must be resolved before the HTML builder can run.
const entryKeys = new Set(['entryId', 'classId', 'subclassId', 'raceId', 'backgroundId', 'sourceParentId', 'featureEntryId', 'spellEntryId', 'schemeEntryId', 'baseEntryId']);
export function auditExport(character, catalog) {
  const problems = [];
  const references = new Map();
  const externalAssets = new Set();
  function visit(value, path = 'Персонаж') {
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      const where = `${path}.${key}`;
      if (entryKeys.has(key) && child != null) {
        if (!Number.isSafeInteger(child) || child <= 0) problems.push(`Некорректная ссылка: ${where}`);
        else if (!references.has(child)) references.set(child, where);
      }
      if (key === 'statblockId' && child != null) problems.push('Спутнику нужен отдельный статблок: он ещё не включён в переносимый пакет.');
      if (typeof child === 'string') {
        for (const match of child.matchAll(/(?:src\s*=\s*["']|!\[[^\]]*\]\()([^"'\s)>]+)/gi)) {
          if (!match[1].startsWith('data:')) externalAssets.add(match[1]);
        }
      } else visit(child, where);
    }
  }
  visit(character.content);
  if (character.portrait && !/^data:image\/(png|jpeg|webp);base64,/.test(character.portrait)) externalAssets.add(character.portrait);
  const index = new Map((catalog?.entries || []).map(e => [e.id, e]));
  const selected = new Map();
  const visiting = new Set();
  function include(id) {
    if (selected.has(id)) return;
    if (visiting.has(id)) { problems.push(`Зациклена связь записей справочника: ${id}`); return; }
    const entry = index.get(id);
    if (!entry) { problems.push(`Не найдена запись справочника №${id} (${references.get(id) || 'родитель записи'}).`); return; }
    visiting.add(id);
    if (entry.parent_id != null) include(entry.parent_id);
    visiting.delete(id);
    selected.set(id, entry);
    if (entry.kind === 'spell' && (!Number.isInteger(entry.level) || entry.level < 0 || entry.level > 9)) problems.push(`Не определён круг заклинания «${entry.name}».`);
    // Inspect media only: option lists on a class are not selected dependencies.
    function media(value) {
      if (typeof value === 'string') {
        for (const match of value.matchAll(/(?:src\s*=\s*["']|!\[[^\]]*\]\()([^"'\s)>]+)/gi)) if (!match[1].startsWith('data:')) externalAssets.add(match[1]);
      } else if (value && typeof value === 'object') Object.values(value).forEach(media);
    }
    media(entry.data); media(entry.description);
  }
  for (const id of references.keys()) include(id);
  const entries = [...selected.values()].sort((a, b) => a.id - b.id);
  const sections = new Set(entries.map(e => e.section_id));
  const counts = {};
  for (const entry of entries) counts[entry.kind] = (counts[entry.kind] || 0) + 1;
  return {
    format: 'soyman-1shot-export-audit', version: 1,
    entryCount: entries.length, totalEntryCount: catalog?.entries.length || 0,
    counts, problems: [...new Set(problems)], externalAssets: [...externalAssets],
    // Candidate slice, not the final format: no unrelated catalog entries.
    candidate: { system: catalog?.system || null, sections: (catalog?.sections || []).filter(s => sections.has(s.id)), entries: structuredClone(entries) },
  };
}
