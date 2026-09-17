(function (root) {
  const seeds = {
    warrior: { id: 'warrior', name: 'Тестовый воин', role: 'Воин · тест установки', maxHp: 24, hp: 24, slots: 0, maxSlots: 0, notes: '', items: [] },
    mage: { id: 'mage', name: 'Тестовый маг', role: 'Маг · тест установки', maxHp: 16, hp: 16, slots: 3, maxSlots: 3, notes: '', items: [] }
  };
  function validate(value) {
    if (!value || value.formatVersion !== 1 || !value.character) throw Error('Неизвестный формат копии');
    const c = value.character;
    if (!['warrior', 'mage'].includes(c.id) || typeof c.name !== 'string' || c.name.length > 200 || typeof c.role !== 'string' || c.role.length > 200 || typeof c.notes !== 'string' || c.notes.length > 100000 || !Array.isArray(c.items) || c.items.length > 1000) throw Error('Некорректные данные персонажа');
    for (const k of ['maxHp', 'hp', 'slots', 'maxSlots']) if (!Number.isSafeInteger(c[k]) || c[k] < 0 || c[k] > 10000) throw Error('Некорректный счётчик');
    if (c.hp > c.maxHp || c.slots > c.maxSlots) throw Error('Счётчик превышает максимум');
    if (c.items.some(i => !i || !['item', 'spell'].includes(i.kind) || typeof i.name !== 'string' || !i.name.trim() || i.name.length > 200 || typeof i.description !== 'string' || i.description.length > 10000)) throw Error('Некорректная ручная запись');
    return structuredClone(c);
  }
  function pack(character) { return { formatVersion: 1, exportedAt: new Date().toISOString(), character: structuredClone(character) }; }
  function scriptJSON(value) { return JSON.stringify(value).replaceAll('<', '\\u003c').replaceAll('\u2028', '\\u2028').replaceAll('\u2029', '\\u2029'); }
  root.OneShotState = { seeds, validate, pack, scriptJSON };
})(globalThis);
