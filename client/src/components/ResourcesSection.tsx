import { memo, useEffect, useState, type ChangeEvent, type DragEvent } from "react";
import { api } from "../api/client";
import { Modal } from "./Modal";
import { MentionTextarea } from "./mentions/MentionTextarea";
import { MentionText } from "./mentions/MentionText";
import { syncMentionLinks } from "../mentions";
import { RESOURCE_CATEGORIES, guessResourceCategory, type ResourceCategory } from "../resourceCategories";
import { hasElectronAPI } from "../electronApi";
import { SEARCH_DRAG_MIME } from "./LinkDropZone";
import { NavIcon } from "./NavIcons";
import type { SoundSetDetail, SoundSetSummary } from "../sound/types";
import type { Resource, SearchResult } from "../types";

const IMAGE_EXT = /\.(jpe?g|png|gif|webp)$/i;
const AUDIO_EXT = /\.(mp3|wav|ogg|m4a|flac|aac)$/i;

type Scope = "session" | "setting";

interface GenericLink {
  id: number;
  from_type: string;
  from_id: number;
  to_type: string;
  to_id: number;
}

interface AttachedEntry {
  linkId: number;
  resource: Resource;
}

interface Props {
  scope: Scope;
  entityId: number;
  resources: Resource[];
  onChange: () => void;
  // Only meaningful for scope==="session" — the campaign's setting, if any.
  // Enables "attach an existing setting resource" (drag from search) and
  // "В сеттинг" (promote an owned resource up to that setting) so the
  // same file doesn't get re-uploaded into every session that needs it.
  settingId?: number | null;
}

// Shared "Ресурсы" UI for both sessions and settings: modal-based creation,
// category grouping, row layout, native OS file drag-and-drop. Session scope
// additionally supports attaching an existing setting-scoped resource
// (without duplicating the file) and promoting an owned resource up to the
// setting for reuse across sessions.
// Memoized — see ObstacleDropZone's comment. `resources` and `onChange` are
// a fresh array/closure on every parent render unless the caller stabilizes
// them (useMemo/useCallback); otherwise this still re-renders every time,
// same as before.
export const ResourcesSection = memo(function ResourcesSection({
  scope,
  entityId,
  resources,
  onChange,
  settingId,
}: Props) {
  const [modalOpen, setModalOpen] = useState(false);
  const [draftFile, setDraftFile] = useState<File | null>(null);
  const [draftName, setDraftName] = useState("");
  const [draftCategory, setDraftCategory] = useState<ResourceCategory>("link");
  const [draftLinkUrl, setDraftLinkUrl] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [attached, setAttached] = useState<AttachedEntry[]>([]);
  const [libraryOpen, setLibraryOpen] = useState(false);

  async function loadAttached() {
    const links = await api.get<GenericLink[]>(
      `/links?type=${scope}&id=${entityId}&section=attached_resource`
    );
    const resolved = await Promise.all(
      links.map(async (l) => {
        const resourceId = l.from_type === "resource" ? l.from_id : l.to_id;
        try {
          const resource = await api.get<Resource>(`/resources/${resourceId}`);
          return { linkId: l.id, resource };
        } catch {
          return null;
        }
      })
    );
    setAttached(resolved.filter((e): e is AttachedEntry => e !== null));
  }

  useEffect(() => {
    loadAttached();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, entityId]);

  function openModal(file?: File) {
    if (file) {
      setDraftFile(file);
      setDraftName(file.name);
      setDraftCategory(guessResourceCategory(file.name));
      setDraftLinkUrl("");
    } else {
      setDraftFile(null);
      setDraftName("");
      setDraftCategory("link");
      setDraftLinkUrl("");
    }
    setModalOpen(true);
  }

  async function submitModal() {
    if (!draftName.trim()) return;
    const form = new FormData();
    form.append("name", draftName.trim());
    form.append("type", "link");
    form.append("scope", scope);
    form.append(scope === "session" ? "session_id" : "setting_id", String(entityId));
    form.append("category", draftCategory);
    if (draftFile) form.append("file", draftFile);
    else if (draftLinkUrl.trim()) form.append("link_url", draftLinkUrl.trim());
    await api.post("/resources", form);
    setModalOpen(false);
    onChange();
  }

  async function createFromFile(file: File) {
    const form = new FormData();
    form.append("name", file.name);
    form.append("type", "link");
    form.append("scope", scope);
    form.append(scope === "session" ? "session_id" : "setting_id", String(entityId));
    form.append("category", guessResourceCategory(file.name));
    form.append("file", file);
    await api.post("/resources", form);
  }

  async function attachResource(resourceId: number) {
    await api.post("/entity-relations", {
      from_type: scope,
      from_id: entityId,
      to_type: "resource",
      to_id: resourceId,
      section: "attached_resource",
      tone: "neutral",
      label: "",
      description: "",
    });
    loadAttached();
  }

  // A bag item can carry a location's map (type "location_map", id =
  // location id) instead of an actual resource — see LocationMap.tsx's
  // "В мешок" button. The from-location-map endpoint copies the map image
  // into the session's own resources, same as its "→ В сессию" flow.
  async function attachLocationMap(locationId: number) {
    await api.post("/resources/from-location-map", { location_id: locationId, session_id: entityId });
    onChange();
  }

  async function detachResource(linkId: number) {
    await api.del(`/links/${linkId}`);
    loadAttached();
  }

  async function promoteResource(resourceId: number) {
    if (!settingId) return;
    await api.post(`/resources/${resourceId}/promote`, { setting_id: settingId });
    onChange();
  }

  async function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);
    const raw = e.dataTransfer.getData(SEARCH_DRAG_MIME);
    if (raw) {
      const result: SearchResult = JSON.parse(raw);
      if (result.type === "resource") await attachResource(result.id);
      else if (result.type === "location_map" && scope === "session") await attachLocationMap(result.id);
      return;
    }
    const files = Array.from(e.dataTransfer.files ?? []);
    if (files.length === 0) return; // not a real OS file drop
    if (files.length === 1) {
      openModal(files[0]);
      return;
    }
    // Several files at once: skip the modal per-file and just create rows
    // named after each file, categorized by extension.
    setBusy(true);
    try {
      await Promise.all(files.map(createFromFile));
      onChange();
    } finally {
      setBusy(false);
    }
  }

  async function archiveResource(id: number) {
    await api.del(`/resources/${id}`);
    onChange();
  }

  function handleFilePick(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setDraftFile(file);
    if (!draftName.trim()) setDraftName(file.name);
    setDraftCategory(guessResourceCategory(file.name));
  }

  // "+ Добавить файлы" button — same multi-file path as dropping several OS
  // files at once (createFromFile per file, no per-file modal), just
  // triggered by a hidden multi-select file input instead of drag-and-drop.
  async function handleBulkFilePick(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (files.length === 0) return;
    setBusy(true);
    try {
      await Promise.all(files.map(createFromFile));
      onChange();
    } finally {
      setBusy(false);
    }
  }

  async function pickFolderForDraft() {
    const path = await window.electronAPI?.pickFolder();
    if (!path) return;
    setDraftLinkUrl(path);
    if (!draftName.trim()) setDraftName(path.split(/[\\/]/).filter(Boolean).pop() || path);
  }

  async function revealStorage() {
    const base = scope === "session" ? "sessions" : "settings";
    await api.post(`/${base}/${entityId}/reveal-resources`, {});
  }

  const attachedResourceIds = new Set(attached.map((a) => a.resource.id));
  const allItems = [...resources, ...attached.map((a) => a.resource)];
  const grouped = RESOURCE_CATEGORIES.map((c) => ({
    ...c,
    items: allItems.filter((r) => (r.category ?? "other") === c.key),
  }));
  const noun = scope === "session" ? "сессии" : "сеттинга"; // genitive, e.g. "хранилище X"
  const withThis = scope === "session" ? "этой сессией" : "этим сеттингом"; // instrumental

  return (
    <div
      className={`stack resource-drop-zone${dragOver ? " drag-over" : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
    >
      <p className="muted">
        Ссылки на сайты, локальные папки или файлы, связанные с {withThis}. Можно перетащить файлы
        прямо сюда с компьютера, или ресурс из поиска — чтобы прикрепить его без копирования.
      </p>
      <div className="row">
        <button type="button" className="primary" onClick={() => openModal()}>
          + Добавить ресурс
        </button>
        <label className="character-avatar-upload">
          + Добавить файлы
          <input type="file" multiple style={{ display: "none" }} onChange={handleBulkFilePick} />
        </label>
        <button type="button" onClick={() => setLibraryOpen(true)}>
          <NavIcon name="library" /> Библиотека ресурсов
        </button>
        <button type="button" onClick={revealStorage}>
          <NavIcon name="folder" /> Общее хранилище {noun}
        </button>
        {busy && <span className="muted">Добавляю файлы…</span>}
      </div>

      {allItems.length === 0 && <p className="muted">Ресурсов пока нет.</p>}

      {grouped
        .filter((g) => g.items.length > 0)
        .map((g) => (
          <details key={g.key} className="stack" style={{ gap: 4 }}>
            <summary className="row chevron-summary" style={{ gap: 10 }}>
              <NavIcon name="chevron" className="chevron-icon" />
              <strong>
                <NavIcon name={g.icon} /> {g.label}
              </strong>
            </summary>
            {g.key === "audio" ? (
              <AudioGroup
                items={g.items}
                onChange={onChange}
                onArchive={archiveResource}
                attachedResourceIds={attachedResourceIds}
                onDetach={(id) => {
                  const entry = attached.find((a) => a.resource.id === id);
                  if (entry) detachResource(entry.linkId);
                }}
                canPromote={(id) => scope === "session" && !!settingId && !attachedResourceIds.has(id)}
                onPromote={promoteResource}
              />
            ) : (
              <SortableResourceGroup
                items={g.items}
                onChange={onChange}
                onArchive={archiveResource}
                attachedResourceIds={attachedResourceIds}
                onDetach={(id) => {
                  const entry = attached.find((a) => a.resource.id === id);
                  if (entry) detachResource(entry.linkId);
                }}
                canPromote={(id) => scope === "session" && !!settingId && !attachedResourceIds.has(id)}
                onPromote={promoteResource}
              />
            )}
          </details>
        ))}

      {modalOpen && (
        <Modal onClose={() => setModalOpen(false)} closeOnBackdropClick={false}>
          <div className="stack">
            <h3 style={{ margin: 0 }}>Новый ресурс</h3>
            <label>
              Название
              <input value={draftName} onChange={(e) => setDraftName(e.target.value)} />
            </label>
            <label>
              Категория
              <select
                value={draftCategory}
                onChange={(e) => setDraftCategory(e.target.value as ResourceCategory)}
              >
                {RESOURCE_CATEGORIES.map((c) => (
                  <option key={c.key} value={c.key}>
                    {c.label}
                  </option>
                ))}
              </select>
            </label>
            {draftFile ? (
              <p className="muted">Файл: {draftFile.name}</p>
            ) : draftCategory === "folder" ? (
              draftLinkUrl ? (
                <p className="muted">Папка: {draftLinkUrl}</p>
              ) : (
                <div className="stack" style={{ gap: 4 }}>
                  <button
                    type="button"
                    onClick={pickFolderForDraft}
                    disabled={!hasElectronAPI()}
                  >
                    Добавить папку
                  </button>
                  {!hasElectronAPI() && (
                    <span className="muted" style={{ fontSize: "var(--fs-micro)" }}>
                      Выбор папки доступен только в приложении SoyMan_ttrpg, не в браузере.
                    </span>
                  )}
                </div>
              )
            ) : draftCategory === "link" ? (
              <label>
                Ссылка на сайт
                <input
                  placeholder="https://..."
                  value={draftLinkUrl}
                  onChange={(e) => setDraftLinkUrl(e.target.value)}
                />
              </label>
            ) : (
              <label className="character-avatar-upload" style={{ alignSelf: "flex-start" }}>
                Добавить файл
                <input type="file" style={{ display: "none" }} onChange={handleFilePick} />
              </label>
            )}
            <div className="row">
              <button
                type="button"
                className="primary"
                onClick={submitModal}
                disabled={!draftName.trim() || (!draftFile && !draftLinkUrl.trim())}
              >
                Добавить
              </button>
              <button type="button" onClick={() => setModalOpen(false)}>
                Отмена
              </button>
            </div>
          </div>
        </Modal>
      )}

      {libraryOpen && (
        <LibraryPickerModal
          excludeIds={new Set([...resources.map((r) => r.id), ...attachedResourceIds])}
          onAttach={attachResource}
          onClose={() => setLibraryOpen(false)}
        />
      )}
    </div>
  );
});

// Browses every resource in the vault (any session/setting/system) and lets
// the user attach one here by reference — same generic_links mechanism as
// dragging a search result onto the drop zone, just with a searchable list
// instead of needing to already have the target open in the search panel.
// No file is copied; storeDeduped already keeps uploads from computer
// deduplicated on disk too (see vaultDedup.ts), so this only covers the
// "reuse without even a second DB row's worth of physical file" case.
function LibraryPickerModal({
  excludeIds,
  onAttach,
  onClose,
}: {
  excludeIds: Set<number>;
  onAttach: (resourceId: number) => Promise<void>;
  onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const [items, setItems] = useState<Resource[]>([]);
  const [loading, setLoading] = useState(false);
  const [attachedIds, setAttachedIds] = useState<Set<number>>(new Set());

  useEffect(() => {
    setLoading(true);
    const handle = setTimeout(() => {
      api
        .get<Resource[]>(`/resources${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ""}`)
        .then(setItems)
        .finally(() => setLoading(false));
    }, 250);
    return () => clearTimeout(handle);
  }, [q]);

  async function attach(id: number) {
    await onAttach(id);
    setAttachedIds((prev) => new Set(prev).add(id));
  }

  const shown = items.filter((r) => !excludeIds.has(r.id));

  return (
    <Modal onClose={onClose}>
      <div className="stack">
        <h3 style={{ margin: 0 }}>Библиотека ресурсов</h3>
        <p className="muted">
          Все ресурсы хранилища — сессий, сеттингов, систем. Прикрепление не копирует файл.
        </p>
        <input
          placeholder="Поиск по названию…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          autoFocus
        />
        {loading && <p className="muted">Загрузка…</p>}
        {!loading && shown.length === 0 && <p className="muted">Ничего не найдено.</p>}
        <div className="stack" style={{ maxHeight: 400, overflowY: "auto", gap: 4 }}>
          {shown.map((r) => {
            const owner = r.setting_name || r.system_name;
            const done = attachedIds.has(r.id);
            return (
              <div key={r.id} className="row" style={{ justifyContent: "space-between" }}>
                <div style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  <strong>{r.name}</strong>
                  {owner && <span className="muted"> — {owner}</span>}
                </div>
                <button type="button" onClick={() => attach(r.id)} disabled={done}>
                  {done ? (
                    <>
                      <NavIcon name="check" /> Прикреплено
                    </>
                  ) : (
                    "Прикрепить"
                  )}
                </button>
              </div>
            );
          })}
        </div>
        <div className="row">
          <button type="button" onClick={onClose}>
            Закрыть
          </button>
        </div>
      </div>
    </Modal>
  );
}

// "Звуки" gets extra powers over the other categories: checkbox multi-select
// feeding a "добавить в набор" bar, and each row is draggable as a
// SEARCH_DRAG_MIME payload (same shape a global-search result carries).
//
// Раньше выбранное отправлялось в плейлист. Плейлистов у сессий и сеттингов
// больше нет — музыку слушает набор, и добавлять надо прямо в него, а не в
// промежуточный список, который потом ещё надо в набор положить.
function AudioGroup({
  items,
  onChange,
  onArchive,
  attachedResourceIds,
  onDetach,
  canPromote,
  onPromote,
}: {
  items: Resource[];
  onChange: () => void;
  onArchive: (id: number) => void;
  attachedResourceIds: Set<number>;
  onDetach: (resourceId: number) => void;
  canPromote: (resourceId: number) => boolean;
  onPromote: (resourceId: number) => Promise<void>;
}) {
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [sets, setSets] = useState<SoundSetSummary[]>([]);
  const [busySet, setBusySet] = useState(false);

  useEffect(() => {
    api.get<SoundSetSummary[]>("/sound-sets").then(setSets).catch(() => setSets([]));
  }, []);

  function toggle(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // Состав набора переписывается целиком, поэтому выбранное дописывается к
  // тому, что в наборе уже есть, а не заменяет его. Заодно каждому звуку
  // проставляется роль Бэкграунда: без роли он не попадёт ни в один канал
  // пульта и молча пропадёт из набора.
  async function addToSet(setId: number) {
    setBusySet(true);
    try {
      const detail = await api.get<SoundSetDetail>(`/sound-sets/${setId}`);
      const ids = detail.tracks.map((t) => t.resource_id);
      for (const id of selected) {
        if (!ids.includes(id)) {
          await api.put(`/sounds/${id}`, { audio_role: "background" });
          ids.push(id);
        }
      }
      await api.put(`/sound-sets/${setId}/items`, {
        tracks: ids,
        ambient: detail.ambient.map((b) => b.resource_id),
        weather: detail.weather.map((b) => b.resource_id),
        stingers: detail.stingers.map((b) => b.resource_id),
        start_ambient_id: detail.ambient.find((b) => b.is_start)?.resource_id ?? null,
      });
      setSelected(new Set());
    } finally {
      setBusySet(false);
    }
  }

  function sortAlphabetically() {
    const ids = [...items].sort((a, b) => a.name.localeCompare(b.name, "ru")).map((r) => r.id);
    api.put("/resources/reorder", { order: ids }).then(onChange);
  }

  return (
    <div className="stack" style={{ gap: 0 }}>
      <div className="row" style={{ padding: "4px 8px", flexWrap: "wrap" }}>
        <button type="button" className="comp-mini" onClick={sortAlphabetically} title="Отсортировать по алфавиту">
          А-Я
        </button>
      </div>
      {selected.size > 0 && (
        <div className="row" style={{ padding: "4px 8px", flexWrap: "wrap" }}>
          <span className="muted">Выбрано: {selected.size}</span>
          <BulkRenameBar
            ids={Array.from(selected)}
            onDone={() => {
              setSelected(new Set());
              onChange();
            }}
          />
          {sets.length > 0 ? (
            <select
              value=""
              disabled={busySet}
              onChange={(e) => {
                if (e.target.value) void addToSet(Number(e.target.value));
              }}
            >
              <option value="">{busySet ? "Добавляю…" : "Добавить в набор…"}</option>
              {sets.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          ) : (
            <span className="muted">Наборов ещё нет — их заводят в Ресурсах, вкладка «Аудио-наборы».</span>
          )}
        </div>
      )}
      {items.map((r) => (
        <div
          key={r.id}
          className="row"
          style={{ alignItems: "flex-start" }}
          draggable
          onDragStart={(e) => {
            e.dataTransfer.setData(
              SEARCH_DRAG_MIME,
              JSON.stringify({ type: "resource", id: r.id, title: r.name })
            );
            e.dataTransfer.effectAllowed = "link";
          }}
        >
          <input
            type="checkbox"
            checked={selected.has(r.id)}
            onChange={() => toggle(r.id)}
            style={{ marginTop: 10 }}
          />
          <div style={{ flex: 1, minWidth: 0 }}>
            <ResourceRow
              resource={r}
              onChange={onChange}
              onArchive={onArchive}
              isAttached={attachedResourceIds.has(r.id)}
              onDetach={() => onDetach(r.id)}
              canPromote={canPromote(r.id)}
              onPromote={() => onPromote(r.id)}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

// Shared bulk-action bar: prefix/suffix rename for the checked resources.
// Used by both SortableResourceGroup and AudioGroup's selection toolbar.
function BulkRenameBar({ ids, onDone }: { ids: number[]; onDone: () => void }) {
  const [prefix, setPrefix] = useState("");
  const [suffix, setSuffix] = useState("");
  const [busy, setBusy] = useState(false);

  async function apply() {
    if (!prefix.trim() && !suffix.trim()) return;
    setBusy(true);
    try {
      await api.post("/resources/bulk-rename", { ids, prefix, suffix });
      setPrefix("");
      setSuffix("");
      onDone();
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <input
        placeholder="Префикс"
        value={prefix}
        onChange={(e) => setPrefix(e.target.value)}
        style={{ width: 100 }}
      />
      <input
        placeholder="Суффикс"
        value={suffix}
        onChange={(e) => setSuffix(e.target.value)}
        style={{ width: 100 }}
      />
      <button
        type="button"
        onClick={apply}
        disabled={busy || (!prefix.trim() && !suffix.trim())}
        title="Добавить префикс/суффикс к названиям выбранных файлов"
      >
        Применить
      </button>
    </>
  );
}

// Category groups other than "Звуки": base alphabetical order, drag reorder
// (persisted server-side, same pattern as gallery/playlist tracks), and
// checkbox multi-select feeding the prefix/suffix bulk-rename bar.
function SortableResourceGroup({
  items,
  onChange,
  onArchive,
  attachedResourceIds,
  onDetach,
  canPromote,
  onPromote,
}: {
  items: Resource[];
  onChange: () => void;
  onArchive: (id: number) => void;
  attachedResourceIds: Set<number>;
  onDetach: (resourceId: number) => void;
  canPromote: (resourceId: number) => boolean;
  onPromote: (resourceId: number) => Promise<void>;
}) {
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [dragId, setDragId] = useState<number | null>(null);

  function toggle(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function sortAlphabetically() {
    const ids = [...items].sort((a, b) => a.name.localeCompare(b.name, "ru")).map((r) => r.id);
    api.put("/resources/reorder", { order: ids }).then(onChange);
  }

  function handleDrop(targetId: number) {
    if (dragId == null || dragId === targetId) return;
    const ids = items.map((r) => r.id);
    const from = ids.indexOf(dragId);
    const to = ids.indexOf(targetId);
    if (from === -1 || to === -1) return;
    ids.splice(to, 0, ...ids.splice(from, 1));
    api.put("/resources/reorder", { order: ids }).then(onChange);
    setDragId(null);
  }

  return (
    <div className="stack" style={{ gap: 0 }}>
      <div className="row" style={{ padding: "4px 8px", flexWrap: "wrap" }}>
        <button type="button" className="comp-mini" onClick={sortAlphabetically} title="Отсортировать по алфавиту">
          А-Я
        </button>
        {selected.size > 0 && (
          <>
            <span className="muted">Выбрано: {selected.size}</span>
            <BulkRenameBar
              ids={Array.from(selected)}
              onDone={() => {
                setSelected(new Set());
                onChange();
              }}
            />
          </>
        )}
      </div>
      {items.map((r) => (
        <div
          key={r.id}
          className="row"
          style={{ alignItems: "flex-start" }}
          draggable
          onDragStart={() => setDragId(r.id)}
          onDragOver={(e) => e.preventDefault()}
          onDrop={() => handleDrop(r.id)}
        >
          <input
            type="checkbox"
            checked={selected.has(r.id)}
            onChange={() => toggle(r.id)}
            style={{ marginTop: 10 }}
          />
          <div style={{ flex: 1, minWidth: 0 }}>
            <ResourceRow
              resource={r}
              onChange={onChange}
              onArchive={onArchive}
              isAttached={attachedResourceIds.has(r.id)}
              onDetach={() => onDetach(r.id)}
              canPromote={canPromote(r.id)}
              onPromote={() => onPromote(r.id)}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function ResourceRow({
  resource,
  onChange,
  onArchive,
  isAttached,
  onDetach,
  canPromote,
  onPromote,
}: {
  resource: Resource;
  onChange: () => void;
  onArchive: (id: number) => void;
  isAttached: boolean;
  onDetach: () => void;
  canPromote: boolean;
  onPromote: () => Promise<void>;
}) {
  const [editMode, setEditMode] = useState(false);
  const [name, setName] = useState(resource.name);
  const [linkUrl, setLinkUrl] = useState(resource.link_url ?? "");
  const [notes, setNotes] = useState(resource.notes);
  const [promoted, setPromoted] = useState(false);
  const [promoting, setPromoting] = useState(false);

  useEffect(() => {
    if (!canPromote) {
      setPromoted(false);
      return;
    }
    let cancelled = false;
    api
      .get<GenericLink[]>(`/links?type=resource&id=${resource.id}&section=promoted_to_setting`)
      .then(async (links) => {
        if (links.length === 0) return;
        const targetId = links[0].from_id === resource.id ? links[0].to_id : links[0].from_id;
        try {
          const target = await api.get<Resource>(`/resources/${targetId}`);
          if (!cancelled) setPromoted(!target.archived_at);
        } catch {
          // Promoted copy is gone — leave promoted=false so it can be re-promoted.
        }
      });
    return () => {
      cancelled = true;
    };
  }, [resource.id, canPromote]);

  async function handlePromote() {
    setPromoting(true);
    try {
      await onPromote();
      setPromoted(true);
    } finally {
      setPromoting(false);
    }
  }

  async function save() {
    await api.put(`/resources/${resource.id}`, { name, link_url: linkUrl, notes });
    syncMentionLinks("resource", resource.id, resource.notes, notes);
    setEditMode(false);
    onChange();
  }

  const isImage = resource.file_url && IMAGE_EXT.test(resource.file_url);
  const audioSrc = resource.file_url && AUDIO_EXT.test(resource.file_url)
    ? resource.file_url
    : resource.link_url && AUDIO_EXT.test(resource.link_url)
      ? resource.link_url
      : null;
  const openUrl = resource.link_url || resource.file_url;
  const canReveal = !!resource.file_path || resource.category === "folder";

  async function reveal() {
    await api.post(`/resources/${resource.id}/reveal`, {});
  }

  if (editMode) {
    return (
      <div className="resource-row stack" style={{ paddingBottom: 8 }}>
        <input value={name} onChange={(e) => setName(e.target.value)} />
        <input
          placeholder="Ссылка"
          value={linkUrl}
          onChange={(e) => setLinkUrl(e.target.value)}
        />
        <MentionTextarea value={notes} onChange={setNotes} rows={2} />
        <div className="row">
          <button className="primary" onClick={save}>
            Сохранить
          </button>
          <button onClick={() => setEditMode(false)}>Отмена</button>
        </div>
      </div>
    );
  }

  return (
    <div className="resource-row row" style={{ justifyContent: "space-between" }}>
      <div className="row" style={{ minWidth: 0, flex: 1 }}>
        {isImage && openUrl && <img src={openUrl} alt="" className="resource-row-thumb" />}
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: 600 }}>
          {resource.name}
        </span>
        {isAttached && (
          <span className="muted row" style={{ gap: 4, display: "inline-flex", alignItems: "center" }}>
            <NavIcon name="link" /> из сеттинга
          </span>
        )}
        {openUrl && (
          <a href={openUrl} target="_blank" rel="noopener noreferrer">
            Открыть →
          </a>
        )}
        {canReveal && (
          <button type="button" onClick={reveal}>
            <NavIcon name="folder" /> Папка
          </button>
        )}
        {resource.notes && (
          <span className="muted" style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
            <MentionText text={resource.notes} />
          </span>
        )}
      </div>
      {audioSrc && (
        // eslint-disable-next-line jsx-a11y/media-has-caption
        <audio controls src={audioSrc} className="resource-row-audio" />
      )}
      <div className="row" style={{ flexShrink: 0 }}>
        {canPromote && (
          <button
            type="button"
            onClick={handlePromote}
            disabled={promoted || promoting}
            title={promoted ? "Уже в ресурсах сеттинга" : "Отправить в ресурсы сеттинга"}
          >
            {promoted ? (
              <>
                <NavIcon name="check" /> Добавлено
              </>
            ) : promoting ? (
              "Отправляю…"
            ) : (
              <>
                <NavIcon name="upload" /> В сеттинг
              </>
            )}
          </button>
        )}
        {isAttached ? (
          <button type="button" onClick={onDetach} title="Открепить от сессии">
            Открепить
          </button>
        ) : (
          <>
            <button onClick={() => setEditMode(true)} title="Редактировать">
              <NavIcon name="edit" />
            </button>
            <button onClick={() => onArchive(resource.id)} title="Удалить">
              <NavIcon name="delete" />
            </button>
          </>
        )}
      </div>
    </div>
  );
}
