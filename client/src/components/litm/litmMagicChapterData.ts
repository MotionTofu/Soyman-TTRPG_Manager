import type { CompendiumEntry } from "../../types";
import { norm } from "./litmBookText";
import type { RuleSection } from "./litmRules";

export interface MagicIngredient {
  id: string;
  name: string;
  nameEn: string;
  page: string;
  text: string;
  aliases?: string[];
  variants?: string[];
}

export interface MagicExample {
  name: string;
  page: string;
  text: string;
  ingredients: string[];
}

export interface CauldronChapter {
  kind: "cauldron";
  steps: { title: string; text: string; link?: string }[];
  base: MagicIngredient[];
  compound: MagicIngredient[];
  examples: MagicExample[];
  rules: Omit<RuleSection, "textEn">[];
}

export interface Rote {
  id: string;
  name: string;
  nameEn: string;
  page: string;
  practitioners: string;
  description: string;
  might?: string;
  helps: string;
  hinders: string;
  success: string[];
  feats: string[];
  consequences: string[];
}

export interface RotesChapter {
  kind: "rotes";
  items: Rote[];
}

export function magicChapter(entry: CompendiumEntry): CauldronChapter | RotesChapter | undefined {
  const chapter = entry.data?.magicChapter as Partial<CauldronChapter | RotesChapter> | undefined;
  if (chapter?.kind === "cauldron" && [chapter.steps, chapter.base, chapter.compound, chapter.examples, chapter.rules].every(Array.isArray)) {
    return chapter as CauldronChapter;
  }
  if (chapter?.kind === "rotes" && Array.isArray(chapter.items)) return chapter as RotesChapter;
}

export function cauldronIngredientIndex(chapter: CauldronChapter) {
  const index = new Map<string, string>();
  for (const item of [...chapter.base, ...chapter.compound]) {
    for (const name of [item.nameEn, ...(item.aliases ?? [])]) index.set(norm(name), item.id);
  }
  return index;
}

export function ingredientAnchor(id: string) {
  return "litm-ingredient-" + id;
}
