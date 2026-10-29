/** The shared document envelope used by the existing Otherscape reference entries. */
export function readDossierDocument(description: string, originalName: string) {
  let text = description.replace(/\r\n/g, "\n").trim();
  const heading = `**${originalName}**\n\n`;
  if (!originalName || !text.startsWith(heading)) return null;
  text = text.slice(heading.length);
  const sourceIndex = text.lastIndexOf("\n\nИсточник:");
  if (sourceIndex < 0) return null;
  const source = text.slice(sourceIndex + 2).replace(/^Источник:\s*/, "");
  return {
    body: text.slice(0, sourceIndex), source,
    pages: [...source.matchAll(/\[[^\]]+\]\((soyman:resource\/[0-9a-f-]+#page=([1-9]\d*))\)/gi)]
      .filter(match => Number.isSafeInteger(Number(match[2])))
      .map(match => ({ target: match[1], page: Number(match[2]) })),
  };
}
