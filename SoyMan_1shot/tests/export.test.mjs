import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { JSDOM } from '../../client/node_modules/jsdom/lib/api.js';
import '../public/state.js';

test('standalone HTML reopens edited state and exports another usable copy', async (t) => {
  const assets = await Promise.all(['sheet.html', 'style.css', 'state.js', 'app.js'].map(name => readFile(new URL('../public/' + name, import.meta.url), 'utf8')));
  const character = structuredClone(OneShotState.seeds.mage);
  character.notes = '</script><script>window.injected=true</script>';
  const dom = new JSDOM(assets[0], { runScripts: 'outside-only' });
  t.after(() => dom.window.close());
  const w = dom.window; w.structuredClone = structuredClone; w.Blob = Blob;
  w.ONESHOT_EMBEDDED = OneShotState.pack(character); w.ONESHOT_ASSETS = assets;
  let blob;
  w.URL.createObjectURL = value => { blob = value; return 'blob:test'; };
  w.URL.revokeObjectURL = () => {};
  w.HTMLAnchorElement.prototype.click = () => {};
  w.eval(assets[2]); await w.eval(assets[3]);
  w.document.getElementById('damage').click();
  await w.document.getElementById('export').onclick();
  const html = await blob.text();
  const reopened = new JSDOM(html, { runScripts: 'dangerously', beforeParse(win) { win.structuredClone = structuredClone; } });
  t.after(() => reopened.window.close());
  assert.equal(reopened.window.document.querySelectorAll('script[src],link').length, 0);
  assert.equal(reopened.window.document.getElementById('hp').textContent, '15 / 16');
  assert.equal(reopened.window.document.getElementById('notes').value, character.notes);
  assert.equal(reopened.window.injected, undefined);
  assert.equal(reopened.window.document.getElementById('install').hidden, true);
  // Deliverable fixture contains clearly marked test content only.
  await mkdir(new URL('../dist/', import.meta.url), { recursive: true });
  await writeFile(new URL('../dist/example-mage-standalone.html', import.meta.url), html);
  dom.window.close(); reopened.window.close();
});
