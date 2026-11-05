import { Link } from "react-router-dom";
import { useResource } from "../data/hooks";
import "./PdfEntitySources.css";

type Source = {
  id: string; resource_id: number; resource_name: string; page_number: number | null;
  quote: string; field_name: string; needs_reattach: number;
};
/** Источник со страницы сайта — захват расширением браузера (routes/webCapture.ts). */
type WebSource = { id: string; url: string; page_title: string; quote: string; field_name: string; captured_at: string };
const WEB_KINDS = new Set(["being", "location", "community", "artifact"]);

const FIELD_LABELS: Record<string, string> = {
  description: "Описание", history: "История", behavior: "Поведение",
  secret: "Секрет", player_text: "Текст для игроков", current_situation: "Текущее положение",
  features: "Особенности", goals: "Цели", power: "Свойства", notes: "Заметки",
};

function hostOf(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url; }
}

export function PdfEntitySources({ kind, id }: { kind: string; id: number }) {
  const { data: pdf, error } = useResource<Source[]>(id > 0 ? `/pdf-entity-sources/entity/${kind}/${id}` : null);
  const web = useResource<WebSource[]>(id > 0 && WEB_KINDS.has(kind) ? `/web-capture/sources/entity/${kind}/${id}` : null).data ?? [];
  const data = error ? [] : pdf ?? [];
  if (!data.length && !web.length) return null;
  return <details className="card pdf-entity-sources">
    <summary className="sb-section">Источники ({data.length + web.length})</summary>
    <ul>{web.map((source) => <li key={source.id}>
      <a href={source.url} target="_blank" rel="noopener noreferrer">{source.page_title || hostOf(source.url)}</a>
      <span className="muted"> · {hostOf(source.url)} · {FIELD_LABELS[source.field_name] ?? source.field_name} · {new Date(source.captured_at).toLocaleDateString("ru-RU")}</span>
      {source.quote ? <blockquote>{source.quote}</blockquote> : null}
    </li>)}{data.map((source) => <li key={source.id}>
      <Link to={`/resources/${source.resource_id}/read${source.page_number ? `?page=${source.page_number}` : ""}`}>
        {source.resource_name}{source.page_number ? ` · стр. ${source.page_number}` : ""}
      </Link>
      <span className="muted"> · {FIELD_LABELS[source.field_name] ?? source.field_name}</span>
      {source.needs_reattach ? <small>PDF заменён: проверьте цитату</small> : null}
      {source.quote ? <blockquote>{source.quote}</blockquote> : null}
    </li>)}</ul>
  </details>;
}
