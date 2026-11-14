import { useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { ListPage } from "../components/ListPage";
import { RegArchive, RegMeta, RegRow, RegTable, RegTile, RegTiles, useListView, type RegColumn } from "../components/ListRegistry";
import { EmptyState } from "../components/EmptyState";
import { Loadable, ListSkeleton } from "../components/Loadable";
import { Modal } from "../components/Modal";
import { ResourceRow } from "../components/ResourceRow";
import { useAction, useResource, write } from "../data/hooks";
import { useConfirm } from "../hooks/useConfirm";
import { guessResourceCategory } from "../resourceCategories";
import type { ArchiveItem, Campaign, Resource, Setting } from "../types";
import { formatDateKeyRu } from "../utils/date";

const categories = [
  { id: "note", label: "Заметки", name: "Заметка" },
  { id: "item", label: "Предметы", name: "Предмет" },
  { id: "link", label: "Ссылки", name: "Ссылка или папка" },
  { id: "file", label: "Файлы", name: "Файл" },
] as const;
type Kind = typeof categories[number]["id"];
const columns: RegColumn[] = [
  { label: "Название", width: "minmax(0, 1fr)" },
  { label: "Вид", width: "minmax(0, 7rem)", phone: true },
  { label: "Где", width: "minmax(0, 10rem)" },
  { label: "Добавлено", width: "minmax(0, 8rem)" },
];
const affects = [{ kind: "resource" }, { path: "/archive" }] as const;

function isMisc(type: string, category: string, attached: boolean) {
  return !["pdf_notes", "markdown", "statblock_template"].includes(type) &&
    !["image", "map", "audio"].includes(category) &&
    !(attached && ["pdf", "markdown"].includes(category));
}

function inMiscArchive(item: ArchiveItem) {
  const extension = item.resource_extension || item.resource_link_category_hint;
  const category = item.resource_category || guessResourceCategory(extension || item.title);
  return isMisc(item.resource_type ?? "", category, !!item.resource_extension);
}

function miscKind(resource: Resource): Kind | null {
  const category = resource.category || guessResourceCategory(resource.file_url || resource.link_url || resource.name);
  if (!isMisc(resource.type, category, !!resource.file_path)) return null;
  if (resource.type === "item") return "item";
  if (resource.file_path || resource.type === "file") return "file";
  if (resource.link_url || category === "folder" || resource.type === "link") return "link";
  return resource.type === "note" ? "note" : "file";
}

export function LibraryMisc() {
  const [params, setParams] = useSearchParams();
  const [confirmDialog, confirm] = useConfirm();
  const run = useAction();
  const resources = useResource<Resource[]>("/resources");
  const campaigns = useResource<Campaign[]>("/campaigns").data ?? [];
  const settings = useResource<Setting[]>("/settings").data ?? [];
  const [kind, setKind] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [owner, setOwner] = useState("");
  const [sort, setSort] = useState("recent");
  const [view, setView] = useListView("library-misc");
  const [creating, setCreating] = useState<Kind | null>(null);
  const records = (resources.data ?? []).flatMap(resource => {
    const kind = miscKind(resource);
    return kind ? [{ resource, kind }] : [];
  });
  const term = query.trim().toLocaleLowerCase("ru");
  const visible = records.filter(({ resource, kind: entryKind }) =>
    (!kind || kind === entryKind) &&
    (!term || `${resource.name} ${resource.tags}`.toLocaleLowerCase("ru").includes(term)) &&
    (!owner || owner === `campaign:${resource.campaign_id}` || owner === `setting:${resource.setting_id}` ||
      resource.also_in_settings?.some(id => owner === `setting:${id}`))
  ).sort((a, b) => {
    if (sort === "name") return a.resource.name.localeCompare(b.resource.name, "ru");
    if (sort === "size") return (b.resource.size_bytes ?? 0) - (a.resource.size_bytes ?? 0);
    return b.resource.created_at.localeCompare(a.resource.created_at);
  });
  const selected = records.find(({ resource }) => String(resource.id) === params.get("resource"))?.resource;
  const owners = [
    ...campaigns.map(item => ({ value: `campaign:${item.id}`, label: `${item.name} · кампания` })),
    ...settings.map(item => ({ value: `setting:${item.id}`, label: `${item.name} · сеттинг` })),
  ];

  function closeResource() {
    const next = new URLSearchParams(params);
    next.delete("resource");
    setParams(next, { replace: true });
  }

  async function archive(id: number) {
    const target = records.find(({ resource }) => resource.id === id)?.resource;
    if (!target || !await confirm({ message: `Отправить «${target.name}» в архив?`, confirmLabel: "В архив", danger: true })) return;
    const removed = await run(() => write.del(`/resources/${id}`).then(() => true), { affects: [...affects] });
    if (removed && selected?.id === id) closeResource();
  }

  function entry({ resource, kind }: typeof records[number]) {
    const to = `/mastering?tab=misc&resource=${resource.id}`;
    const entity = { type: "resource", id: resource.id, name: resource.name };
    const label = resource.category === "folder" ? "Папка" : kind === "link" ? "Ссылка" : categories.find(item => item.id === kind)!.name;
    const where = owners.find(item => item.value === `campaign:${resource.campaign_id}` ||
      item.value === `setting:${resource.setting_id}`)?.label ?? "—";
    const added = formatDateKeyRu(resource.created_at.slice(0, 10));
    const menu = [
      { label: "Открыть карточку", onClick: () => setParams({ tab: "misc", resource: String(resource.id) }) },
      { label: "В архив", danger: true, onClick: () => void archive(resource.id) },
    ];
    return view === "rows"
      ? <RegRow key={resource.id} entity={entity} to={to} columns={columns} cells={[label, where, added]} menu={menu} />
      : <RegTile key={resource.id} entity={entity} to={to} menu={menu} plate={label}>
          <RegMeta>{where}</RegMeta>
          <RegMeta>{added}</RegMeta>
        </RegTile>;
  }

  return <>
    {confirmDialog}
    <div className="library-registry__actions">
      <details className="library-menu">
        <summary className="d-btn d-btn--primary">+ Добавить ▾</summary>
        <div className="library-menu__items">
          {categories.map(item => <button key={item.id} type="button" onClick={event => {
            event.currentTarget.closest("details")?.removeAttribute("open");
            setCreating(item.id);
          }}>{item.name}…</button>)}
        </div>
      </details>
    </div>
    <ListPage title="Разное" ds embedded groups={[]} allCount={records.length} activeGroup={kind} onGroupChange={setKind}
      extraTabs={categories.map(item => ({ ...item, count: records.filter(record => record.kind === item.id).length }))}
      search={query} onSearch={setQuery} searchPlaceholder="Поиск по названию, тегам…"
      filteredCount={visible.length} totalCount={records.filter(item => !kind || item.kind === kind).length}
      onResetSearch={() => { setQuery(""); setOwner(""); setSort("recent"); }} showReset={!!term || !!owner || sort !== "recent"}
      view={view} onViewChange={setView}
      filters={<div className="row">
        <label>Где <select value={owner} onChange={event => setOwner(event.target.value)}>
          <option value="">Везде</option>
          {owners.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
        </select></label>
        <label>Порядок <select value={sort} onChange={event => setSort(event.target.value)}>
          <option value="recent">Недавние</option><option value="name">А–Я</option><option value="size">Размер</option>
        </select></label>
      </div>}>
      <Loadable loading={resources.loading} error={resources.error} errorTitle="Не удалось загрузить материалы" onRetry={resources.reload} skeleton={<ListSkeleton variant="tiles" />}>
        {visible.length ? view === "rows"
          ? <RegTable columns={columns} label="Разное">{visible.map(entry)}</RegTable>
          : <RegTiles>{visible.map(entry)}</RegTiles>
          : <EmptyState kind={term || owner ? "search" : "primary"} title={term || owner ? "Ничего не найдено" : "Материалов пока нет"} />}
      </Loadable>
      <RegArchive type="resource" basePath="/resources" affects={[...affects]} include={inMiscArchive} />
    </ListPage>
    {creating && <MiscForm kind={creating} owners={owners} onClose={() => setCreating(null)} />}
    {selected && <Modal wide ariaLabel={selected.name} onClose={closeResource}>
      <h2>{selected.name}</h2>
      {selected.notes && <p>{selected.notes}</p>}
      <ResourceRow key={selected.id} resource={selected} allSettings={settings} onArchive={id => void archive(id)} />
    </Modal>}
  </>;
}

function MiscForm({ kind, owners, onClose }: {
  kind: Kind;
  owners: { value: string; label: string }[];
  onClose: () => void;
}) {
  const run = useAction();
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [tags, setTags] = useState("");
  const [notes, setNotes] = useState("");
  const [owner, setOwner] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const title = categories.find(item => item.id === kind)!.name;
  async function save(event: FormEvent) {
    event.preventDefault();
    if (saving || !name.trim() || (kind === "link" && !address.trim()) || (kind === "file" && !file)) return;
    const [scope = "", ownerId = ""] = owner.split(":");
    const form = new FormData();
    form.set("name", name.trim());
    form.set("type", kind);
    form.set("scope", scope || "global");
    if (ownerId) form.set(`${scope}_id`, ownerId);
    form.set("tags", tags);
    form.set("notes", notes);
    if (kind === "link") {
      form.set("link_url", address.trim());
      form.set("category", guessResourceCategory(address.trim()) === "folder" ? "folder" : "link");
    }
    if (kind === "file" && file) {
      form.set("category", "other");
      form.set("file", file);
    }
    setSaving(true);
    try {
      const created = await run(() => write.post<Resource>("/resources", form, { timeoutMs: 120_000 }), { affects: [...affects], retry: false });
      if (created) onClose();
    } finally {
      setSaving(false);
    }
  }
  return <Modal ariaLabel={title} onClose={onClose}>
    <form className="stack library-org-form" onSubmit={event => void save(event)}>
      <h2>{title}</h2>
      <label>Название<input required value={name} onChange={event => setName(event.target.value)} /></label>
      {kind === "link" && <label>Адрес<input required placeholder="https://… или путь к папке" value={address} onChange={event => setAddress(event.target.value)} /></label>}
      {kind === "file" && <label>Файл<input required type="file" onChange={event => setFile(event.target.files?.[0] ?? null)} /></label>}
      <label>Где<select value={owner} onChange={event => setOwner(event.target.value)}>
        <option value="">Везде</option>
        {owners.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
      </select></label>
      <label>Теги<input value={tags} onChange={event => setTags(event.target.value)} /></label>
      {(kind === "note" || kind === "item") && <label>Текст<textarea value={notes} onChange={event => setNotes(event.target.value)} /></label>}
      <div className="mastering-form-actions">
        <button type="button" onClick={onClose}>Отмена</button>
        <button type="submit" className="d-btn d-btn--primary" disabled={saving}>Добавить</button>
      </div>
    </form>
  </Modal>;
}
