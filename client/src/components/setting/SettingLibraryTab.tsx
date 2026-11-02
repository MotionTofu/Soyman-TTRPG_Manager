import { useRef } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAction, useResource, write } from "../../data/hooks";
import { MasteringShelf } from "../mastering/MasteringShelf";

import { LIBRARY_AFFECTS, type LibraryCatalog } from "../mastering/libraryTypes";
import "../../pages/mastering-library.css";

// «Библиотека» сеттинга (разбор профиля сеттинга, Q16; макет — доска 24):
// PDF и Markdown этого сеттинга той же полкой, что в общей Библиотеке, — те же
// книги того же размера. Открываются в её читалке, с заметками и тетрадью.

const NO_COVERS = new Map<string, string>();
const NO_BOOKMARKS = new Set<number>();

export function SettingLibraryTab({ settingId }: { settingId: number }) {
  const run = useAction();
  const navigate = useNavigate();
  const upload = useRef<HTMLInputElement>(null);
  const catalog = useResource<LibraryCatalog>(`/book-library/books?setting=${settingId}&include_unplaced=1&limit=200`);
  const books = catalog.data?.books.filter(b=>b.source_type!=="workbook") ?? [];
  const notebooks=catalog.data?.books.filter(b=>b.source_type==="workbook")??[];

  async function importFile(file: File | undefined) {
    if (!file) return;
    const data = new FormData();
    data.append("file", file);
    data.append("name", file.name.replace(/\.(pdf|md|zip)$/i, ""));
    data.append("scope", "setting");
    data.append("setting_id", String(settingId));
    if (/\.(md|zip)$/i.test(file.name)) data.append("type", "markdown");
    await run(() => write.post(/\.zip$/i.test(file.name) ? "/resources/markdown-bundle" : "/resources", data, { timeoutMs: 120000 }), {
      affects: [{ kind: "resource" }, ...LIBRARY_AFFECTS],
      retry: false,
    });
  }

  async function startWorkbook() {
    const result = await run(() => write.post<{ id: number }>(`/workbooks/projects/setting/${settingId}/notebook`, {}), { affects: [{ path: "/workbooks" }, { path: "/book-library" }], retry: false });
    if (result) navigate(`/workbooks/${result.id}`);
  }

  return (
    <div className="setting-library">
      {[{role:"projects",title:"Тетради"},{role:"campaigns",title:"Тетради кампаний"}].map(({role,title})=><MasteringShelf key={role} shelf={null} title={title} shelfKey={`setting-${settingId}-${role}`} books={notebooks.filter(b=>b.workbook_role===role)} search={false} covers={NO_COVERS} bookmarked={NO_BOOKMARKS} dragging={null} dragOver={false} onDrag={()=>{}} onDrop={()=>{}} onAdd={()=>role === "projects" ? void startWorkbook() : navigate("/workbooks")} onOpen={id=>{const book=notebooks.find(b=>b.id===id);if(book)navigate(`/workbooks/${book.source_id}`);}}/>)}
      <div className="population__toolbar">
        <span className="muted">PDF и Markdown этого сеттинга</span>
        <span className="population__spacer" />
        <Link to="/mastering">Открыть в Библиотеке ›</Link>
        <button type="button" className="d-btn" onClick={() => upload.current?.click()}>
          PDF или Markdown
        </button>
        <input
          ref={upload}
          type="file"
          accept=".pdf,.md,.zip"
          hidden
          onChange={(e) => {
            void importFile(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
      </div>
      <MasteringShelf
        shelf={null}
        title="Книги сеттинга"
        shelfKey={`setting-${settingId}`}
        books={books}
        search={false}
        covers={NO_COVERS}
        bookmarked={NO_BOOKMARKS}
        dragging={null}
        dragOver={false}
        onDrag={() => {}}
        onDrop={() => {}}
        onAdd={() => upload.current?.click()}
        onOpen={(id) => navigate(`/mastering?book=${id}`)}
        onNotes={(id) => navigate(`/mastering?book=${id}&notes=1`)}
      />
      <p className="muted">Книга открывается в читалке Библиотеки — с заметками и тетрадью у края. Обложка и полка настраиваются там же.</p>
    </div>
  );
}
