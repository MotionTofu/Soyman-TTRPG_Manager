/** A view of the stored Markdown. Unrecognized profiles retain the native reader. */
export interface ChallengeSection { title: string; key: string; text: string }
export interface ChallengePresentation {
  difficulty: number;
  isPowerSet: boolean;
  scale: number | null;
  description: string;
  introduction: string;
  sections: ChallengeSection[];
  limits: { name: string; value: number | null; label: string }[] | null;
  limitNotes: string;
  specials: { title: string; text: string }[] | null;
  specialIntroduction: string;
  threats: { threat: string; consequences: string }[] | null;
  original: string;
  related: string;
  source: string;
  pages: { target: string; page: number }[];
}

export function isOtherscapeChallengesSection(code: string | null | undefined, name: string): boolean {
  return code?.trim().toLowerCase() === "otherscape" && ["испытания", "challenges"].includes(name.trim().toLowerCase());
}

function readLimits(text: string): { limits: ChallengePresentation["limits"]; notes: string } {
  const list = /^(?:- [^\n]+\n?)+/.exec(text)?.[0];
  if (!list) return { limits: null, notes: text };
  const matches = list.trim().split("\n").map(line => /^- (.+?) — \*\*([^*]+?): (\d+|– \(иммунитет\))\*\*\.$/.exec(line));
  if (!matches.every(Boolean)) return { limits: null, notes: text };
  return {
    limits: matches.map(match => ({ label: match![1], name: match![2], value: match![3].startsWith("–") ? null : Number(match![3]) })),
    notes: text.slice(list.length).trim(),
  };
}

function readSpecials(text: string): { specials: ChallengePresentation["specials"]; introduction: string } {
  // Named English mechanics start a sentence. Keep all intervening prose and optional modifiers.
  const headings = [...text.matchAll(/(?:^|[.!?]\s+)([A-Z][A-Za-z0-9'’!,+ ()-]+(?:\(так напечатано\))?):\s*/g)].map(heading => ({
    title: heading[1], start: heading.index + heading[0].indexOf(heading[1]), end: heading.index + heading[0].length,
  }));
  if (!headings.length) return { specials: null, introduction: "" };
  return {
    introduction: text.slice(0, headings[0].start).trim(),
    specials: headings.map((heading, index) => ({
      title: heading.title,
      text: text.slice(heading.end, headings[index + 1]?.start ?? text.length).trim(),
    })),
  };
}

export function parseChallengePresentation(description: string, originalName: string): ChallengePresentation | null {
  let text = description.replace(/\r\n/g, "\n").trim();
  const difficulty = /^\*\*Сложность — Difficulty:\*\* ([1-5])([^\n]*)$/m.exec(text);
  const powerSet = /^\*\*Mythos Power Set:\*\* Difficulty \+(\d+); \*\*Scale (\d+)\*\*\.([^\n]*)$/m.exec(text);
  const metadata = difficulty ?? powerSet;
  if (!metadata || !originalName) return null;
  let source = "";
  let related = "";
  const sourceIndex = text.lastIndexOf("\n\nИсточник:");
  if (sourceIndex >= 0) {
    source = text.slice(sourceIndex + 2).replace(/^Источник:\s*/, "");
    text = text.slice(0, sourceIndex);
  }
  const relatedIndex = text.search(/\n\n\*\*(?:Связанные профили|Общие правила):\*\*/);
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
  const difficultyNote = difficulty && difficulty[2].trim() !== "." ? `**Difficulty: ${difficulty[1]}**${difficulty[2]}` : "";
  const rawSections = headings.map((heading, index) => ({
    title: heading[1], key: heading[1].split(" — ").at(-1) ?? heading[1],
    text: text.slice(heading.index + heading[0].length, headings[index + 1]?.index ?? text.length).trim(),
  }));
  const originals: string[] = [];
  const sections = rawSections.filter(section => {
    if (section.key !== "Original") return true;
    originals.push(section.text);
    return false;
  }).map(section => {
    const originalIndex = section.text.search(/(?:^|\n\n)\*\*Original — (?:Limit rules|Specials):\*\*/);
    if (originalIndex < 0) return section;
    originals.push(section.text.slice(originalIndex).trim());
    return { ...section, text: section.text.slice(0, originalIndex).trim() };
  });
  const limitsSection = sections.find(section => section.key === "Limits");
  const limits = readLimits(limitsSection?.text ?? "");
  const specials = readSpecials(sections.find(section => section.key === "Specials")?.text ?? "");
  const threatsSection = sections.find(section => section.key === "Threats / Consequences");
  const threatHeadings = [...(threatsSection?.text ?? "").matchAll(/^\*\*\d+\.\*\* /gm)];
  const threats = threatHeadings.length && threatHeadings[0].index === 0 ? threatHeadings.map((heading, index) => {
    const item = threatsSection!.text.slice(heading.index + heading[0].length, threatHeadings[index + 1]?.index).trim();
    const englishIndex = item.search(/\n\n(?:\*\*Threat \(original\):\*\*|- \*\*Consequence \(original\):\*\*)/);
    let russian = item;
    if (englishIndex >= 0) {
      const tail = item.slice(englishIndex).trim();
      const standalone = "Самостоятельная угроза; отдельное последствие в профиле не указано.";
      originals.push(`**${index + 1}. Threats / Consequences**\n\n${tail.replace(standalone, "").trim()}`);
      russian = item.slice(0, englishIndex).trim();
      if (tail.includes(standalone)) russian += `\n\n${standalone}`;
    }
    const arrow = russian.indexOf(" → ");
    return arrow < 0 ? { threat: russian, consequences: "" } : { threat: russian.slice(0, arrow), consequences: russian.slice(arrow + 3) };
  }) : null;
  const pages = [...source.matchAll(/\[[^\]]+\]\((soyman:resource\/[0-9a-f-]+#page=([1-9]\d*))\)/gi)]
    .filter(match => Number.isSafeInteger(Number(match[2])))
    .map(match => ({ target: match[1], page: Number(match[2]) }));
  return {
    difficulty: Number(metadata[1]), isPowerSet: !!powerSet, scale: powerSet ? Number(powerSet[2]) : null,
    description: flavor, introduction: [...introduction, difficultyNote, powerSet?.[3].trim() ?? ""].filter(Boolean).join("\n\n"),
    sections, limits: limits.limits, limitNotes: limits.notes,
    specials: specials.specials, specialIntroduction: specials.introduction, threats,
    original: originals.join("\n\n"), related, source, pages,
  };
}
