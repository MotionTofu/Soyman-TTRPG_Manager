import { auditExport } from './export-audit.mjs';
// Character-specific catalog slice (references + ancestors + common rules).
// Shared by portable HTML export and sync snapshots (phase D1.2): one slice
// logic, two transport formats. Returns the full audit; callers decide which
// gates apply (portable export rejects problems/external media, sync carries
// the best-effort slice without rejecting).
export function candidateCatalog(character, catalog) {
  // Common rules also need parent closure and media validation. Adding them
  // after auditing silently admitted broken links and external images.
  const groups = new Set(['Состояния', 'Типы урона', 'Особое восприятие', 'Навыки', 'Свойства оружия', 'Мастерство оружия', 'Оружейные приёмы']);
  const commonParents = new Set((catalog?.entries || []).filter(e => groups.has(e.name)).map(e => e.id));
  const commonRules = (catalog?.entries || []).filter(e => commonParents.has(e.id) || commonParents.has(e.parent_id));
  return auditExport({ ...character, content: { character: character.content, commonRules: commonRules.map(e => ({ entryId: e.id })) } }, catalog);
}
export function portablePayload(character, catalog) {
  const audit = candidateCatalog(character, catalog);
  if (audit.problems.length) throw Error(audit.problems.join('\n'));
  if (audit.externalAssets.length) throw Error('Для экспорта сначала загрузите изображения в персонажа: найдены внешние изображения.');
  for (const companion of character.content.companions || []) {
    const sourceId = companion.featureEntryId ?? companion.spellEntryId;
    if (sourceId != null) {
      const data = catalog?.entries.find(e => e.id === sourceId)?.data;
      const blueprint = data?.companion ?? data?.summon;
      // Хиты бывают и у вариантов (Первобытный зверь: наземный/морской/небесный).
      const hasHp = blueprint && typeof blueprint === 'object' && (blueprint.hp || (Array.isArray(blueprint.variants) && blueprint.variants.some(v => v?.hp)));
      if (!hasHp) throw Error(`Не найден чертёж спутника «${companion.name}».`);
    }
    // Спутник из бестиария едет записью справочника с карточкой существа
    // (entry.creature): его entryId уже попадает в срез через auditExport.
  }
  const entries = new Map(audit.candidate.entries.map(e => [e.id, e]));
  const sectionIds = new Set([...entries.values()].map(e => e.section_id));
  const content = structuredClone(character.content);
  for (const section of content.equipmentSections || []) for (const item of section.items) { delete item.transferIn; delete item.transferOut; }
  const portableEntries = structuredClone([...entries.values()]);
  // Однофайловый лист хранит только правила, нужные персонажу. Большие лица
  // не едут; маленькое превью (класс, подкласс, вид, спутник — ~34 КБ штука,
  // решено 2026-09-26) едет, только если оно встроено data:-картинкой.
  for (const entry of portableEntries) {
    const preview = entry.avatar_preview_url;
    delete entry.avatar_preview_url;
    if (typeof preview === 'string' && /^data:image\/(png|jpeg|webp);base64,/.test(preview)) entry.avatar_preview_url = preview;
    delete entry.avatar_large_url;
    delete entry.avatar_image_url;
    delete entry.avatar_preview_data;
    delete entry.avatar_data;
  }
  // Logical identity (phase B1.2): the stable characterUid travels inside
  // identity so re-imports recognize the same character. Payloads built from
  // bare content objects (tests, legacy paths) carry no UID and stay v1.
  const characterUid = typeof character.characterUid === 'string' && character.characterUid ? character.characterUid : null;
  return {
    format: 'soyman-1shot-portable', version: characterUid ? 2 : 1, exportedAt: new Date().toISOString(),
    ...(characterUid ? { identity: { characterUid } } : {}),
    character: { name: content.characterName, content, portrait: character.portrait || null }, catalog: { system: catalog?.system || null, sections: (catalog?.sections || []).filter(s => sectionIds.has(s.id)), entries: portableEntries } };
}
export function renderPortable(template, payload) {
  if (!template.includes('__ONESHOT_PAYLOAD__')) throw Error('Повреждён шаблон автономного чарника.');
  return template.replace('__ONESHOT_PAYLOAD__', () => JSON.stringify(payload).replaceAll('<', '\\u003c'));
}
// Copy for the GM's review (grilling 2026-09-23): the same portable HTML,
// minus the player's private notes. Named after the character so the GM
// tells files apart in the chat.
export function gmPayload(character, catalog) {
  return portablePayload({ ...character, content: { ...character.content, notes: '' } }, catalog);
}
export function portableFileName(name) {
  const clean = String(name || '').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
  return `${clean || 'Персонаж'}.html`;
}
