import { Link } from "react-router-dom";
import { usePreviousPage } from "../layout/navigationHistoryContext";

export interface Crumb {
  label: string;
  to?: string; // omitted for the current (last) crumb
}

interface Props {
  items: Crumb[];
  compact?: boolean;
}

export function Breadcrumbs({ items, compact = false }: Props) {
  const back = usePreviousPage();
  const parent = [...items].reverse().find((item) => item.to);
  return (
    <nav className={`row muted breadcrumbs${compact ? " breadcrumbs--profile" : ""}`} aria-label="Хлебные крошки">
      {compact && <span className="breadcrumbs__compact">{parent && <Link to={parent.to!}>← {parent.label}</Link>}<span> / </span><span aria-current="page">{items.at(-1)?.label}</span></span>}
      {back ? <button type="button" className="breadcrumbs__back" onClick={back}>← Назад</button>
        : parent && <Link className="breadcrumbs__back" to={parent.to!}>← Назад</Link>}
      {items.map((item, i) => (
        <span key={i}>
          {i > 0 && " / "}
          {item.to ? <Link to={item.to}>{item.label}</Link> : <span aria-current={i === items.length - 1 ? "page" : undefined}>{item.label}</span>}
        </span>
      ))}
    </nav>
  );
}
