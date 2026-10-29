import { readDossierDocument } from "./dossierDocument";

export interface CrewPair { translation: string; original: string; primary: boolean }
export interface CrewPairList { before: string; pairs: CrewPair[]; after: string }
export interface CrewSection { heading: string; text: string; list: CrewPairList | null }
export interface CrewPresentation {
  variant: "kit" | "special" | "rule";
  label: string;
  body: string;
  original: string;
  sections: CrewSection[];
  instructions: string;
  power: CrewPairList | null;
  weakness: CrewPairList | null;
  motivation: { kind: string; text: string; original: string; after: string } | null;
  source: string;
  pages: { target: string; page: number }[];
}

export function isOtherscapeCrewSection(code: string | null | undefined, name: string): boolean {
  return code?.trim().toLowerCase() === "otherscape" && ["команда", "crew"].includes(name.trim().toLowerCase());
}

/** Only format a complete contiguous list; retain unfamiliar syntax as ordinary Markdown. */
function readPairs(text: string): CrewPairList | null {
  const first = /^- /m.exec(text);
  if (!first) return null;
  const pattern = /^- \*\*([^*\n]+)\*\*(?:( — титульный тег)?\n[ \t]+\*([^\n]+)\*| — \*([^\n]+)\*)(?:\n|$)/gm;
  const matches = [...text.matchAll(pattern)];
  if (!matches.length || matches[0].index !== first.index) return null;
  let end = first.index;
  for (const match of matches) {
    if (text.slice(end, match.index).trim()) return null;
    end = match.index + match[0].length;
  }
  const after = text.slice(end).trim();
  if (/^- /m.test(after)) return null;
  return {
    before: text.slice(0, first.index).trim(), after,
    pairs: matches.map(match => ({ translation: match[1], original: match[3] ?? match[4], primary: !!match[2] })),
  };
}

function sections(text: string): CrewSection[] {
  const headings = [...text.matchAll(/^\*\*([^*\n]+)\*\*\n\n/gm)];
  const result: CrewSection[] = [];
  const add = (heading: string, body: string) => {
    const text = body.trim();
    if (heading || text) result.push({ heading, text, list: readPairs(text) });
  };
  add("", text.slice(0, headings[0]?.index ?? text.length));
  headings.forEach((heading, index) => add(heading[1], text.slice(heading.index + heading[0].length, headings[index + 1]?.index ?? text.length)));
  return result;
}

/** A reference view over existing Markdown, with no selected tags or crew state. */
export function parseCrewPresentation(description: string, originalName: string): CrewPresentation | null {
  const document = readDossierDocument(description, originalName);
  if (!document) return null;
  const view: CrewPresentation = {
    ...document, variant: "rule", label: "Crew Reference", original: "", sections: sections(document.body),
    instructions: "", power: null, weakness: null, motivation: null,
  };
  const powerHeading = "\n\n**Теги силы — Power Tags**\n\n";
  const weaknessHeading = "\n\n**Теги слабости — Weakness Tags**\n\n";
  if (document.body.includes(powerHeading) || document.body.includes(weaknessHeading)) {
    const powerIndex = document.body.indexOf(powerHeading);
    const weaknessIndex = document.body.indexOf(weaknessHeading);
    const motivation = /\n\n\*\*(Identity|Ritual|Itch)\*\*\n\n([^\n]+)\n\n\*([^\n]+)\*(?:\n\n|$)/.exec(document.body);
    if (powerIndex < 0 || weaknessIndex < powerIndex || !motivation || motivation.index < weaknessIndex) return view;
    const power = readPairs(document.body.slice(powerIndex + powerHeading.length, weaknessIndex).trim());
    const weakness = readPairs(document.body.slice(weaknessIndex + weaknessHeading.length, motivation.index).trim());
    if (!power || !weakness || power.before || power.after || weakness.before || weakness.after) return view;
    return {
      ...view, variant: "kit", label: "Crew Theme Kit", instructions: document.body.slice(0, powerIndex), power, weakness,
      motivation: { kind: motivation[1], text: motivation[2], original: motivation[3], after: document.body.slice(motivation.index + motivation[0].length).trim() },
    };
  }
  const originalHeading = "\n\n**Оригинал правила**\n\n";
  const originalIndex = document.body.indexOf(originalHeading);
  if (originalIndex >= 0) return {
    ...view, variant: "special", label: "Crew Theme Special", body: document.body.slice(0, originalIndex),
    original: document.body.slice(originalIndex + originalHeading.length), sections: [],
  };
  return view;
}
