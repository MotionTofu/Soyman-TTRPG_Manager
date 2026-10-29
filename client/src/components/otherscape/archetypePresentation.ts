import { readDossierDocument } from "./dossierDocument";

export interface ArchetypeKit { link: string; theme: string; page: string; raw: string }
export interface ArchetypeKitList { kits: ArchetypeKit[]; after: string }
export interface ArchetypePresentation {
  label: string;
  body: string;
  profile: {
    concept: string;
    base: ArchetypeKitList;
    choice: ArchetypeKitList;
    loadout: { translation: string; original: string; notes: string };
    creation: string;
  } | null;
  source: string;
  pages: { target: string; page: number }[];
}

export function isOtherscapeArchetypeSection(code: string | null | undefined, name: string): boolean {
  return code?.trim().toLowerCase() === "otherscape" && ["типажи персонажей", "character tropes", "tropes"].includes(name.trim().toLowerCase());
}

function kitList(text: string): ArchetypeKitList | null {
  const pattern = /^- (\[\[compendium_entry@[0-9a-f]{32}\|otherscape\|[^\]\n]+\]\]) — ([^\n]+); (\[[^\]\n]+\]\(soyman:resource\/[0-9a-f-]+#page=[1-9]\d*\))\.(?:\n|$)/gim;
  const matches = [...text.matchAll(pattern)];
  if (matches.length !== 3 || matches[0].index !== 0) return null;
  let end = 0;
  for (const match of matches) {
    if (text.slice(end, match.index).trim()) return null;
    end = match.index + match[0].length;
  }
  const after = text.slice(end).trim();
  if (/^- /m.test(after)) return null;
  return { kits: matches.map(match => ({ link: match[1], theme: match[2], page: match[3], raw: match[0].trim() })), after };
}

/** A reading layout over existing trope descriptions; unfamiliar Markdown remains fully visible. */
export function parseArchetypePresentation(description: string, originalName: string): ArchetypePresentation | null {
  const document = readDossierDocument(description, originalName);
  if (!document) return null;
  const view: ArchetypePresentation = { ...document, label: "Character Trope", profile: null };
  const headings = ["Концепция — Concept", "Три основных набора — Base Theme Kits", "Четвёртый набор: выберите один — Choose One", "Начальное снаряжение — Loadout", "Создание тем — Rapid Creation"];
  const parts: string[] = [];
  let remaining = document.body;
  for (const [index, heading] of headings.entries()) {
    const marker = `**${heading}**\n\n`;
    if (!remaining.startsWith(marker)) return view;
    remaining = remaining.slice(marker.length);
    if (index === headings.length - 1) parts.push(remaining);
    else {
      const next = remaining.indexOf(`\n\n**${headings[index + 1]}**\n\n`);
      if (next < 0) return view;
      parts.push(remaining.slice(0, next));
      remaining = remaining.slice(next + 2);
    }
  }
  const base = kitList(parts[1]);
  const choice = kitList(parts[2]);
  const loadout = /^([^]*?)\n\n\*Оригинал: ([^\n]+)\*\n\n([^]*)$/.exec(parts[3]);
  if (!base || !choice || !loadout || !parts[0].trim() || !loadout[1].trim()) return view;
  return { ...view, profile: { concept: parts[0], base, choice, loadout: { translation: loadout[1], original: loadout[2], notes: loadout[3] }, creation: parts[4] } };
}
