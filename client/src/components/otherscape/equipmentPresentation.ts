import { readDossierDocument } from "./dossierDocument";

export interface EquipmentTag { translation: string; original: string; primary?: boolean }
export interface EquipmentSection {
  title: string;
  originalTitle: string;
  text: string;
  tags: EquipmentTag[] | null;
  after: string;
}
export interface EquipmentPresentation {
  variant: "item" | "special" | "generic" | "rule";
  label: string;
  description: string;
  body: string;
  original: string;
  tags: EquipmentTag[] | null;
  tagText: string;
  weakness: { translation: string; original: string } | null;
  weaknessText: string;
  sections: EquipmentSection[];
  source: string;
  pages: { target: string; page: number }[];
}

export function isOtherscapeEquipmentSection(code: string | null | undefined, name: string): boolean {
  return code?.trim().toLowerCase() === "otherscape" && ["снаряжение", "equipment"].includes(name.trim().toLowerCase());
}

function readTagPairs(text: string, item: boolean): { tags: EquipmentTag[] | null; after: string } {
  const pattern = item ? /^- \*\*([^*\n]+)\*\*( — основной тег)?\n[ \t]+\*([^\n]+)\*(?:\n|$)/gm
    : /^- \*\*([^*\n]+)\*\* — \*([^\n]+)\*(?:\n|$)/gm;
  const pairs = [...text.matchAll(pattern)];
  let end = 0;
  for (const pair of pairs) {
    if (text.slice(end, pair.index).trim()) return { tags: null, after: "" };
    end = pair.index + pair[0].length;
  }
  if (!pairs.length) return { tags: null, after: "" };
  return {
    tags: pairs.map(pair => ({ translation: pair[1], original: pair[item ? 3 : 2], ...(item ? { primary: !!pair[2] } : {}) })),
    after: text.slice(end).trim(),
  };
}

/** Read the existing equipment Markdown, retaining unknown formats in the ordinary reader. */
export function parseEquipmentPresentation(description: string, originalName: string): EquipmentPresentation | null {
  const document = readDossierDocument(description, originalName);
  if (!document) return null;
  const text = document.body;
  const view: EquipmentPresentation = {
    variant: "rule", label: "Loadout Rule", description: "", body: text, original: "",
    tags: null, tagText: "", weakness: null, weaknessText: "", sections: [], source: document.source, pages: document.pages,
  };
  const originalDescription = "\n\n**Оригинал описания**\n\n";
  const tagHeading = "\n\n**Теги снаряжения — Loadout Tags**\n\n";
  const weaknessHeading = "\n\n**Слабость — Weakness**\n\n";
  if (text.includes(tagHeading)) {
    const originalIndex = text.indexOf(originalDescription);
    const tagsIndex = text.indexOf(tagHeading);
    const weaknessIndex = text.indexOf(weaknessHeading);
    if (originalIndex < 0 || originalIndex > tagsIndex || weaknessIndex < tagsIndex) return null;
    const tagText = text.slice(tagsIndex + tagHeading.length, weaknessIndex).trim();
    const tags = readTagPairs(tagText, true);
    // A partially understood list must stay visible as a whole.
    if (tags.after) tags.tags = null;
    const weaknessText = text.slice(weaknessIndex + weaknessHeading.length).trim();
    const weakness = /^([^\n]+)\n\n\*([^\n]+)\*(?:\n\n([\s\S]*))?$/.exec(weaknessText);
    return {
      ...view, variant: "item", label: "Street Catalog",
      description: text.slice(0, originalIndex), original: text.slice(originalIndex + originalDescription.length, tagsIndex).trim(),
      tags: tags.tags, tagText, weakness: weakness ? { translation: weakness[1], original: weakness[2] } : null,
      weaknessText: weakness ? "" : weaknessText, body: weakness?.[3] ?? "",
    };
  }
  const originalRule = "\n\n**Оригинал правила**\n\n";
  const ruleIndex = text.indexOf(originalRule);
  if (ruleIndex >= 0) return { ...view, variant: "special", label: "Loadout Theme Special", body: text.slice(0, ruleIndex), original: text.slice(ruleIndex + originalRule.length) };
  if (originalName.startsWith("General Items / ")) {
    const headings = [...text.matchAll(/^\*\*([^*\n]+) — ([^*\n]+)\*\*\n\n/gm)];
    if (!headings.length) return null;
    return {
      ...view, variant: "generic", label: "General Items", description: text.slice(0, headings[0].index).trim(), body: "",
      sections: headings.map((heading, index) => {
        const section = text.slice(heading.index + heading[0].length, headings[index + 1]?.index ?? text.length).trim();
        const pairs = readTagPairs(section, false);
        return { title: heading[1], originalTitle: heading[2], text: section, tags: pairs.tags, after: pairs.after };
      }),
    };
  }
  return view;
}
