import { findTextTables } from "../components/mentions/tableDocument";

/** Текст без разметки упоминаний: `[[being@uid|Мир|веркрыса]]` → «веркрыса».
 * Для однострочных подписей, где MentionText с его ссылками неуместен. */
export function plainMentions(text: string): string {
  let result = text;
  for (const block of findTextTables(text, false).reverse()) {
    result = result.slice(0, block.from) + block.table.cells.map(row => row.map(cell => cell.text).join(" · ")).join("\n") + result.slice(block.to);
  }
  return result.replace(/\[\[([^\]]*)\]\]/g, (_m, inner: string) => inner.split("|").pop() ?? "");
}
