// Черновики полей, которые набирают прямо во время игры.
//
// Тот же localStorage-приём, что у pultPrefs.ts: это состояние Мастера на
// этой машине, а не свойство данных. В базу черновик не уходит намеренно — у
// «Основных событий» есть галочка «Видно игрокам», и недописанная фраза,
// уехавшая игрокам по таймеру автосохранения, хуже потерянной.
//
// Пишется на каждое нажатие: терять нечего, а спасать нужно и от ухода на
// другую страницу, и от закрытой вкладки.
const PREFIX = "rpgManagerFieldDraft:";

export function loadFieldDraft(key: string): string | null {
  try {
    return localStorage.getItem(PREFIX + key);
  } catch {
    return null;
  }
}

export function saveFieldDraft(key: string, text: string): void {
  try {
    localStorage.setItem(PREFIX + key, text);
  } catch {
    /* приватный режим или переполнение — черновик просто не переживёт уход */
  }
}

export function clearFieldDraft(key: string): void {
  try {
    localStorage.removeItem(PREFIX + key);
  } catch {
    /* ignore */
  }
}
