import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAction, useResource, write } from "../data/hooks";
import { useConfirm } from "../hooks/useConfirm";
import { labelled } from "../data/notices";
import {addToBag} from "../bag";
import {SEARCH_DRAG_MIME} from "../components/LinkDropZone";
import { ImageLightbox } from "../components/ImageLightbox";
import { ResourceRow } from "../components/ResourceRow";
import { SoundLibraryTab } from "../components/SoundLibraryTab";
import { SoundSetsTab } from "../components/SoundSetsTab";
import { EmptyState } from "../components/EmptyState";
import { NavIcon } from "../components/NavIcons";
import { SectionBackground } from "../components/SectionBackground";
import { RESOURCE_CATEGORIES, guessResourceCategory, type ResourceCategory } from "../resourceCategories";
import { ListPage } from "../components/ListPage";
import type { Campaign, Resource, Setting } from "../types";
import "./book-library.css";
import {useAuthenticatedFileUrl} from "../utils/fileUrl";

const TEMPLATE_TYPE = "statblock_template";
const NO_CAMPAIGNS: Campaign[] = [];
const NO_SETTINGS: Setting[] = [];
type SortMode = "az" | "size" | "date";

function GalleryResourcePreview({resource,onOpen}:{resource:Resource;onOpen:()=>void}){
  const path=resource.file_url??resource.link_url;
  const authenticated=useAuthenticatedFileUrl(path);
  const url=path?.startsWith('/files/')?authenticated:path;
  return <button type="button" className="library-gallery-preview" draggable onDragStart={e=>e.dataTransfer.setData(SEARCH_DRAG_MIME,JSON.stringify({type:"resource",id:resource.id,title:resource.name}))} aria-label={`Просмотреть: ${resource.name}`} onClick={onOpen}>{url?<img src={url} alt={resource.name} loading="lazy"/>:resource.name}</button>;
}

function categoryOf(r: Resource): ResourceCategory {
  if (r.category && RESOURCE_CATEGORIES.some((c) => c.key === r.category)) return r.category as ResourceCategory;
  return guessResourceCategory(r.file_url || r.link_url || r.name);
}

function sortResources(list: Resource[], mode: SortMode): Resource[] {
  const arr = [...list];
  if (mode === "az") arr.sort((a, b) => a.name.localeCompare(b.name, "ru"));
  else if (mode === "size") arr.sort((a, b) => (b.size_bytes ?? -1) - (a.size_bytes ?? -1));
  else arr.sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
  return arr;
}

const RESOURCE_TABS = [
  { id: "sound", label: "Звук" },
  { id: "sets", label: "Аудио-наборы" },
] as const;

export function ResourcesListPage({mode="other"}:{mode?:"other"|"gallery"}) {
  const gallery=mode==="gallery";
  const [viewIndex,setViewIndex]=useState<number|null>(null);
  const navigate = useNavigate();
  const [section, setSection] = useState<"all" | "sound" | "sets">("all");
  const [query, setQuery] = useState("");
  const run = useAction();
  const [confirmDialog, confirm] = useConfirm();
  const allResources = useResource<Resource[]>(query ? `/resources?q=${encodeURIComponent(query)}` : "/resources", {
    keepPrevious: true,
  }).data;
  const resources = useMemo(() => (allResources ?? []).filter((r) => r.type !== TEMPLATE_TYPE && (gallery ? ["image","map"].includes(categoryOf(r)) : !["pdf","markdown","image","map","audio"].includes(categoryOf(r)) && r.type!=="pdf_notes")), [allResources,gallery]);
  // «M» в счётчике — всё, что вкладка «Разное» могла бы показать без поиска и
  // фильтров. Поиск идёт на сервере, поэтому ответ с `?q=` для этого не
  // годится; полный список — тот же ключ, что без поиска, из кэша слоя.
  // Звук не в счёт: у него своя вкладка. Старые шаблоны исключены из каталога.
  const everyResource = useResource<Resource[]>("/resources").data;
  const shelfTotal = useMemo(
    () => (everyResource ?? []).filter((r) => r.type !== TEMPLATE_TYPE && (gallery?["image","map"].includes(categoryOf(r)):!["pdf","markdown","image","map","audio"].includes(categoryOf(r))&&r.type!=="pdf_notes")).length,
    [everyResource,gallery]
  );
  const campaigns = useResource<Campaign[]>("/campaigns").data ?? NO_CAMPAIGNS;
  const settings = useResource<Setting[]>("/settings").data ?? NO_SETTINGS;
  const [sortMode, setSortMode] = useState<SortMode>("az");
  const [campaignFilter, setCampaignFilter] = useState<number | null>(null);
  const [settingFilter, setSettingFilter] = useState<number | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);

  const [name, setName] = useState("");
  const [type, setType] = useState(gallery?"image":"note");
  const [tags, setTags] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [linkUrl, setLinkUrl] = useState("");

  async function create() {
    if (!name.trim()) return;
    const form = new FormData();
    form.append("name", name);
    form.append("scope", "global");
    form.append("type", type);
    if(gallery)form.append("category",type);
    if (type === "markdown" && !file) { form.append("category", "markdown"); form.append("content", ""); }
    form.append("tags", tags);
    if (file) form.append("file", file);
    if (linkUrl) form.append("link_url", linkUrl);
    const bundle = type === "markdown" && !!file && /\.zip$/i.test(file.name);
    const created = await run(labelled("Новый ресурс", () => write.post<Resource>(bundle ? "/resources/markdown-bundle" : "/resources", form, { timeoutMs: 120000 })), {
      affects: [{ kind: "resource" }],
      retry: false,
    });
    if (created === undefined) return;
    setAddOpen(false);
    setName("");
    setTags("");
    setFile(null);
    setLinkUrl("");
    if (bundle) navigate(`/resources/${created.id}/markdown-file`);
  }

  async function archiveResource(id: number) {
    const target = resources.find((r) => r.id === id);
    const ok = await confirm({
      message: target ? `Отправить ресурс «${target.name}» в архив?` : "Отправить ресурс в архив?",
      confirmLabel: "В архив",
      danger: true,
    });
    if (!ok) return;
    await run(labelled("Ресурс не архивирован", () => write.del(`/resources/${id}`)), {
      affects: [{ kind: "resource" }, { path: "/archive" }],
    });
  }

  const filteredResources = resources.filter((r) => {
    if (campaignFilter && r.campaign_id !== campaignFilter) return false;
    if (settingFilter && r.setting_id !== settingFilter && !(r.also_in_settings ?? []).includes(settingFilter)) {
      return false;
    }
    return true;
  });
  const groups = RESOURCE_CATEGORIES.filter((c) => c.key !== "audio").map((c) => ({
    ...c,
    items: sortResources(
      filteredResources.filter((r) => categoryOf(r) === c.key),
      sortMode
    ),
  })).filter((g) => g.items.length > 0);

  const activeFilters = (campaignFilter ? 1 : 0) + (settingFilter ? 1 : 0);

  const sortToolbar = (
    <>
      <div className="seg res-toolbar__sort" role="group" aria-label="Сортировка">
        <button type="button" className={sortMode === "az" ? "is-active" : ""} onClick={() => setSortMode("az")}>А-Я</button>
        <button type="button" className={sortMode === "size" ? "is-active" : ""} onClick={() => setSortMode("size")}>Размер</button>
        <button type="button" className={sortMode === "date" ? "is-active" : ""} onClick={() => setSortMode("date")}>Дата</button>
      </div>
      <button
        type="button"
        className={`res-toolbar__filters-toggle${filtersOpen ? " is-active" : ""}`}
        onClick={() => setFiltersOpen((v) => !v)}
      >
        Фильтры
        {activeFilters > 0 && <span className="res-toolbar__filters-count">{activeFilters}</span>}
      </button>
      <div className={`res-toolbar__filters${filtersOpen ? " is-open" : ""}`}>
        <label>
          <span className="res-toolbar__filter-label">Кампания</span>
          <select
            value={campaignFilter ?? ""}
            onChange={(e) => setCampaignFilter(e.target.value ? Number(e.target.value) : null)}
          >
            <option value="">Все</option>
            {campaigns.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </label>
        <label>
          <span className="res-toolbar__filter-label">Сеттинг</span>
          <select
            value={settingFilter ?? ""}
            onChange={(e) => setSettingFilter(e.target.value ? Number(e.target.value) : null)}
          >
            <option value="">Все</option>
            {settings.map((st) => (
              <option key={st.id} value={st.id}>{st.name}</option>
            ))}
          </select>
        </label>
      </div>
      <button
        type="button"
        className={`primary res-toolbar__add${addOpen ? " is-active" : ""}`}
        onClick={() => setAddOpen((v) => !v)}
      >
        {addOpen ? "Отмена" : "+ Добавить"}
      </button>
    </>
  );

  return (
    <div className="stack" style={{ position: "relative" }}>
      {confirmDialog}
      {viewIndex!==null&&<ImageLightbox images={filteredResources.map(r=>({id:r.id,image_url:r.file_url??r.link_url??"",caption:r.name}))} index={viewIndex} onIndexChange={setViewIndex} onClose={()=>setViewIndex(null)} onDelete={id=>{setViewIndex(null);void archiveResource(id);}} onCaptionChange={(id,caption)=>{void run(()=>write.put(`/resources/${id}`,{name:caption}),{affects:[{kind:"resource",id}]});}}/>}
      <SectionBackground />
      <ListPage
        headingSection="resources"
        title={gallery?"Галерея":"Другие материалы"}
        groups={[]}
        // Не «Все»: звук живёт своей вкладкой, здесь — остальное
        // (PDF, изображения, заметки, ссылки). Имя дал владелец 2026-09-18.
        allLabel={gallery?"Изображения и карты":"Разное"}
        ungroupedLabel={null}
        activeGroup={section === "all" ? null : section}
        onGroupChange={(g) => setSection(g === null ? "all" : g as typeof section)}
        extraTabs={gallery?[]:RESOURCE_TABS}
        search={query}
        onSearch={setQuery}
        searchPlaceholder="Поиск по названию…"
        searchLabel="Поиск по ресурсам"
        filteredCount={groups.reduce((n, g) => n + g.items.length, 0)}
        totalCount={shelfTotal}
        onResetSearch={() => { setQuery(""); setCampaignFilter(null); setSettingFilter(null); }}
        showReset={query.trim() !== "" || campaignFilter !== null || settingFilter !== null}
        toolbarExtra={sortToolbar}
        // Тулбар — инструмент вкладки «Разное»: у Звука и наборов
        // поиск свой, а общий показывал там «0 / N».
        hideToolbar={section !== "all"}
      >
        {section === "all" ? (
          <>
            {addOpen && (
              <div className="card res-add">
                <input placeholder="Название" value={name} onChange={(e) => setName(e.target.value)} />
                <select value={type} onChange={(e) => setType(e.target.value)}>
                  {gallery?<option value="image">Изображение</option>:<option value="note">Заметка</option>}
                  {!gallery&&<option value="item">Предмет</option>}
                  <option value="map">Карта</option>
                  {!gallery&&<option value="markdown">Markdown (.md)</option>}
                </select>
                <input
                  placeholder="Теги через запятую"
                  value={tags}
                  onChange={(e) => setTags(e.target.value)}
                />
                <input type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
                {type === "markdown" && <small>Можно выбрать один .md или ZIP с .md и его вложениями.</small>}
                <input
                  placeholder="…или ссылка (вместо файла)"
                  value={linkUrl}
                  onChange={(e) => setLinkUrl(e.target.value)}
                />
                <button className="primary" onClick={create}>
                  Добавить
                </button>
              </div>
            )}

            {groups.length === 0 && (
              <EmptyState kind={query || campaignFilter || settingFilter ? "search" : "primary"}
                title="Полки пусты"
                hint={
                  query || campaignFilter || settingFilter
                    ? "Ничего не найдено — попробуйте другой запрос или снимите фильтры."
                    : "Ни одного ресурса ещё не добавлено — загрузите первый выше."
                }
                action={
                  (query || campaignFilter || settingFilter) ? (
                    <button
                      onClick={() => {
                        setQuery("");
                        setCampaignFilter(null);
                        setSettingFilter(null);
                      }}
                    >
                      Сбросить фильтры
                    </button>
                  ) : undefined
                }
              />
            )}

            {groups.map((g) => (
              <details key={g.key} className="card res-group" open={gallery?true:undefined}>
                <summary className="res-group__band">
                  <NavIcon name="chevron" className="chevron-icon" />
                  <NavIcon name={g.icon} className="res-group__icon" />
                  <span className="res-group__title">{g.label}</span>
                  <span className="res-group__count">{g.items.length}</span>
                </summary>
                <div className="res-group__body">
                  {g.items.map((r) => (
                    <div key={r.id}>{gallery&&<div className="row">
                      {(r.file_url||r.link_url)&&<GalleryResourcePreview resource={r} onOpen={()=>setViewIndex(filteredResources.indexOf(r))}/>}
                      <button onClick={()=>addToBag({type:"resource",id:r.id,title:r.name})}>В мешок</button>
                    </div>}<ResourceRow
                      resource={r}
                      onArchive={archiveResource}
                      allSettings={settings}
                    /></div>
                  ))}
                </div>
              </details>
            ))}
          </>
        ) : section === "sound" ? (
          <SoundLibraryTab />
        ) : (
          <SoundSetsTab />
        )}
      </ListPage>
    </div>
  );
}
