// Трекер инициативы settings (Внешний вид → Пульт сессии) — same
// localStorage-backed pattern as financePrivacy.ts. Default is ON (unlike
// hideFinance's default-off), so absence of the key means enabled — only an
// explicit "0" turns it off.
const KEY = "rpgManagerInitiativeEpithets";

export function loadUseEpithets(): boolean {
  try {
    return localStorage.getItem(KEY) !== "0";
  } catch {
    return true;
  }
}

export function saveUseEpithets(use: boolean): void {
  try {
    if (use) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, "0");
  } catch {
    /* ignore */
  }
}

// Physical/personality-quirk adjectives used to tell apart multiple copies
// of the same creature added to the initiative tracker (e.g. five Goblins).
// Not yet gender-agreed or tied to creature type — see project notes for the
// planned follow-up once this is linked to bestiary categories.
export const INITIATIVE_EPITHETS = [
  "Жадный",
  "Хромой",
  "Голодный",
  "Улыбчивый",
  "Яростный",
  "Трусливый",
  "Хитрый",
  "Свирепый",
  "Молчаливый",
  "Косоглазый",
  "Горбатый",
  "Одноглазый",
];
