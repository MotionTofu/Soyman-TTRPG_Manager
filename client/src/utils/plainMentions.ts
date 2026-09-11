/** Текст без разметки упоминаний: `[[being@uid|Мир|веркрыса]]` → «веркрыса».
 * Для однострочных подписей, где MentionText с его ссылками неуместен. */
export function plainMentions(text: string): string {
  return text.replace(/\[\[([^\]]*)\]\]/g, (_m, inner: string) => inner.split("|").pop() ?? "");
}
