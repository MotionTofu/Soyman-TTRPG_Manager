import { Link, Navigate, useLocation, useParams } from "react-router-dom";
import { useResource } from "../data/hooks";
import type { Resource } from "../types";

/** Старые ссылки на документ заметок открывают ту же книгу в режиме «Одним текстом». */
export function PdfMarkdownPage() {
  const { id } = useParams();
  const location = useLocation();
  const resource = useResource<Resource>(id ? `/resources/${id}` : null);
  if (resource.loading) return <p role="status">Открываю заметки…</p>;
  const pdfId = resource.data?.linked_pdf_resource_id;
  if (!pdfId) return <p role="alert">Ресурс заметок не найден. <Link to="/mastering">К Библиотеке</Link></p>;
  const search = new URLSearchParams(location.search);
  search.set("notes", "text");
  return <Navigate to={`/resources/${pdfId}/read?${search}`} replace />;
}
