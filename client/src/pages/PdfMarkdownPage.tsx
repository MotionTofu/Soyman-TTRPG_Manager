import { useMemo, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { useResource } from "../data/hooks";
import { MentionText } from "../components/mentions/MentionText";
import type { Resource } from "../types";
import type { PdfNote } from "./pdfNotes";
import "./pdf-markdown.css";

type MarkdownDocument = { resource_id: number; pdf_resource_id: number; content: string };

export function PdfMarkdownPage() {
  const { id } = useParams();
  const location = useLocation();
  const from = (location.state as { from?: unknown } | null)?.from;
  const returnTo = typeof from === "string" && from.startsWith("/") && !from.startsWith("//") ? from : "/resources";
  const [showSource, setShowSource] = useState(false);
  const resourceQuery = useResource<Resource>(id ? `/resources/${id}` : null);
  const linkedPdf = resourceQuery.data?.linked_pdf_resource_id;
  const documentQuery = useResource<MarkdownDocument>(id && linkedPdf ? `/resources/${id}/markdown-content` : null);
  const notesQuery = useResource<PdfNote[]>(linkedPdf ? `/resources/${linkedPdf}/pdf-notes` : null);
  const notes = useMemo(() => [...(notesQuery.data ?? [])].sort((a, b) =>
    (a.page_number ?? 0) - (b.page_number ?? 0) || a.created_at.localeCompare(b.created_at)), [notesQuery.data]);

  function download() {
    const content = documentQuery.data?.content;
    if (!content || !linkedPdf) return;
    const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `pdf-${linkedPdf}.notes.md`;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  if (resourceQuery.loading) return <p>Открываю заметки…</p>;
  if (resourceQuery.error || !resourceQuery.data || !linkedPdf) return <p role="alert">Ресурс заметок не найден. <Link to="/resources">К Ресурсам</Link></p>;
  if (documentQuery.loading || notesQuery.loading) return <p>Загружаю заметки…</p>;
  if (documentQuery.error || notesQuery.error) return <p role="alert">Не удалось открыть заметки. <Link to="/resources">К Ресурсам</Link></p>;

  return <section className="pdf-markdown">
    <header className="pdf-markdown__toolbar">
      <Link to={returnTo}>← Назад</Link>
      <strong>{resourceQuery.data.name}</strong>
      <span className="pdf-markdown__spacer" />
      <Link to={`/resources/${linkedPdf}/read`}>Открыть PDF</Link>
      <button type="button" onClick={() => setShowSource(value => !value)} aria-pressed={showSource}>
        {showSource ? "Читать" : "Исходный Markdown"}
      </button>
      <button type="button" onClick={download}>Скачать .md</button>
    </header>
    <main className="pdf-markdown__body">
      {showSource ? <pre className="pdf-markdown__source">{documentQuery.data?.content}</pre> : <>
        <p className="pdf-markdown__hint">Создаётся из заметок PDF. Править заметки можно в читалке.</p>
        {notes.length === 0 && <p>Заметок пока нет.</p>}
        {notes.map(note => <article className="pdf-markdown__note" key={note.id}>
          <h2>{note.page_number ? `Страница ${note.page_number}` : "Общая заметка"}</h2>
          {note.needs_reattach && <p className="pdf-markdown__warning">Привязку цитаты к обновлённому PDF нужно проверить в читалке.</p>}
          {note.quote && <blockquote>{note.quote}</blockquote>}
          <div className="pdf-markdown__note-body"><MentionText text={note.body} /></div>
          {note.page_number && !note.needs_reattach && <Link to={`/resources/${linkedPdf}/read?page=${note.page_number}`}>
            Открыть страницу {note.page_number} в PDF →
          </Link>}
        </article>)}
      </>}
    </main>
  </section>;
}
