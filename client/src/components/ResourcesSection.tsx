import { memo, useEffect, useMemo, useState, type ChangeEvent, type DragEvent } from "react";
import { useQueries } from "@tanstack/react-query";
import { api } from "../api/client";
import { dataKeys, entityPath, type Affect } from "../data/entities";
import { useAction, useEntity, useResource, write } from "../data/hooks";
import { readResource } from "../data/imperative";
import { attemptWithNotice } from "../data/notices";
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
import { useSearch } from "../data/search";

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
  // Only meaningful for scope==="session" — the campaign's setting, if any.
  // Enables "attach an existing setting resource" (drag from search) and
  // "В сеттинг" (promote an owned resource up to that setting) so the
  // same file doesn't get re-uploaded into every session that needs it.
  settingId?: number | null;
  // Master–Detail: показать только выбранные категории (null — все, как
  // раньше). Навигация сounts — через onStats.
  visibleCategories?: string[] | null;
  onStats?: (s: ResourceStats) => void;
}

export interface ResourceStats {
  total: number;
  byCategory: Record<string, number>;
}

// Shared "Ресурсы" UI for both sessions and settings: modal-based creation,
// category grouping, row layout, native OS file drag-and-drop. Session scope
// additionally supports attaching an existing setting-scoped resource
// (without duplicating the file) and promoting an owned resource up to the
// setting for reuse across sessions.
// Memoized — see ObstacleDropZone's comment. `resources` is a fresh array on
// every parent render unless the caller stabilizes it (useMemo); otherwise
// this still re-renders every time, same as before.
//
// Списки ресурсов читает слой данных (docs/adr/0001): правка здесь задевает
// ресурсы и — у сессии — её карточку, где лежат ресурсы сессии. Перечитывать
// себя родителю не нужно.
export const ResourcesSection = memo(function ResourcesSection({
  scope,
  entityId,
  resources,
  settingId,
  visibleCategories,
  onStats,
}: Props) {
  const [modalOpen, setModalOpen] = useState(false);
  const [draftFile, setDraftFile] = useState<File | null>(null);
  const [draftName, setDraftName] = useState("");
  const [draftCategory, setDraftCategory] = useState<ResourceCategory>("link");
  const [draftLinkUrl, setDraftLinkUrl] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const run = useAction();
  const affects = useMemo<Affect[]>(
    () => [{ kind: "resource" }, ...(scope === "session" ? [{ kind: "session", id: entityId } as Affect] : [])],
    [scope, entityId]
  );
  const linkAffects = useMemo<Affect[]>(() => [{ path: "/links" }], []);

  // Прикреплённые ресурсы: связи и карточки ресурсов под ключами слоя.
  // Прикрепили или открепили — задетые связи перечитываются сами.
  const attachedLinks = useResource<GenericLink[]>(`/links?type=${scope}&id=${entityId}&section=attached_resource`).data;
  const attachedIds = (attachedLinks ?? []).map((l) => ({ linkId: l.id, resourceId: l.from_type === "resource" ? l.from_id : l.to_id }));
  const attachedCards = useQueries({
    queries: attachedIds.map((a) => ({
      queryKey: dataKeys.entity("resource", a.resourceId),
      queryFn: ({ signal }: { signal: AbortSignal }) => api.get<Resource>(entityPath("resource", a.resourceId), { signal }),
    })),
  });
  // Список стабилен между отрисовками, пока не пришли новые данные: от него
  // зависит эффект счётчиков раздела (onStats), и новый массив на каждой
  // отрисовке зациклил бы его.
  const attachedSignature = attachedCards.map((c) => c.dataUpdatedAt).join(",");
  const attached = useMemo<AttachedEntry[]>(
    () =>
      attachedIds.flatMap((a, i) => {
        const resource = attachedCards[i]?.data;
        return resource ? [{ linkId: a.linkId, resource }] : [];
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [attachedLinks, attachedSignature]
  );

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
    // Окно закрывается, только если записалось; повтор создал бы второй ресурс.
    const done = await run(() => write.post("/resources", form).then(() => true), { affects, retry: false });
    if (done) setModalOpen(false);
  }

  async function createFromFile(file: File) {
    const form = new FormData();
    form.append("name", file.name);
    form.append("type", "link");
    form.append("scope", scope);
    form.append(scope === "session" ? "session_id" : "setting_id", String(entityId));
    form.append("category", guessResourceCategory(file.name));
    form.append("file", file);
    await write.post("/resources", form);
  }

  // Приложенный по ссылке ресурс — членство в списке, а не мнение: читает и
  // удаляет этот блок `/links`, поэтому и пишет туда же (решения 2026-09-12,
  // «Два графа», п. 1). Запись в `/entity-relations` ложилась в таблицу
  // мнений, и приложенный ресурс в списке не появлялся вовсе.
  async function attachResource(resourceId: number) {
    await run(
      () =>
        write
          .post("/links", {
            from_type: scope,
            from_id: entityId,
            to_type: "resource",
            to_id: resourceId,
            section: "attached_resource",
          })
          .then(() => true),
      { affects: linkAffects, retry: false }
    );
  }

  // A bag item can carry a location's map (type "location_map", id =
  // location id) instead of an actual resource — see LocationMap.tsx's
  // "В мешок" button. The from-location-map endpoint copies the map image
  // into the session's own resources, same as its "→ В сессию" flow.
  async function attachLocationMap(locationId: number) {
    await run(
      () => write.post("/resources/from-location-map", { location_id: locationId, session_id: entityId }).then(() => true),
      { affects, retry: false }
    );
  }

  async function detachResource(linkId: number) {
    await run(() => write.del(`/links/${linkId}`).then(() => true), { affects: linkAffects });
  }

  async function promoteResource(resourceId: number) {
    if (!settingId) return;
    const done = await run(
      () => write.post(`/resources/${resourceId}/promote`, { setting_id: settingId }).then(() => true),
      { affects, retry: false }
    );
    if (!done) throw new Error("Не отправилось");
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
    // Часть файлов может лечь, а часть нет — задетое обновляется в любом случае.
    await run(() => Promise.all(files.map(createFromFile)).then(() => true), { affects, retry: false });
    setBusy(false);
  }

  async function archiveResource(id: number) {
    await run(() => write.del(`/resources/${id}`).then(() => true), { affects });
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
    // Часть файлов может лечь, а часть нет — задетое обновляется в любом случае.
    await run(() => Promise.all(files.map(createFromFile)).then(() => true), { affects, retry: false });
    setBusy(false);
  }

  async function pickFolderForDraft() {
    const path = await window.electronAPI?.pickFolder();
    if (!path) return;
    setDraftLinkUrl(path);
    if (!draftName.trim()) setDraftName(path.split(/[\\/]/).filter(Boolean).pop() || path);
  }

  async function revealStorage() {
    const base = scope === "session" ? "sessions" : "settings";
    // Открыть папку — не правка данных: задетого нет.
    await attemptWithNotice("Папка не открылась", () => write.post(`/${base}/${entityId}/reveal-resources`, {}));
  }

  const attachedResourceIds = new Set(attached.map((a) => a.resource.id));
  const allItems = [...resources, ...attached.map((a) => a.resource)];
  const grouped = RESOURCE_CATEGORIES.map((c) => ({
    ...c,
    items: allItems.filter((r) => (r.category ?? "other") === c.key),
  }));

  // Счётчики для левой навигации Master–Detail (итог + по категориям).
  useEffect(() => {
    if (!onStats) return;
    const byCategory: Record<string, number> = {};
    for (const g of grouped) byCategory[g.key] = g.items.length;
    onStats({ total: allItems.length, byCategory });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resources, attached, onStats]);

  const visibleGrouped = grouped.filter(
    (g) => g.items.length > 0 && (!visibleCategories || visibleCategories.includes(g.key))
  );
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

      {visibleGrouped
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
                affects={affects}
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
                affects={affects}
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
  const search = useSearch<Resource>(`/resources${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ""}`, 250);
  const items = search.results;
  const loading = search.searching;
  const [attachedIds, setAttachedIds] = useState<Set<number>>(new Set());


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
  affects,
  onArchive,
  attachedResourceIds,
  onDetach,
  canPromote,
  onPromote,
}: {
  items: Resource[];
  affects: Affect[];
  onArchive: (id: number) => void;
  attachedResourceIds: Set<number>;
  onDetach: (resourceId: number) => void;
  canPromote: (resourceId: number) => boolean;
  onPromote: (resourceId: number) => Promise<void>;
}) {
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const sets = useResource<SoundSetSummary[]>("/sound-sets").data ?? [];
  const [busySet, setBusySet] = useState(false);
  const run = useAction();

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
    const done = await run(
      async () => {
        // Состав читается свежим: набор мог поменяться в другом окне.
        const detail = await readResource<SoundSetDetail>(`/sound-sets/${setId}`, { fresh: true });
        const ids = detail.tracks.map((t) => t.resource_id);
        for (const id of selected) {
          if (!ids.includes(id)) {
            await write.put(`/sounds/${id}`, { audio_role: "background" });
            ids.push(id);
          }
        }
        await write.put(`/sound-sets/${setId}/items`, {
          tracks: ids,
          ambient: detail.ambient.map((b) => b.resource_id),
          weather: detail.weather.map((b) => b.resource_id),
          stingers: detail.stingers.map((b) => b.resource_id),
          start_ambient_id: detail.ambient.find((b) => b.is_start)?.resource_id ?? null,
        });
        return true;
      },
      { affects: [...affects, { path: "/sound-sets" }, { path: "/sounds" }] }
    );
    if (done) setSelected(new Set());
    setBusySet(false);
  }

  function sortAlphabetically() {
    const ids = [...items].sort((a, b) => a.name.localeCompare(b.name, "ru")).map((r) => r.id);
    void run(() => write.put("/resources/reorder", { order: ids }).then(() => true), { affects });
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
            affects={affects}
            onDone={() => setSelected(new Set())}
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
              affects={affects}
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
function BulkRenameBar({ ids, affects, onDone }: { ids: number[]; affects: Affect[]; onDone: () => void }) {
  const [prefix, setPrefix] = useState("");
  const [suffix, setSuffix] = useState("");
  const [busy, setBusy] = useState(false);
  const run = useAction();

  async function apply() {
    if (!prefix.trim() && !suffix.trim()) return;
    setBusy(true);
    const done = await run(() => write.post("/resources/bulk-rename", { ids, prefix, suffix }).then(() => true), { affects });
    setBusy(false);
    if (!done) return;
    setPrefix("");
    setSuffix("");
    onDone();
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
  affects,
  onArchive,
  attachedResourceIds,
  onDetach,
  canPromote,
  onPromote,
}: {
  items: Resource[];
  affects: Affect[];
  onArchive: (id: number) => void;
  attachedResourceIds: Set<number>;
  onDetach: (resourceId: number) => void;
  canPromote: (resourceId: number) => boolean;
  onPromote: (resourceId: number) => Promise<void>;
}) {
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [dragId, setDragId] = useState<number | null>(null);
  const run = useAction();

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
    void run(() => write.put("/resources/reorder", { order: ids }).then(() => true), { affects });
  }

  function handleDrop(targetId: number) {
    if (dragId == null || dragId === targetId) return;
    const ids = items.map((r) => r.id);
    const from = ids.indexOf(dragId);
    const to = ids.indexOf(targetId);
    if (from === -1 || to === -1) return;
    ids.splice(to, 0, ...ids.splice(from, 1));
    void run(() => write.put("/resources/reorder", { order: ids }).then(() => true), { affects });
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
              affects={affects}
              onDone={() => setSelected(new Set())}
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
              affects={affects}
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
  affects,
  onArchive,
  isAttached,
  onDetach,
  canPromote,
  onPromote,
}: {
  resource: Resource;
  affects: Affect[];
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
  // Только что повышен здесь — не ждать, пока перечитаются связи.
  const [justPromoted, setJustPromoted] = useState(false);
  const [promoting, setPromoting] = useState(false);
  const run = useAction();

  // Повышен ли ресурс в сеттинг: связь «promoted_to_setting» и живая копия.
  // Копию убрали в архив — ресурс снова можно повысить.
  const promotedLinks = useResource<GenericLink[]>(
    canPromote ? `/links?type=resource&id=${resource.id}&section=promoted_to_setting` : null
  ).data;
  const promotedLink = promotedLinks?.[0];
  const promotedTargetId = promotedLink ? (promotedLink.from_id === resource.id ? promotedLink.to_id : promotedLink.from_id) : null;
  const promotedTarget = useEntity<Resource>("resource", canPromote ? promotedTargetId : null).data;
  const promoted = canPromote && (justPromoted || (!!promotedTarget && !promotedTarget.archived_at));

  async function handlePromote() {
    setPromoting(true);
    try {
      await onPromote();
      setJustPromoted(true);
    } catch {
      // Отказ уже показан плашкой; кнопка остаётся доступной.
    } finally {
      setPromoting(false);
    }
  }

  async function save() {
    // Правка остаётся открытой, если не записалось.
    const done = await run(
      async () => {
        await write.put(`/resources/${resource.id}`, { name, link_url: linkUrl, notes });
        await syncMentionLinks("resource", resource.id, resource.notes, notes);
        return true;
      },
      { affects }
    );
    if (done) setEditMode(false);
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
    await attemptWithNotice("Файл не открылся", () => write.post(`/resources/${resource.id}/reveal`, {}));
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
