import { Link } from "react-router-dom";
import { useResource } from "../data/hooks";
import "./PdfEntitySources.css";

type Source = {
  id: string; resource_id: number; resource_name: string; page_number: number | null;
  quote: string; field_name: string; needs_reattach: number;
};

const FIELD_LABELS: Record<string, string> = {
  description: "Описание", history: "История", behavior: "Поведение",
  secret: "Секрет", player_text: "Текст для игроков", current_situation: "Текущее положение",
  features: "Особенности", goals: "Цели", power: "Свойства", notes: "Заметки",
};

export function PdfEntitySources({ kind, id }: { kind: string; id: number }) {
  const { data, error } = useResource<Source[]>(id > 0 ? `/pdf-entity-sources/entity/${kind}/${id}` : null);
  if (error || !data?.length) return null;
  return <details className="card pdf-entity-sources">
    <summary className="sb-section">Источники PDF ({data.length})</summary>
    <ul>{data.map((source) => <li key={source.id}>
      <Link to={`/resources/${source.resource_id}/read${source.page_number ? `?page=${source.page_number}` : ""}`}>
        {source.resource_name}{source.page_number ? ` · стр. ${source.page_number}` : ""}
      </Link>
      <span className="muted"> · {FIELD_LABELS[source.field_name] ?? source.field_name}</span>
      {source.needs_reattach ? <small>PDF заменён: проверьте цитату</small> : null}
      {source.quote ? <blockquote>{source.quote}</blockquote> : null}
    </li>)}</ul>
  </details>;
}
