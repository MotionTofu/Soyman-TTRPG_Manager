/** Обзор LitM (доска Litm-Overview): состав справочника в единицах книги, а не в записях базы. */
import type { CompendiumEntry } from "../../types";
import type { LitmCatalog } from "./litmBookText";
import { plural } from "./litmBookText";
import { OWN_LOCATION } from "./litmChallenge";
import { grimoireOf } from "./litmGrimoire";
import { journeysOf } from "./litmJourneys";
import { rulesOf } from "./litmRules";
import { storeOf } from "./litmStore";
import { treasuresOf } from "./litmTreasury";
import { waysOf } from "./litmWays";

/** Что в разделе — строкой доски. */
export const UNIT_NOTES: Record<LitmCatalog, string> = {
  rules: "как играть, теги, статусы, пределы, привал, оракулы",
  grimoire: "что получить действием и сколько это стоит",
  themes: "по Могуществу; Содружество — своя тема",
  tropes: "быстрое создание героя",
  ways: "традиции, волшебный котёл, заученные формулы",
  store: "рюкзак, монеты, награды Рассказчика",
  treasury: "реликвии и влияние — сюжетные темы",
  challenges: "места книги и ваши",
  journeys: "местности, события, предприятия",
};

const n = (k: number, one: string, few: string, many: string) => `${k} ${plural(k, one, few, many)}`;
const count = (entries: CompendiumEntry[], kind: string) => entries.filter((e) => e.kind === kind).length;

/** «20 тем · 120 наборов» — счёт раздела в единицах книги. */
export function bookUnits(catalog: LitmCatalog, entries: CompendiumEntry[]): string {
  switch (catalog) {
    case "rules": {
      const groups = rulesOf(entries);
      return `${n(groups.length, "группа", "группы", "групп")} · ${n(groups.reduce((s, g) => s + g.articles.length, 0), "статья", "статьи", "статей")}`;
    }
    case "grimoire":
      return n(grimoireOf(entries).reduce((s, c) => s + c.articles.length, 0), "статья", "статьи", "статей");
    case "themes":
      return `${n(count(entries, "themebook"), "тема", "темы", "тем")} · ${n(count(entries, "theme_kit"), "набор", "набора", "наборов")}`;
    case "tropes": {
      const tropes = entries.filter((e) => e.kind === "trope");
      const groups = new Set(tropes.map((t) => t.data?.group).filter(Boolean)).size;
      return `${n(tropes.length, "троп", "тропа", "тропов")}${groups ? ` · ${n(groups, "группа", "группы", "групп")}` : ""}`;
    }
    case "ways": {
      const { ways } = waysOf(entries);
      return `${n(ways.length, "путь", "пути", "путей")} · ${n(ways.reduce((s, w) => s + w.kits.length, 0), "набор", "набора", "наборов")}`;
    }
    case "store": {
      const b = storeOf(entries);
      const rewards = b.rewards?.groups.reduce((s, g) => s + g.items.length, 0) ?? 0;
      return `${n(b.categories.length + (b.coin ? 1 : 0), "категория", "категории", "категорий")} · ${n(rewards, "награда", "награды", "наград")}`;
    }
    case "treasury":
      return n(treasuresOf(entries).length, "сокровище", "сокровища", "сокровищ");
    case "challenges": {
      const book = entries.filter((e) => e.kind === "monster" && (e.data?.location ?? OWN_LOCATION) !== OWN_LOCATION);
      const addons = book.filter((e) => e.data?.addon).length;
      const own = count(entries, "monster") - book.length;
      return [n(book.length - addons, "профиль", "профиля", "профилей"), addons ? n(addons, "надстройка", "надстройки", "надстроек") : "", own ? n(own, "свой", "своих", "своих") : ""]
        .filter(Boolean).join(" · ");
    }
    case "journeys":
      return n(journeysOf(entries).reduce((s, g) => s + g.journeys.length, 0), "путешествие", "путешествия", "путешествий");
  }
}
