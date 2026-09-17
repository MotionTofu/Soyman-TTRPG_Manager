(async function () {
  const $ = id => document.getElementById(id);
  const { seeds, validate, pack, scriptJSON } = OneShotState;
  const portable = Boolean(window.ONESHOT_EMBEDDED);
  const id = portable ? validate(window.ONESHOT_EMBEDDED).id : location.pathname.split('/')[2];
  if (!seeds[id]) { $('status').textContent = 'Неизвестный персонаж'; return; }
  let character = portable ? validate(window.ONESHOT_EMBEDDED) : structuredClone(seeds[id]);
  let db, queue = Promise.resolve(), prompt;
  const status = message => { $('status').textContent = message; };
  async function transaction(mode, action) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction('characters', mode); let result;
      const request = action(tx.objectStore('characters'));
      request.onsuccess = () => { result = request.result; };
      tx.oncomplete = () => resolve(result);
      tx.onerror = tx.onabort = () => reject(tx.error || Error('Запись прервана'));
    });
  }
  function persist() {
    const snapshot = pack(character);
    if (portable) { status('Изменено в открытой копии — скачайте HTML или состояние'); return; }
    status('Сохраняем на устройстве…');
    queue = queue.then(async () => {
      if (!db) throw Error('Хранилище недоступно');
      await transaction('readwrite', store => store.put(snapshot, id));
      status('Сохранено на устройстве · облачной копии нет');
    }).catch(e => status(`Не удалось сохранить: ${e.message}. Скачайте копию.`));
  }
  function render() {
    $('name').textContent = character.name; document.title = character.name + ' · OneShot';
    $('role').textContent = character.role;
    $('hp').textContent = `${character.hp} / ${character.maxHp}`;
    $('slots').textContent = `${character.slots} / ${character.maxSlots}`;
    $('spend').disabled = character.slots === 0;
    $('damage').disabled = character.hp === 0; $('heal').disabled = character.hp === character.maxHp;
    $('notes').value = character.notes; $('items').replaceChildren();
    character.items.forEach(item => {
      const entry = document.createElement('div'); entry.className = 'entry';
      const title = document.createElement('strong'); title.textContent = `${item.kind === 'spell' ? 'Заклинание' : 'Предмет'} · ${item.name}`;
      const desc = document.createElement('p'); desc.textContent = item.description;
      entry.append(title, desc); $('items').append(entry);
    });
  }
  if (!portable) {
    try {
      db = await new Promise((resolve, reject) => {
        const request = indexedDB.open('oneshot-prototype-v1', 1);
        request.onupgradeneeded = () => request.result.createObjectStore('characters');
        request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
        request.onblocked = () => reject(Error('Закройте другие окна прототипа'));
      });
      const saved = await transaction('readonly', store => store.get(id));
      if (saved) character = validate(saved);
      else await transaction('readwrite', store => store.put(pack(character), id));
      status('Сохранено на устройстве · облачной копии нет');
    } catch (e) { db?.close(); db = null; status(`Локальное сохранение недоступно: ${e.message}. Скачайте копию.`); }
  } else {
    status('Автономная копия · после изменений скачайте новую версию');
    $('install').hidden = $('offline').hidden = true;
    $('ready').textContent = 'Все ресурсы встроены. Подключение к SoyMan не требуется.';
  }
  render();
  const change = callback => { callback(); render(); persist(); };
  $('damage').onclick = () => change(() => character.hp = Math.max(0, character.hp - 1));
  $('heal').onclick = () => change(() => character.hp = Math.min(character.maxHp, character.hp + 1));
  $('spend').onclick = () => change(() => character.slots = Math.max(0, character.slots - 1));
  $('rest').onclick = () => change(() => { character.hp = character.maxHp; character.slots = character.maxSlots; });
  $('notes').maxLength = 100000;
  $('notes').oninput = () => { character.notes = $('notes').value; persist(); };
  $('add').onsubmit = event => {
    event.preventDefault(); const name = $('entryName').value.trim(); if (!name) return;
    if (character.items.length >= 1000) { status('Достигнут предел тестовых записей'); return; }
    change(() => character.items.push({ kind: $('kind').value, name, description: $('description').value }));
    $('entryName').value = $('description').value = '';
  };
  function download(text, type, name) {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const link = document.createElement('a'); link.href = url; link.download = name; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
  $('backup').onclick = () => download(JSON.stringify(pack(character), null, 2), 'application/json', `${id}-state.json`);
  $('import').onclick = () => $('file').click();
  $('file').onchange = async () => {
    try {
      const file = $('file').files[0]; if (!file) return;
      if (file.size > 2000000) throw Error('Файл слишком большой');
      const next = validate(JSON.parse(await file.text()));
      if (next.id !== id) throw Error('Откройте чарник соответствующего персонажа');
      if (!confirm('Заменить текущее состояние данными файла? Сначала скачайте резервную копию, если хотите сохранить текущие значения.')) return;
      change(() => { character = next; });
    } catch (e) { status(`Импорт не выполнен: ${e.message}`); }
    finally { $('file').value = ''; }
  };
  $('export').onclick = async () => {
    try {
      const assets = window.ONESHOT_ASSETS || await Promise.all(['/sheet.html', '/style.css', '/state.js', '/app.js'].map(async path => {
        const response = await fetch(path); if (!response.ok) throw Error('Ресурсы экспорта не загружены'); return response.text();
      }));
      let html = assets[0].replace(/<link[^>]+>/g, '').replace(/<script src="[^\"]+"><\/script>/g, '');
      const safeScript = text => text.replace(/<\/script/gi, '<\\/script');
      html = html.replace('</head>', `<style>${assets[1]}</style></head>`);
      html = html.replace('</body>', `<script>window.ONESHOT_EMBEDDED=${scriptJSON(pack(character))};window.ONESHOT_ASSETS=${scriptJSON(assets)};<\/script><script>${safeScript(assets[2])}<\/script><script>${safeScript(assets[3])}<\/script></body>`);
      download(html, 'text/html;charset=utf-8', `${id}-oneshot.html`);
    } catch (e) { status(`Не удалось экспортировать: ${e.message}`); }
  };
  $('closeHelp').onclick = () => $('help').close();
  window.addEventListener('beforeinstallprompt', event => { event.preventDefault(); prompt = event; });
  $('install').onclick = async () => { if (prompt) { await prompt.prompt(); prompt = null; } else $('help').showModal(); };
  if (!portable) {
    $('offline').onclick = async () => {
      try {
        if (!window.isSecureContext || !('serviceWorker' in navigator)) throw Error('Откройте сайт по HTTPS или localhost');
        const registration = await navigator.serviceWorker.register('sw.js', { scope: './' });
        await navigator.serviceWorker.ready;
        const persistent = await navigator.storage?.persist?.();
        $('ready').textContent = `Офлайн-ресурсы готовы. ${persistent ? 'Запрошенное устойчивое хранение разрешено.' : 'Браузер управляет сроком хранения.'} Проверьте холодный запуск в авиарежиме.`;
      } catch (e) { $('ready').textContent = `Офлайн-подготовка не завершена: ${e.message}`; }
    };
  }
})();
