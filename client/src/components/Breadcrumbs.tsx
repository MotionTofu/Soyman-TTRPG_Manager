import { Link } from "react-router-dom";

export interface Crumb {
  label: string;
  to?: string; // omitted for the current (last) crumb
}

interface Props {
  items: Crumb[];
}

export function Breadcrumbs({ items }: Props) {
  return (
    <div className="row muted">
      {items.map((item, i) => (
        <span key={i}>
          {i > 0 && " / "}
          {item.to ? <Link to={item.to}>{item.label}</Link> : item.label}
        </span>
      ))}
    </div>
  );
}
