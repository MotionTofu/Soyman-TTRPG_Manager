import { Link, useLocation } from "react-router-dom";
import type { SearchResult } from "../types";
import { searchResultLink } from "./searchPanelModel";

export function SearchResultFragments({ result, onNavigate }: { result: SearchResult; onNavigate?: () => void }) {
  const location = useLocation();
  const current = location.pathname + location.search;
  const fragments = result.fragments ?? [];
  if (!fragments.length) return null;
  const count = result.match_count ?? fragments.length;
  const links = fragments.map((fragment, index) => {
    const target = searchResultLink(result, fragment)!;
    const label = result.book_format === "md" && fragment.label !== "Текст документа"
      ? `Раздел «${fragment.label}»` : fragment.label;
    return <Link key={index} to={target} aria-current={target === current ? "location" : undefined}
      className="side-search-fragment" onClick={onNavigate}>
      <span className="side-search-fragment-label"><strong>{label}</strong><span aria-hidden="true">↗</span></span>
      <span>{fragment.before}<mark>{fragment.match}</mark>{fragment.after}</span>
    </Link>;
  });
  return <div className="side-search-fragments">
    {links[0]}
    {links.length > 1 && <details>
      <summary>Совпадения · {count}</summary>
      {links.slice(1)}
      {count > links.length && <small className="muted">Показано {links.length} из {count}</small>}
    </details>}
  </div>;
}
