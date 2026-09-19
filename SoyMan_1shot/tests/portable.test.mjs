import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM, VirtualConsole } from '../../client/node_modules/jsdom/lib/api.js';
import { portablePayload, renderPortable } from '../app/portable.mjs';
test('portable payload excludes unrelated entries and rejects unsupported dependencies', () => {
  const c = { content: { classes: [], equipmentSections: [{ items: [{ entryId: 1, transferIn: { fromCharacterId: 77 } }] }] } };
  const catalog = { system: {}, sections: [{ id: 1 }], entries: [1, 2].map(id => ({ id, section_id: 1, parent_id: null, kind: 'equipment', name: `Item ${id}`, data: {}, avatar_preview_url: 'data:image/webp;base64,cHJldmlldw==', avatar_large_url: 'data:image/webp;base64,bGFyZ2U=' })) };
  const payload = portablePayload(c, catalog);
  assert.deepEqual(payload.catalog.entries.map(e => e.id), [1]);
  assert.equal(payload.character.content.equipmentSections[0].items[0].transferIn, undefined);
  assert.equal(payload.catalog.entries[0].avatar_preview_url, undefined);
  assert.equal(payload.catalog.entries[0].avatar_large_url, undefined);
  assert.equal(c.content.equipmentSections[0].items[0].transferIn.fromCharacterId, 77);
  assert.throws(() => portablePayload({ ...c, portrait: 'https://example.test/a.png' }, catalog));
  assert.throws(() => portablePayload({ content: { companions: [{ entryId: 1, name: 'Волк' }] } }, catalog), /статблок бестиария/);
  assert.throws(() => portablePayload({ content: { companions: [{ entryId: null, featureEntryId: 1, name: 'Защитник' }] } }, catalog), /Не найден чертёж/);
  assert.throws(() => portablePayload({ content: { companions: [{ entryId: null, statblockId: 42, name: 'Спутник' }] } }, catalog), /статблок/);
});
test('common rules include ancestors and reject broken or external dependencies', () => {
  const character = { content: { classes: [] } };
  const catalog = { system: {}, sections: [{ id: 1 }], entries: [
    { id: 1, section_id: 1, name: 'Правила', kind: 'rule', data: {} },
    { id: 2, section_id: 1, parent_id: 1, name: 'Состояния', kind: 'rule', data: {} },
    { id: 3, section_id: 1, parent_id: 2, name: 'Ослеплённый', kind: 'rule', data: {} },
    { id: 4, section_id: 1, name: 'Неиспользуемое', kind: 'rule', data: {} },
  ] };
  assert.deepEqual(portablePayload(character, catalog).catalog.entries.map(e => e.id), [1, 2, 3]);
  catalog.entries[2].description = '<img src="https://example.test/missing.png">';
  assert.throws(() => portablePayload(character, catalog), /внешние изображения/);
  delete catalog.entries[2].description;
  catalog.entries[1].parent_id = 999;
  assert.throws(() => portablePayload(character, catalog), /Не найдена запись/);
});

test('full React HTML boots without network and reexports changed state safely', async t => {
  const template = await readFile(new URL('../generated/standalone-template.html', import.meta.url), 'utf8');
  const catalog = { system: { id: 1, name: 'D&D 5.5' }, sections: [{ id: 1, kind: 'spell', name: 'Заклинания' }], entries: [{ id: 7, section_id: 1, kind: 'spell', level: 2, name: 'Призыв', data: { summon: { name: 'Тестовый спутник', hp: '5+5*spell', ac: '14', dismissable: true, actions: [{ name: 'Удар', note: 'Тестовое действие спутника' }] } } }] };
  const payload = portablePayload({ content: { characterName: 'HTML test </script><script>window.injected=true</script>', classes: [], companions: [{ entryId: null, name: 'Тестовый спутник', spellEntryId: 7, spellLevel: 2, hpUsed: 3 }], abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 } } }, catalog);
  const html = renderPortable(template, payload);
  let saved; const errors = []; const network = [];
  const vc = new VirtualConsole(); vc.on('jsdomError', e => errors.push(e.message)); vc.on('error', e => errors.push(String(e?.stack || e))); 
  function beforeParse(w) {
    w.structuredClone = structuredClone; w.Blob = Blob;
    w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
    w.ResizeObserver = class { observe() {} disconnect() {} unobserve() {} };
    w.HTMLElement.prototype.scrollIntoView = () => {};
    w.fetch = async url => { network.push(String(url)); throw Error('Network forbidden'); };
    w.URL.createObjectURL = blob => { saved = blob; return 'blob:test'; }; w.URL.revokeObjectURL = () => {};
    w.HTMLAnchorElement.prototype.click = () => {};
  }
  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, beforeParse, virtualConsole: vc, url: 'file:///character.html' });
  t.after(() => dom.window.close());
  const wait = () => new Promise(resolve => setTimeout(resolve, 100));
  for (let i = 0; i < 30 && !dom.window.document.querySelector('[aria-label="Вдохновения нет"]'); i++) await wait();
  const doc = dom.window.document;
  assert.equal(dom.window.injected, undefined);
  const inspiration = doc.querySelector('[aria-label="Вдохновения нет"]');
  assert.ok(inspiration, 'Sheet must render: ' + errors.join('\n'));
  inspiration.click(); await wait();
  for (let i = 0; i < 30 && !doc.querySelector('.dnd-companion-body'); i++) await wait();
  const companion = doc.querySelector('.dnd-companion-body');
  assert.ok(companion, 'Companion blueprint must load without its spell in the selected spell list');
  assert.match(companion.textContent, /КЗ 14/);
  assert.match(companion.textContent, /Тестовое действие спутника/);
  assert.ok(companion.querySelector('[aria-label="Тестовый спутник: хиты: осталось 12 из 15"]'));
  companion.querySelector('[aria-label="Тестовый спутник: хиты: потратить одно"]').click(); await wait();
  assert.ok(companion.querySelector('[aria-label="Тестовый спутник: хиты: осталось 11 из 15"]'));
  const dismiss = [...companion.querySelectorAll('button')].find(b => b.textContent.includes('Развеять'));
  assert.ok(dismiss); dismiss.click(); await wait();
  assert.equal(doc.querySelector('[aria-label="Добавить спутника"]'), null);
  const saveButton = [...doc.querySelectorAll('button')].find(b => b.textContent === 'Скачать обновлённую копию');
  assert.ok(saveButton, 'Save button must remain: ' + errors.join('\n') + doc.body.textContent.slice(0, 300));
  saveButton.click();
  const editedHtml = await saved.text();
  const reopened = new JSDOM(editedHtml, { runScripts: 'dangerously', pretendToBeVisual: true, beforeParse, virtualConsole: vc, url: 'file:///reopened.html' });
  t.after(() => reopened.window.close());
  for (let i = 0; i < 30 && !reopened.window.document.querySelector('[aria-label="Вдохновение есть — потратить"]'); i++) await wait();
  assert.ok(reopened.window.document.querySelector('[aria-label="Вдохновение есть — потратить"]'), 'Reopened sheet must render changed state');
  assert.equal(JSON.parse(reopened.window.document.getElementById('oneshot-payload').textContent).character.content.inspiration, true);
  assert.equal(JSON.parse(reopened.window.document.getElementById('oneshot-payload').textContent).character.content.companions[0].dismissed, true);
  assert.equal(JSON.parse(reopened.window.document.getElementById('oneshot-payload').textContent).character.content.companions[0].hpUsed, 4);
  for (let i = 0; i < 30 && !reopened.window.document.querySelector('.dnd-companion-body.is-dismissed'); i++) await wait();
  assert.ok(reopened.window.document.querySelector('.dnd-companion-body.is-dismissed'));
  assert.equal(reopened.window.injected, undefined);
  assert.equal(reopened.window.document.querySelectorAll('script[src],link[href]').length, 0);
  assert.deepEqual(network, []);
  assert.deepEqual(errors, []);
});

