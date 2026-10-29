/** Read-only presentation of the existing Otherscape Markdown, never a storage migration. */
export interface PowerSetSection {
  title: string;
  text: string;
  key: string;
}

export interface PowerSetPresentation {
  category: string;
  bonus: number;
  description: string;
  introduction: string;
  sections: PowerSetSection[];
  specials: { title: string; text: string }[] | null;
  limits: { label: string; values: { name: string; value: number }[]; text: string } | null;
  original: string;
  related: string;
  source: string;
  pages: { label: string; target: string; page: number }[];
}

export function isOtherscapePowerSetsSection(code: string | null | undefined, name: string): boolean {
  return code?.trim().toLowerCase() === "otherscape" && ["наборы сил", "power sets"].includes(name.trim().toLowerCase());
}

function removeRepeatedOriginal(text: string, original: string): string {
  const normalized = original.replace(/\s+/g, " ");
  return text.replace(/\n\n[ \t]+\*\*Original:\*\*[ \t]*([^\n]+)/g, (whole, english: string) =>
    normalized.includes(english.replace(/\s+/g, " ").trim()) ? "" : whole
  ).trim();
}

function readLimits(text: string): PowerSetPresentation["limits"] {
  if (!text) return null;
  const header = /^\*\*([^*]+)\*\*\s*([\s\S]*)$/.exec(text);
  const matches = header ? [...header[1].matchAll(/([a-z][a-z /-]*):(\d+)/gi)] : [];
  // A heading with extra words is prose, not a partially understood set of numeric limits.
  const numeric = header && matches.length && !header[1].replace(/([a-z][a-z /-]*):(\d+)/gi, "").replace(/[;.\s]/g, "");
  if (!numeric || !header) return { label: "Пределы и условия", values: [], text };
  const values = matches.map(match => ({ name: match[1].trim(), value: Number(match[2]) }));
  const progress = values.length === 1 && /^[—–-]\s*предел прогресса\./i.test(header[2]);
  const polar = values.length === 1 && /^[—–-]\s*полярный предел/i.test(header[2]);
  return {
    label: progress ? "Предел прогресса" : polar ? "Полярный предел" : values.length > 1 ? "Пределы и условия" : "Предел",
    values,
    text: header[2].replace(/^[—–-]\s*/, "").replace(progress ? /^предел прогресса\.\s*/i : /$^/, "").trim(),
  };
}

export function displayLimitName(name: string): string {
  if (name !== name.toUpperCase()) return name;
  return name.toLowerCase().replace(/\b[a-z]+/g, (word, index: number) =>
    index > 0 && ["of", "the", "and"].includes(word) ? word : word[0].toUpperCase() + word.slice(1)
  );
}

export function parsePowerSetPresentation(description: string, originalName: string): PowerSetPresentation | null {
  let text = description.replace(/\r\n/g, "\n").trim();
  const metadata = /^\*\*(Self|Mythos|Noise) Power Set[^\n]*Difficulty:\s*\+(\d+)\.\*\*$/m.exec(text);
  if (!metadata || !originalName) return null;
  let source = "";
  let related = "";
  const sourceIndex = text.lastIndexOf("\n\nИсточник:");
  if (sourceIndex >= 0) {
    source = text.slice(sourceIndex + 2).replace(/^Источник:\s*/, "");
    text = text.slice(0, sourceIndex);
  }
  const relatedIndex = text.lastIndexOf("\n\n**Связанные правила и профили:**");
  if (relatedIndex >= 0) {
    related = text.slice(relatedIndex + 2);
    text = text.slice(0, relatedIndex);
  }
  const headings = [...text.matchAll(/^### ([^\n]+)\n+/gm)];
  if (!headings.length || metadata.index >= headings[0].index) return null;
  let opening = text.slice(0, headings[0].index).replace(metadata[0], "").trim();
  const nameHeading = `**${originalName}**`;
  if (opening.startsWith(nameHeading)) opening = opening.slice(nameHeading.length).trim();
  const [flavor = "", ...introduction] = opening.split(/\n\s*\n/);
  const sections = headings.map((heading, index) => ({
    title: heading[1],
    key: heading[1].split(" — ").at(-1) ?? heading[1],
    text: text.slice(heading.index + heading[0].length, headings[index + 1]?.index ?? text.length).trim(),
  }));
  const original = sections.filter(section => section.key === "Original").map(section => section.text).join("\n\n");
  const visible = sections.filter(section => section.key !== "Original").map(section => ({
    ...section, text: removeRepeatedOriginal(section.text, original),
  }));
  const specialText = visible.filter(section => section.key === "Specials").map(section => section.text).join("\n\n");
  const items = specialText ? specialText.split(/\n\n(?=- )/) : [];
  const specials = items.map(item => /^- \*\*([^*]+)\*\*\s*([\s\S]*)$/.exec(item));
  const pages = [...source.matchAll(/\[([^\]]+)\]\((soyman:resource\/[0-9a-f-]+#page=([1-9]\d*))\)/gi)]
    .filter(match => Number.isSafeInteger(Number(match[3])))
    .map(match => ({ label: match[1], target: match[2], page: Number(match[3]) }));
  return {
    category: metadata[1], bonus: Number(metadata[2]), description: flavor,
    introduction: introduction.join("\n\n"), sections: visible,
    specials: items.length && specials.every(Boolean)
      ? specials.map(special => ({ title: special![1].replace(/[.:]$/, ""), text: special![2] })) : null,
    limits: readLimits(visible.filter(section => section.key === "Limits").map(section => section.text).join("\n\n")),
    original, related, source, pages,
  };
}
