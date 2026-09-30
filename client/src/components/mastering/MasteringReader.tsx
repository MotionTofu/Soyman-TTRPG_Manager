import { useEffect, useRef, useState } from "react";
import { useAction, useResource, write } from "../../data/hooks";
import { labelled } from "../../data/notices";
import { syncMentionLinks } from "../../mentions";
import {WorkbookLinks} from "../workbooks/WorkbookLinks";
import {downloadWorkbook} from "../workbooks/model";
import { NavIcon } from "../NavIcons";
import { Loadable, ListSkeleton } from "../Loadable";
import { MentionText } from "../mentions/MentionText";
import { SheetOverlay } from "../sheet/SheetOverlay";
import { MasteringBookForm } from "./MasteringBookForm";
import { MASTERING_AFFECTS, type MasteringDraft } from "./masteringTypes";
import { useMasteringReadingLayout } from "./useMasteringReadingLayout";
import { useMasteringAnnotations } from "./useMasteringAnnotations";
import { MasteringNotesPanel } from "./MasteringNotesPanel";
import { MasteringAnnotationDialogs } from "./MasteringAnnotationDialogs";
import type { MasteringBook, MasteringNote, MasteringSection, System } from "../../types";
import {LIBRARY_AFFECTS,type LibraryBook} from "./libraryTypes";
import {useLibraryReadingPosition} from "./useLibraryReadingPosition";

export function MasteringReader({ book, previousBook, nextBook, onNavigate, sections, systems, saved, onBookmark, onClose, onArchive, libraryBook, openNotes = false, onPlacement }: {
  book: MasteringBook;
  previousBook?: MasteringBook;
  nextBook?: MasteringBook;
  onNavigate: (id: number) => void;
  sections: MasteringSection[];
  systems: System[];
  saved: boolean;
  onBookmark: () => void;
  onClose: () => void;
  onArchive: () => Promise<void>;
  libraryBook?: LibraryBook;
  openNotes?: boolean;
  onPlacement?: () => void;
}) {
  const file=libraryBook?.source_type==="resource";
  const source = useResource<MasteringNote & {sha256?:string}>(file?`/resources/${book.id}/markdown-content`:`/mastering/${book.id}`);
  const note = {...source,data:source.data?(file?{...book,...source.data,title:book.title,section_id:book.section_id}:source.data):undefined};
  const run = useAction();
  const fileRevision=useRef(source.data?.sha256);
  const [editOpen, setEditOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  useEffect(()=>{if(!editOpen&&!sheetOpen)fileRevision.current=source.data?.sha256;},[source.data?.sha256,editOpen,sheetOpen]);
  const article = useRef<HTMLElement>(null);
  const reader = useRef<HTMLDivElement>(null);
  const toolbar = useRef<HTMLDivElement>(null);
  const toc = useRef<HTMLDivElement>(null);
  const prose = useRef<HTMLDivElement>(null);
  const highlights = useRef<HTMLDivElement>(null);
  const annotations = useMasteringAnnotations(book.id, note.data?.content, prose, highlights,file?`/book-library/books/${libraryBook!.id}/annotations`:undefined);
  useLibraryReadingPosition(libraryBook,!!note.data,prose);
  const setNotePreferences=annotations.setPreferences;
  useEffect(()=>{if(openNotes)setNotePreferences(previous=>({...previous,open:true}));},[openNotes,setNotePreferences]);
  const [tocOpen, setTocOpen] = useState(false);
  const [headings, setHeadings] = useState<string[]>([]);
  const activeHeading = useMasteringReadingLayout(reader, toolbar, article, toc, headings);
  useEffect(() => {
    const root = article.current;
    if (!root || !note.data) return;
    const nodes = root.querySelectorAll<HTMLElement>(".rt-h");
    const next = Array.from(nodes).map((node, i) => { node.id = `mastering-heading-${book.id}-${i}`; return node.textContent ?? ""; });
    setHeadings(previous => previous.join("\n") === next.join("\n") ? previous : next);
  }, [note.data, book.id]);
  const integrated=!!libraryBook;
  useEffect(() => { if(!integrated)article.current?.scrollIntoView({ block: "start" }); }, [note.loading,integrated]);
  async function save(draft: MasteringDraft) {
    if(file){
      const changed=await run(()=>write.put<{sha256:string}>(`/resources/${book.id}/markdown-content`,{content:draft.content,expected_sha256:fileRevision.current??source.data?.sha256}),{affects:[{kind:"resource",id:book.id}],retry:false});
      if(changed===undefined)return false;
      fileRevision.current=changed.sha256;
      const fields=await run(()=>write.put(`/resources/${book.id}`,{name:draft.title,system_id:draft.system_id}),{affects:[{kind:"resource",id:book.id}],retry:false});
      if(fields===undefined)return false;
      return await run(()=>write.put(`/book-library/books/${libraryBook!.id}`,{cover_image:draft.cover_image}),{affects:LIBRARY_AFFECTS})!==undefined;
    }
    const updated = await run(labelled("Книга", () => write.put(`/mastering/${book.id}`, draft)), { affects: MASTERING_AFFECTS });
    if (updated === undefined) return false;
    if(libraryBook&&await run(()=>write.put(`/book-library/books/${libraryBook.id}`,{cover_image:draft.cover_image}),{affects:LIBRARY_AFFECTS})===undefined)return false;
    syncMentionLinks("mastering", book.id, note.data?.content ?? "", draft.content);
    return true;
  }
  async function saveContent(content: string) {
    if (!note.data) throw new Error("Книга ещё загружается");
    if (!await save({ ...note.data, content })) throw new Error("Книга не сохранилась");
  }
  return <div className="mastering-reader" ref={reader}>
    <div className="mastering-reader__toolbar" ref={toolbar}>
      <div className="mastering-reader__navigation">
        <button type="button" onClick={onClose}><NavIcon name="arrowLeft" /> На полку</button>
        <div role="group" aria-label="Книги на этой полке"><button type="button" aria-label="Предыдущая книга" title={previousBook ? `Предыдущая: ${previousBook.title}` : "Первая книга на полке"} disabled={!previousBook} onClick={() => previousBook && onNavigate(previousBook.id)}><NavIcon name="arrowLeft" /></button><button type="button" aria-label="Следующая книга" title={nextBook ? `Следующая: ${nextBook.title}` : "Последняя книга на полке"} disabled={!nextBook} onClick={() => nextBook && onNavigate(nextBook.id)}><NavIcon name="arrowRight" /></button></div>
      </div>
      <div className="mastering-reader__actions">{libraryBook&&<WorkbookLinks bookId={libraryBook.id}/> }<button onClick={()=>downloadWorkbook(`${book.title}-заметки.md`,annotations.notes.map(n=>`${n.quote?"> "+n.quote+"\n\n":""}${n.body}`).join("\n\n---\n\n"),"text/markdown")}>Экспорт заметок</button><button type="button" className="is-active" aria-label="Чтение" aria-pressed="true"><NavIcon name="book" /><span className="mastering-reader__mode-label">Чтение</span></button><button type="button" onClick={() => setSheetOpen(true)} disabled={!note.data}>A4</button><button type="button" aria-label="Заметки к книге" aria-pressed={annotations.preferences.open} onClick={() => annotations.setPreferences(previous => ({ ...previous, open: !previous.open }))}>Заметки{annotations.notes.length ? ` · ${annotations.notes.length}` : ""}</button><button type="button" aria-label={saved ? "Убрать закладку" : "Добавить закладку"} title={saved ? "Убрать закладку книги" : "Добавить книгу в закладки"} aria-pressed={saved} onClick={onBookmark}><NavIcon name="navPin" /></button>{onPlacement&&<button type="button" onClick={onPlacement}>Полка и обложка</button>}<button type="button" aria-label="Редактировать книгу" title="Редактировать книгу" onClick={() => setEditOpen(true)} disabled={!note.data}><NavIcon name="edit" /></button><button type="button" aria-label="Архивировать книгу" title="Архивировать книгу" onClick={() => void onArchive()} disabled={!note.data}><NavIcon name="archive" /></button></div>
    </div>
    <Loadable loading={note.loading} error={note.error} errorTitle="Не удалось открыть книгу" onRetry={note.reload} skeleton={<ListSkeleton variant="paragraph" />}>
      {note.data && <div className={`mastering-reader__layout${headings.length ? " has-toc" : ""}${annotations.preferences.open ? " has-notes" : ""}`}>
        {!!headings.length && <nav className={`mastering-reader__toc${tocOpen ? " is-open" : ""}`} aria-label="Оглавление">
          <span>Оглавление</span><button type="button" className="mastering-reader__toc-toggle" aria-expanded={tocOpen} aria-controls={`mastering-toc-${book.id}`} onClick={() => setTocOpen(!tocOpen)}>Оглавление · {activeHeading + 1} / {headings.length}</button>
          <div className="mastering-reader__toc-scroll" ref={toc} id={`mastering-toc-${book.id}`} tabIndex={0} aria-label="Прокрутка оглавления">
            {headings.map((heading, i) => <button type="button" key={i} data-heading-index={i} aria-current={activeHeading === i ? "location" : undefined} onClick={() => document.getElementById(`mastering-heading-${book.id}-${i}`)?.scrollIntoView({ block: "start", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" })}>{i + 1} · {heading}</button>)}
          </div>
        </nav>}
        <article className="mastering-reader__article" ref={article}><header><span className="mastering-reader__eyebrow">{libraryBook?.section_name ?? libraryBook?.department_name ?? sections.find(section => section.id === note.data?.section_id)?.name ?? "Без полки"}</span><h2>{note.data.title}</h2><div className="mastering-reader__meta">{book.reading_minutes ? `${book.reading_minutes} мин чтения` : "Пустая книга"}{book.system_name && ` · ${book.system_name}`}</div></header>
          <div className="mastering-reader__prose reading-text" ref={prose}>{note.data.content.trim() ? <MentionText text={note.data.content} /> : <div className="mastering-shelf__empty"><NavIcon name="document" /><p>Добавьте текст, чтобы наполнить книгу.</p><button type="button" onClick={() => setEditOpen(true)}>Написать статью</button></div>}<div className="mastering-text-highlights" ref={highlights} aria-hidden="true" /></div>
        </article>
        {annotations.preferences.open && <MasteringNotesPanel notes={annotations.notes} mode={annotations.preferences.mode} showHighlights={annotations.preferences.highlights} prose={prose.current} activeId={annotations.activeId} loading={annotations.query.loading} error={annotations.query.error} onRetry={annotations.query.reload} onMode={mode => annotations.setPreferences(previous => ({ ...previous, mode }))} onHighlights={highlights => annotations.setPreferences(previous => ({ ...previous, highlights }))} onClose={() => annotations.setPreferences(previous => ({ ...previous, open: false }))} onAdd={() => annotations.openComposer()} onOpen={annotations.setOpenedId} actions={annotations.actions} />}
      </div>}
    </Loadable>
    {annotations.selection && <button type="button" className="mastering-selection-action" ref={annotations.selectionButton} onMouseDown={event => event.preventDefault()} disabled={annotations.saving} onClick={() => void annotations.useSelection()}>{annotations.reattachId ? "Привязать к выделению" : "Добавить заметку"}</button>}
    {annotations.reattachId && <div className="mastering-reattach-hint" role="status">Выделите новую цитату для заметки.<button type="button" onClick={() => annotations.setReattachId(null)}>Отмена</button></div>}
    <MasteringAnnotationDialogs annotations={annotations} />
    {editOpen && note.data && <MasteringBookForm editing hideCategory={!!libraryBook} initial={{...note.data,cover_image:libraryBook?.cover_image??note.data.cover_image}} systems={systems} sections={sections} onSubmit={save} onClose={() => setEditOpen(false)} />}
    {sheetOpen && note.data && <SheetOverlay docKey={libraryBook?.key ?? `mastering-${book.id}`} caption={note.data.title} value={note.data.content} initialMode={note.data.content.trim() ? "reading" : "hybrid"} onSave={saveContent} onClose={() => setSheetOpen(false)} />}
  </div>;
}
