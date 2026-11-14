import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAction, useResource, write } from "../data/hooks";
import { readOnce } from "../data/imperative";
import { ListPage } from "../components/ListPage";
import { RegMeta, RegRow, RegTable, RegTile, RegTiles, useListView, type RegColumn } from "../components/ListRegistry";
import { EmptyState } from "../components/EmptyState";
import { Loadable, ListSkeleton } from "../components/Loadable";
import { Modal } from "../components/Modal";
import { formatDateKeyRu } from "../utils/date";
import { openSecondWindow } from "../electronApi";
import { WORKBOOK_AFFECTS, downloadWorkbook, type InstanceSummary, type TemplateSummary } from "../components/workbooks/model";
import type { LibraryDepartment, LibraryShelf, LibraryCatalog } from "../components/mastering/libraryTypes";
import "./workbook.css";

const purposes: Record<string, string> = {
  campaign: "Кампания", adventure: "Приключение", setting: "Сеттинг", standalone: "Просто тетрадь",
};

const columns: RegColumn[] = [
  { label: "Название", width: "minmax(0, 1fr)" },
  { label: "Шаблон", width: "minmax(0, 1fr)" },
  { label: "Заполнено", width: "minmax(0, 8rem)", phone: true },
];

export function LibraryWorkbooks() {
  const run = useAction();
  const navigate = useNavigate();
  const [tab, setTab] = useState<"mine" | "templates">("mine");
  const [archived, setArchived] = useState(false);
  const [query, setQuery] = useState("");
  const [purpose, setPurpose] = useState("");
  const [view, setView] = useListView("library-workbooks");
  const [error, setError] = useState("");
  const [creating, setCreating] = useState<number | null | "pick">(null);
  const [placement, setPlacement] = useState<InstanceSummary | null>(null);
  const [versions, setVersions] = useState<TemplateSummary | null>(null);
  const upload = useRef<HTMLInputElement>(null);
  const templates = useResource<TemplateSummary[]>("/workbooks/templates");
  const instances = useResource<InstanceSummary[]>(`/workbooks/instances${archived ? "?archived=1" : ""}`);
  const archivedInstances = useResource<InstanceSummary[]>("/workbooks/instances?archived=1");
  const templatesByKey = new Map<string, TemplateSummary>();
  for (const template of templates.data ?? []) {
    const previous = templatesByKey.get(template.template_key);
    if (!template.archived_at && (!previous || previous.version < template.version)) {
      templatesByKey.set(template.template_key, template);
    }
  }
  const latest = [...templatesByKey.values()].sort((a, b) => a.title.localeCompare(b.title, "ru"));
  const term = query.trim().toLocaleLowerCase("ru");
  const matches = (...fields: string[]) => fields.some(field => field.toLocaleLowerCase("ru").includes(term));
  const visibleInstances = (instances.data ?? []).filter(item =>
    matches(item.title, item.template_title ?? "", item.project_name ?? "") && (!purpose || (item.project_type ?? "standalone") === purpose));
  const visibleTemplates = latest.filter(item => matches(item.title));

  async function importFile(file: File | undefined) {
    if (!file) return;
    setError("");
    try {
      if (file.size > 4 * 1024 * 1024) throw new Error("Файл шаблона или тетради должен быть до 4 МБ");
      const text = await file.text();
      if (/\.md$/i.test(file.name)) {
        const imported = await run(() => write.post("/workbooks/templates", { markdown: text }), { affects: WORKBOOK_AFFECTS, retry: false });
        if (imported) setTab("templates");
        return;
      }
      const data = JSON.parse(text);
      await run(() => write.post(data.format === "soyman-workbook" ? "/workbooks/templates" : "/workbooks/import", data), {
        affects: WORKBOOK_AFFECTS, retry: false,
      });
    } catch (err) {
      setError((err as Error).message);
    }
  }

  function instanceEntry(item: InstanceSummary) {
    const to = `/workbooks/${item.id}`;
    const entity = { type: "workbook", id: item.id, name: item.title };
    const progress = item.progress ?? { total: 0, filled: 0 };
    const filled = `${progress.filled} из ${progress.total} граф`;
    const menu = [
      { label: "Отдельное окно", onClick: () => openSecondWindow(`/workbook-window/${item.id}`) },
      ...(!archived ? [{ label: "На полку…", onClick: () => setPlacement(item) }] : []),
      { label: "Скачать .json", onClick: () => void run(async () => {
        const bundle = await readOnce(`/workbooks/instances/${item.id}/export`);
        downloadWorkbook(`${item.title}.workbook.json`, JSON.stringify(bundle, null, 2));
      }, { affects: [] }) },
      { label: archived ? "Вернуть из архива" : "В архив", danger: !archived, onClick: () => {
        void run(() => write.put(`/workbooks/instances/${item.id}`, {
          revision: item.revision, archived: !archived,
        }), { affects: WORKBOOK_AFFECTS });
      } },
    ];
    return view === "rows"
      ? <RegRow key={item.id} entity={entity} to={to} columns={columns} cells={[item.template_title, filled]} menu={menu} />
      : <RegTile key={item.id} entity={entity} to={to} menu={menu} plate="Тетрадь">
          <RegMeta>{item.template_title} · v{item.template_version}</RegMeta>
          <RegMeta>{[purposes[item.project_type ?? "standalone"], item.project_name].filter(Boolean).join(" · ")}</RegMeta>
          <progress max={Math.max(1, progress.total)} value={progress.filled} aria-label={filled} />
          <RegMeta>{filled}{item.updated_at && ` · ${formatDateKeyRu(item.updated_at.slice(0, 10))}`}</RegMeta>
        </RegTile>;
  }

  function templateEntry(item: TemplateSummary) {
    const menu = <details className="library-menu">
      <summary className="d-btn d-btn--sm" aria-label={`Действия: ${item.title}`}>⋯</summary>
      <div className="library-menu__items">
        <button type="button" onClick={event => {
          event.currentTarget.closest("details")?.removeAttribute("open");
          setVersions(item);
        }}>Версии</button>
      </div>
    </details>;
    const start = <button type="button" className="d-btn d-btn--sm" onClick={() => setCreating(item.id)}>Начать тетрадь</button>;
    if (view === "rows") return <div key={item.id} className="reg-row" role="row">
      <span role="cell" className="reg-row__name">{item.title}</span>
      <span role="cell" className="reg-row__cell reg-wide">v{item.version}</span>
      <span role="cell" className="reg-row__cell">{start}</span>
      <span role="cell">{menu}</span>
    </div>;
    return <article key={item.id} className="reg-tile library-template-tile">
      <div className="reg-tile__body">
        <h3 className="reg-tile__name">{item.title}</h3>
        <RegMeta>Версия {item.version}</RegMeta>
        {start}
      </div>
      <div className="library-template-tile__menu">{menu}</div>
    </article>;
  }

  const list = tab === "mine" ? visibleInstances.map(instanceEntry) : visibleTemplates.map(templateEntry);
  const activeQuery = tab === "mine" ? instances : templates;
  const archiveCount = archivedInstances.data?.length ?? 0;
  const tableColumns = tab === "mine" ? columns : [
    columns[0], { ...columns[1], label: "Версия" }, { ...columns[2], label: "Действие" },
  ];
  return <>
    <div className="library-registry__actions">
      <button className="d-btn" type="button" onClick={() => upload.current?.click()}>Загрузить шаблон</button>
      <button className="d-btn d-btn--primary" type="button" disabled={!latest.length} onClick={() => setCreating("pick")}>+ Новая тетрадь</button>
      <input ref={upload} className="sr-only" type="file" accept=".md,.json" aria-label="Файл шаблона или тетради"
        onChange={event => { void importFile(event.target.files?.[0]); event.target.value = ""; }} />
    </div>
    {error && <p role="alert">{error}</p>}
    <ListPage ds embedded title="Тетради" groups={[]} allLabel={null}
      extraTabs={[{ id: "mine", label: "Мои тетради" }, { id: "templates", label: "Шаблоны", count: latest.length }]}
      activeGroup={tab} onGroupChange={value => setTab(value === "templates" ? "templates" : "mine")}
      search={query} onSearch={setQuery} searchPlaceholder="Поиск по названию, проекту…"
      filteredCount={list.length} totalCount={tab === "mine" ? instances.data?.length ?? 0 : latest.length}
      onResetSearch={() => { setQuery(""); setArchived(false); setPurpose(""); }} showReset={!!term || archived || (tab === "mine" && !!purpose)}
      view={view} onViewChange={setView}
      filters={tab === "mine" && <div className="row">
        <label>Для чего <select value={purpose} onChange={event => setPurpose(event.target.value)}>
          <option value="">Все</option>
          {Object.entries(purposes).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
        </select></label>
        {(archiveCount > 0 || archived) && <button className="d-btn d-btn--sm" type="button"
          aria-pressed={archived} onClick={() => setArchived(value => !value)}>Архив · {archiveCount}</button>}
      </div>}>
      <Loadable loading={activeQuery.loading} error={activeQuery.error} errorTitle="Не удалось загрузить тетради" onRetry={activeQuery.reload} skeleton={<ListSkeleton variant="tiles" />}>
        {list.length ? view === "rows"
          ? <RegTable columns={tableColumns} label="Тетради">{list}</RegTable>
          : <RegTiles>{list}</RegTiles>
          : <EmptyState kind={term ? "search" : "primary"}
              title={term ? "Ничего не найдено" : tab === "templates" ? "Шаблонов пока нет" : archived ? "В архиве пока пусто" : "Тетрадей пока нет"}
              action={!term && !archived && <div className="library-registry__actions">
                <a href="/workbook-example.md" download>Пример шаблона</a>
                <a href="/workbook-author-guide.md" download>Как сделать шаблон</a>
              </div>} />}
      </Loadable>
    </ListPage>
    {creating !== null && <NewWorkbook templates={latest} initial={creating === "pick" ? null : creating}
      onClose={() => setCreating(null)} onCreated={id => navigate(`/workbooks/${id}`)} />}
    {placement && <Placement workbook={placement} onClose={() => setPlacement(null)} onError={setError} />}
    {versions && <Modal ariaLabel="Версии шаблона" onClose={() => setVersions(null)}>
      <div className="stack">
        <h2>{versions.title} · Версии</h2>
        {(templates.data ?? []).filter(item => item.template_key === versions.template_key).sort((a, b) => b.version - a.version)
          .map(item => <div key={item.id} className="row">
            <span>Версия {item.version}{item.archived_at ? " · архив" : ""}</span>
            <button type="button" onClick={() => void run(async () => {
              const data = await readOnce(`/workbooks/templates/${item.id}`);
              downloadWorkbook(`${item.template_key}-v${item.version}.json`, JSON.stringify(data, null, 2));
            }, { affects: [] })}>Скачать</button>
            <button type="button" onClick={() => void run(() => write.put(`/workbooks/templates/${item.id}/archive`, {
              archived: !item.archived_at,
            }), { affects: WORKBOOK_AFFECTS })}>{item.archived_at ? "Восстановить" : "В архив"}</button>
          </div>)}
      </div>
    </Modal>}
  </>;
}

function NewWorkbook({templates,initial,onClose,onCreated}:{templates:TemplateSummary[];initial:number|null;onClose:()=>void;onCreated:(id:number)=>void}){
 const run=useAction(),[templateId,setTemplateId]=useState(initial?String(initial):templates.length===1?String(templates[0].id):""),[title,setTitle]=useState("");
 const [projectType,setProjectType]=useState(""),[projectId,setProjectId]=useState("");
 const projects=useResource<{id:number;name:string}[]>(projectType?`/workbooks/projects/${projectType}`:null);
 async function create(){const result=await run(()=>write.post<{id:number}>("/workbooks/instances",{template_id:Number(templateId),title:title.trim(),project_type:projectType||null,project_id:projectId?Number(projectId):null}),{affects:WORKBOOK_AFFECTS,retry:false});if(result)onCreated(result.id);}
 return <Modal ariaLabel="Новая тетрадь" onClose={onClose}><div className="stack"><h2>Новая тетрадь</h2>
  <label>Шаблон<select value={templateId} onChange={e=>setTemplateId(e.target.value)}><option value="">Выбрать</option>{templates.map(t=><option value={t.id} key={t.id}>{t.title}</option>)}</select></label>
  <label>Название<input value={title} placeholder="Например, Ваншот «Маяк»" onChange={e=>setTitle(e.target.value)}/></label>
  <label>Для чего<select value={projectType} onChange={e=>{setProjectType(e.target.value);setProjectId("");}}><option value="">Просто тетрадь</option><option value="campaign">Кампания</option><option value="setting">Сеттинг</option><option value="adventure">Приключение</option></select></label>
  {projectType&&<select aria-label="Проект" value={projectId} onChange={e=>setProjectId(e.target.value)}><option value="">Выбрать</option>{projects.data?.map(p=><option value={p.id} key={p.id}>{p.name}</option>)}</select>}
  <button className="d-btn d-btn--primary" disabled={!title.trim()||!templateId||!!projectType&&!projectId} onClick={()=>void create()}>Начать</button>
 </div></Modal>;
}

function Placement({workbook,onClose,onError}:{workbook:InstanceSummary;onClose:()=>void;onError:(message:string)=>void}){
 const run=useAction(),[department,setDepartment]=useState(""),[shelf,setShelf]=useState("");
 const departments=useResource<LibraryDepartment[]>("/book-library/departments"),shelves=useResource<LibraryShelf[]>("/book-library/shelves");
 async function place(){try{const result=await readOnce<LibraryCatalog>(`/book-library/books?source_type=workbook&source_id=${workbook.id}&include_unplaced=1`);const book=result.books[0];if(!book)throw new Error("Тетрадь не найдена");const saved=await run(()=>write.put(`/book-library/books/${book.id}`,{department_id:department?Number(department):null,shelf_id:shelf?Number(shelf):null}),{affects:WORKBOOK_AFFECTS});if(saved!==undefined)onClose();}catch(e){onError((e as Error).message);}}
 return <Modal ariaLabel="Тетрадь на полке" onClose={onClose}><div className="stack"><h2>{workbook.title} — на полку</h2>
  <label>Подраздел<select value={department} onChange={e=>{setDepartment(e.target.value);setShelf("");}}><option value="">Без подраздела</option>{departments.data?.map(d=><option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
  <label>Полка<select value={shelf} onChange={e=>setShelf(e.target.value)}><option value="">Без полки</option>{shelves.data?.filter(s=>s.department_id===(department?Number(department):null)).map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
  <button className="primary" onClick={()=>void place()}>Поставить</button>
 </div></Modal>;
}
