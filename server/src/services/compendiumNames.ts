// Единый сплит «Имя [Original]» → {name, en} — один регекс на сервер и клиент.
// Клиентский extractEnglishName остаётся алиасом (compendium.ts:428).
export function splitBracketName(raw: string): { name: string; en: string } {
  const m = /^(.*?)\s*\[([^\]]+)\]\s*$/.exec(raw ?? "");
  return m ? { name: m[1].trim(), en: m[2].trim() } : { name: (raw ?? "").trim(), en: "" };
}
