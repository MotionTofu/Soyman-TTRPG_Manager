import { readDossierDocument } from "./dossierDocument";

export interface DevelopmentBlock {
  kind: "text" | "heading" | "formula";
  text: string;
}
export interface DevelopmentPresentation {
  variant: "essence" | "veteran" | "rule";
  label: string;
  condition: string;
  body: string;
  blocks: DevelopmentBlock[];
  original: string;
  related: string;
  source: string;
  pages: { target: string; page: number }[];
}

export function isOtherscapeDevelopmentSection(code: string | null | undefined, name: string): boolean {
  return code?.trim().toLowerCase() === "otherscape" && ["развитие персонажа", "character development"].includes(name.trim().toLowerCase());
}

function ruleBlocks(text: string): DevelopmentBlock[] {
  const markers = [
    ...[...text.matchAll(/^\*\*([^*\n]+)\*\*\n\n/gm)].map(match => ({ index: match.index, length: match[0].length, kind: "heading" as const, text: match[1] })),
    ...[...text.matchAll(/^\*\*Формула:\*\* ([^\n]+)$/gm)].map(match => ({ index: match.index, length: match[0].length, kind: "formula" as const, text: match[1] })),
  ].sort((a, b) => a.index - b.index);
  const blocks: DevelopmentBlock[] = [];
  let end = 0;
  for (const marker of markers) {
    const before = text.slice(end, marker.index).trim();
    if (before) blocks.push({ kind: "text", text: before });
    blocks.push({ kind: marker.kind, text: marker.text });
    end = marker.index + marker.length;
  }
  const after = text.slice(end).trim();
  if (after) blocks.push({ kind: "text", text: after });
  return blocks;
}

/** Presentation only: no progress state, character changes or new game-rule calculations. */
export function parseDevelopmentPresentation(description: string, originalName: string): DevelopmentPresentation | null {
  const document = readDossierDocument(description, originalName);
  if (!document) return null;
  const view: DevelopmentPresentation = {
    ...document, variant: "rule", label: "Character Development", condition: "", original: "", related: "", blocks: ruleBlocks(document.body),
  };
  let text = document.body;
  if (text.includes("**Essence Special**") || text.startsWith("**Состав тем:**")) {
    const specialHeading = "\n\n**Essence Special**\n\n";
    const originalHeading = "\n\n**Оригинал**\n\n";
    const specialIndex = text.indexOf(specialHeading);
    const originalIndex = text.indexOf(originalHeading);
    const condition = /^\*\*Состав тем:\*\* ([\s\S]+)$/.exec(text.slice(0, specialIndex));
    if (!condition || specialIndex < 0 || originalIndex < specialIndex) return null;
    let related = "";
    const relatedIndex = text.indexOf("\n\nСвязанное правило:", originalIndex);
    if (relatedIndex >= 0) {
      related = text.slice(relatedIndex + 2);
      text = text.slice(0, relatedIndex);
    }
    return {
      ...view, variant: "essence", label: "Essence", condition: condition[1],
      body: text.slice(specialIndex + specialHeading.length, originalIndex).trim(), blocks: [],
      original: text.slice(originalIndex + originalHeading.length).trim(), related,
    };
  }
  const originalRule = "\n\n**Оригинал правила**\n\n";
  const originalIndex = text.indexOf(originalRule);
  if (originalIndex >= 0) return {
    ...view, variant: "veteran", label: "Veteran Special", body: text.slice(0, originalIndex), blocks: [],
    original: text.slice(originalIndex + originalRule.length),
  };
  return view;
}
