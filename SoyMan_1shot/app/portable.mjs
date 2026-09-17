import { auditExport } from './export-audit.mjs';
export function portablePayload(character, catalog) {
  const audit = auditExport(character, catalog);
  if (audit.problems.length) throw Error(audit.problems.join('\n'));
  if (audit.externalAssets.length) throw Error('Для экспорта сначала загрузите изображения в персонажа: найдены внешние изображения.');
  for (const companion of character.content.companions || []) {
    const sourceId = companion.featureEntryId ?? companion.spellEntryId;
    if (sourceId != null) {
      const data = catalog?.entries.find(e => e.id === sourceId)?.data;
      const blueprint = data?.companion ?? data?.summon;
      if (!blueprint || typeof blueprint !== 'object' || !blueprint.hp) throw Error(`Не найден чертёж спутника «${companion.name}».`);
    } else if (companion.entryId != null) {
      throw Error(`Спутнику «${companion.name}» нужен статблок бестиария. Его автономный экспорт пока не поддержан.`);
    }
  }
  const entries = new Map(audit.candidate.entries.map(e => [e.id, e]));
  // Rules used by the sheet for conditions, damage, skills and weapon properties.
  const groups = new Set(['Состояния', 'Типы урона', 'Особое восприятие', 'Навыки', 'Свойства оружия', 'Мастерство оружия', 'Оружейные приёмы']);
  for (const parent of catalog?.entries || []) if (groups.has(parent.name)) {
    entries.set(parent.id, parent);
    for (const e of catalog.entries) if (e.parent_id === parent.id) entries.set(e.id, e);
  }
  const sectionIds = new Set([...entries.values()].map(e => e.section_id));
  const content = structuredClone(character.content);
  for (const section of content.equipmentSections || []) for (const item of section.items) { delete item.transferIn; delete item.transferOut; }
  return { format: 'soyman-1shot-portable', version: 1, exportedAt: new Date().toISOString(), character: { name: content.characterName, content, portrait: character.portrait || null }, catalog: { system: catalog?.system || null, sections: (catalog?.sections || []).filter(s => sectionIds.has(s.id)), entries: structuredClone([...entries.values()]) } };
}
export function renderPortable(template, payload) {
  if (!template.includes('__ONESHOT_PAYLOAD__')) throw Error('Повреждён шаблон автономного чарника.');
  return template.replace('__ONESHOT_PAYLOAD__', () => JSON.stringify(payload).replaceAll('<', '\\u003c'));
}
