import { auditExport } from './export-audit.mjs';
export function portablePayload(character, catalog) {
  // Common rules also need parent closure and media validation. Adding them
  // after auditing silently admitted broken links and external images.
  const groups = new Set(['Состояния', 'Типы урона', 'Особое восприятие', 'Навыки', 'Свойства оружия', 'Мастерство оружия', 'Оружейные приёмы']);
  const commonParents = new Set((catalog?.entries || []).filter(e => groups.has(e.name)).map(e => e.id));
  const commonRules = (catalog?.entries || []).filter(e => commonParents.has(e.id) || commonParents.has(e.parent_id));
  const audit = auditExport({ ...character, content: { character: character.content, commonRules: commonRules.map(e => ({ entryId: e.id })) } }, catalog);
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
  const sectionIds = new Set([...entries.values()].map(e => e.section_id));
  const content = structuredClone(character.content);
  for (const section of content.equipmentSections || []) for (const item of section.items) { delete item.transferIn; delete item.transferOut; }
  const portableEntries = structuredClone([...entries.values()]);
  // Однофайловый лист хранит только правила, нужные персонажу. Карты классов
  // и видов намеренно не раздувают HTML ни превью, ни большими лицами.
  for (const entry of portableEntries) {
    delete entry.avatar_preview_url;
    delete entry.avatar_large_url;
    delete entry.avatar_image_url;
    delete entry.avatar_preview_data;
    delete entry.avatar_data;
  }
  return { format: 'soyman-1shot-portable', version: 1, exportedAt: new Date().toISOString(), character: { name: content.characterName, content, portrait: character.portrait || null }, catalog: { system: catalog?.system || null, sections: (catalog?.sections || []).filter(s => sectionIds.has(s.id)), entries: portableEntries } };
}
export function renderPortable(template, payload) {
  if (!template.includes('__ONESHOT_PAYLOAD__')) throw Error('Повреждён шаблон автономного чарника.');
  return template.replace('__ONESHOT_PAYLOAD__', () => JSON.stringify(payload).replaceAll('<', '\\u003c'));
}
