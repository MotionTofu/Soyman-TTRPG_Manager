import { MentionText } from "../mentions/MentionText";
import { NavIcon } from "../NavIcons";

/** Native UID resolution keeps book-page links portable between installations. */
export function OtherscapeSource({ source, pages }: {
  source: string;
  pages: { target: string; page: number }[];
}) {
  if (!source) return null;
  return <footer className="oc-source">
    <NavIcon name="book" />
    <div><strong>Источник</strong><div className="oc-source-label"><MentionText text={source} /></div></div>
    {pages.length > 0 && <div className="oc-source-actions">{pages.map(page => <div className="oc-source-action" key={page.target}>
      <MentionText text={`[Открыть с. ${page.page}](${page.target})`} />
    </div>)}</div>}
  </footer>;
}
