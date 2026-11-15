import { useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { addToBag } from "../bag";
import { ContextMenu, type ContextMenuItem } from "../components/ContextMenu";
import { EmptyState } from "../components/EmptyState";
import { ImageLightbox } from "../components/ImageLightbox";
import { Loadable, ListSkeleton } from "../components/Loadable";
import { Modal } from "../components/Modal";
import { NavIcon } from "../components/NavIcons";
import { GalleryStack, GalleryPhoto } from "../components/GalleryPhotos";
import { DRAG_IMAGE, isGalleryResource, useGalleryImage } from "./galleryImages";
import { useAction, useResource, write } from "../data/hooks";
import { labelled } from "../data/notices";
import { useConfirm, usePrompt } from "../hooks/useConfirm";
import { IMAGE_ACCEPT } from "../imageUpload";
import { plural } from "../sceneKinds";
import type { Album, Campaign, Resource, Setting } from "../types";
import "../pages/setting-profile.css";

type Owner = { kind: "setting" | "campaign"; id: number; name: string };
type GalleryFrame = (actions: ReactNode, content: ReactNode) => ReactNode;
const imageAffects = [{ kind: "resource" }, { path: "/resources" }] as const;
const albumAffects = [{ path: "/albums" }] as const;
const stackTilts = [[-5, 3, 0], [4, -4, 0], [-4, 3, 0]];
const ownerKey = ({ kind, id }: Owner) => `${kind}:${id}`;
const ownerLabel = ({ kind, name }: Owner) => `${name} · ${kind === "setting" ? "сеттинг" : "кампания"}`;

function findOwner(record: Album | Resource, owners: Map<string, Owner>) {
  return owners.get(`campaign:${record.campaign_id}`) ?? owners.get(`setting:${record.setting_id}`);
}

export function MediaGallery({ frame }: { frame: GalleryFrame }) {
  const [params, setParams] = useSearchParams();
  const resources = useResource<Resource[]>("/resources");
  const albumsState = useResource<Album[]>("/albums");
  const settings = useResource<Setting[]>("/settings");
  const campaigns = useResource<Campaign[]>("/campaigns");
  const run = useAction();
  const [confirmDialog, confirm] = useConfirm();
  const [promptDialog, prompt] = usePrompt();
  const [menu, setMenu] = useState<{ x: number; y: number; items: ContextMenuItem[] } | null>(null);
  const [viewId, setViewId] = useState<number | null>(null);
  const [dialog, setDialog] = useState<"album" | "upload" | null>(null);
  const [showMoreOwners, setShowMoreOwners] = useState(false);

  const owners = new Map<string, Owner>();
  settings.data?.forEach(({ id, name }) => owners.set(`setting:${id}`, { kind: "setting", id, name }));
  campaigns.data?.forEach(({ id, name }) => owners.set(`campaign:${id}`, { kind: "campaign", id, name }));
  const albums = albumsState.data ?? [];
  const albumsById = new Map(albums.map(album => [album.id, album]));
  const images = (resources.data ?? []).filter(isGalleryResource);
  const filter = params.get("where") ?? "";
  const query = params.get("q") ?? "";
  const needle = query.trim().toLocaleLowerCase("ru");
  const loose = (item: Resource) => !item.album_id || !albumsById.has(item.album_id);
  const ownerFilters = new Set<string>();
  for (const album of albums) {
    const owner = findOwner(album, owners);
    if (owner) ownerFilters.add(ownerKey(owner));
  }
  for (const image of images) {
    const owner = findOwner(image, owners);
    if (owner) ownerFilters.add(ownerKey(owner));
    if (image.setting_id) ownerFilters.add(`setting:${image.setting_id}`);
    for (const id of image.also_in_settings ?? []) ownerFilters.add(`setting:${id}`);
  }
  const options = [...owners.values()].filter(owner => ownerFilters.has(ownerKey(owner)) || ownerKey(owner) === filter);
  const currentOwner = owners.get(filter);
  const ownerNameCounts = new Map<string, number>();
  for (const owner of options) ownerNameCounts.set(owner.name, (ownerNameCounts.get(owner.name) ?? 0) + 1);
  const groups = new Map<string, { label: string; albums: Album[] }>();
  const shownAlbums = albums.filter(album => !currentOwner || (currentOwner.kind === "setting" ? album.setting_id : album.campaign_id) === currentOwner.id);
  for (const album of shownAlbums) {
    const owner = findOwner(album, owners);
    const key = owner ? ownerKey(owner) : "";
    if (!groups.has(key)) groups.set(key, { label: owner ? ownerLabel(owner) : "Общие", albums: [] });
    groups.get(key)?.albums.push(album);
  }
  const shownAlbumIds = new Set(shownAlbums.map(album => album.id));
  const matchesOwner = (item: Resource) => {
    if (!currentOwner) return true;
    if (item.album_id && albumsById.has(item.album_id)) return shownAlbumIds.has(item.album_id);
    return currentOwner.kind === "campaign" ? item.campaign_id === currentOwner.id
      : item.setting_id === currentOwner.id || item.also_in_settings?.includes(currentOwner.id);
  };
  const byAlbum = new Map<number, Resource[]>();
  for (const item of images) {
    if (!item.album_id) continue;
    const entries = byAlbum.get(item.album_id) ?? [];
    entries.push(item);
    byAlbum.set(item.album_id, entries);
  }
  const filtered = images.filter(matchesOwner);
  const unfiled = filtered.filter(loose);
  const picked = params.get("album");
  const openAlbum = picked === "loose" ? undefined : shownAlbums.find(album => album.id === Number(picked)) ?? shownAlbums[0];
  const openOwner = openAlbum ? findOwner(openAlbum, owners) : undefined;
  const shown = (needle ? filtered.filter(item => `${item.name} ${item.tags ?? ""}`.toLocaleLowerCase("ru").includes(needle))
    : openAlbum ? byAlbum.get(openAlbum.id) ?? [] : unfiled).slice().sort((a, b) => b.id - a.id);
  const viewIndex = shown.findIndex(item => item.id === viewId);

  function update(patch: Record<string, string | null>, replace = false) {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(patch)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    setParams(next, { replace });
  }

  async function saveAlbum(name: string, owner: Owner) {
    const created = await run(labelled("Альбом не создан", () => write.post<Album>("/albums", { name, [`${owner.kind}_id`]: owner.id })), { affects: albumAffects, retry: false });
    if (!created) return;
    setDialog(null);
    update({ album: String(created.id), where: ownerKey(owner), q: null });
  }

  async function upload(form: FormData) {
    const owner = openOwner ?? currentOwner;
    form.set("scope", owner?.kind ?? "global");
    if (owner) form.set(`${owner.kind}_id`, String(owner.id));
    if (openAlbum) form.set("album_id", String(openAlbum.id));
    const saved = await run(labelled("Изображение не загружено", () => write.post<Resource>("/resources", form, { timeoutMs: 120000 })), { affects: imageAffects, retry: false });
    if (saved) {
      setDialog(null);
      if (needle) update({ q: null }, true);
    }
  }

  async function move(item: Resource, album: Album | null) {
    if ((item.album_id ?? null) === (album?.id ?? null)) return;
    await run(labelled("Картинка не переложена", () => write.put(`/resources/${item.id}`, { album_id: album?.id ?? null })), { affects: imageAffects });
  }

  async function caption(item: Resource) {
    const next = await prompt({ title: "Подпись", message: "Название изображения", defaultValue: item.name, confirmLabel: "Сохранить" });
    if (!next?.trim() || next.trim() === item.name) return;
    await run(labelled("Подпись не сохранена", () => write.put(`/resources/${item.id}`, { name: next.trim().slice(0, 500) })), { affects: imageAffects });
  }

  async function archive(item: Resource) {
    if (!await confirm({ message: `Отправить «${item.name}» в архив?`, confirmLabel: "В архив", danger: true })) return;
    await run(labelled("Картинка не архивирована", () => write.del(`/resources/${item.id}`)), { affects: [...imageAffects, { path: "/archive" }] });
  }

  async function rename(album: Album) {
    const result = await prompt({ title: "Переименовать альбом", message: "Название альбома", defaultValue: album.name, confirmLabel: "Сохранить" });
    if (result?.trim() && result.trim() !== album.name) {
      await run(labelled("Альбом не переименован", () => write.put(`/albums/${album.id}`, { name: result.trim() })), { affects: albumAffects });
    }
  }

  async function removeAlbum(album: Album) {
    if (!await confirm({ title: `Удалить альбом «${album.name}»?`, message: "Картинки останутся в разделе «Без альбома».", confirmLabel: "Удалить", danger: true })) return;
    const removed = await run(labelled("Альбом не удалён", () => write.del(`/albums/${album.id}`).then(() => true)), { affects: [...albumAffects, ...imageAffects] });
    if (removed && openAlbum?.id === album.id) update({ album: "loose" }, true);
  }

  function albumMenu(x: number, y: number, album: Album) {
    setMenu({ x, y, items: [
      { label: "Переименовать", onClick: () => void rename(album) },
      { label: "Удалить альбом", danger: true, onClick: () => void removeAlbum(album) },
    ] });
  }

  function imageMenu(x: number, y: number, item: Resource) {
    const settingId = albumsById.get(item.album_id ?? 0)?.setting_id ?? item.setting_id;
    const targets: ContextMenuItem[] = albums.filter(album => album.id !== item.album_id).map(album => {
      const owner = findOwner(album, owners);
      return { label: owner ? `${owner.name} · ${album.name}` : album.name, onClick: () => void move(item, album) };
    });
    if (item.album_id) targets.push({ label: "Без альбома", onClick: () => void move(item, null) });
    const slots: ContextMenuItem[] = settingId ? ([["background", "Сделать фоном"], ["thumbnail", "Сделать обложкой"]] as const).map(([kind, label]) => ({
      label, onClick: () => void run(labelled("Изображение профиля не обновлено", () => write.post(`/settings/${settingId}/${kind}/from-resource`, { resource_id: item.id })), { affects: [{ kind: "setting", id: settingId }] }),
    })) : [];
    setMenu({ x, y, items: [
      ...slots,
      ...(targets.length ? [{ label: "В альбом…", children: targets }] : []),
      { label: "В мешок", onClick: () => addToBag({ type: "resource", id: item.id, title: item.name }) },
      { label: "Подпись…", onClick: () => void caption(item) },
      { label: "В архив", danger: true, dividerBefore: true, onClick: () => void archive(item) },
    ] });
  }

  const failed = [resources, albumsState, settings, campaigns].find(state => state.error);
  const count = needle ? `${shown.length} / ${filtered.length}` : filtered.length;
  const visibleOwners = showMoreOwners ? options : options.slice(0, 3);
  const chips = currentOwner && !visibleOwners.includes(currentOwner) ? [...visibleOwners, currentOwner] : visibleOwners;
  return frame(<>
    <button className="d-btn" type="button" onClick={() => setDialog("album")}>+ Альбом</button>
    <button className="d-btn d-btn--primary" type="button" onClick={() => setDialog("upload")}>Загрузить</button>
  </>, <Loadable loading={resources.loading || albumsState.loading || settings.loading || campaigns.loading} error={failed?.error ?? null}
    errorTitle="Не удалось загрузить Галерею" onRetry={failed?.reload ?? resources.reload} skeleton={<ListSkeleton variant="tiles" />}>
    <div className="media-gallery">
      <div className="media-gallery__tools">
        <label className="media-gallery__search">
          <NavIcon name="search" />
          <input type="search" aria-label="Поиск по галерее" placeholder="Картинка во всех альбомах" value={query}
            onChange={event => update({ q: event.target.value }, true)} />
        </label>
        <span className="d-note">{count}</span>
        {options.length > 0 && <div className="media-chips" role="group" aria-label="Где">
          <span className="media-chips__label">Где</span>
          <button type="button" className="d-tag" aria-pressed={!currentOwner} onClick={() => update({ where: null, album: null })}>Все</button>
          {chips.map(owner => <button type="button" key={ownerKey(owner)} className="d-tag" title={ownerLabel(owner)} aria-pressed={filter === ownerKey(owner)}
            onClick={() => update({ where: ownerKey(owner), album: null })}>{(ownerNameCounts.get(owner.name) ?? 0) > 1 ? ownerLabel(owner) : owner.name}</button>)}
          {(showMoreOwners || options.length > chips.length) && <button type="button" className="d-tag" aria-expanded={showMoreOwners} onClick={() => setShowMoreOwners(!showMoreOwners)}>
            {showMoreOwners ? "Свернуть" : `Ещё ${options.length - chips.length} ▾`}
          </button>}
        </div>}
      </div>
      {(groups.size > 0 || unfiled.length > 0) && <div className="media-gallery__albums" aria-label="Альбомы">
        {[...groups].map(([key, group]) => <section key={key} className="media-gallery__owner" aria-label={group.label}>
          <h2 title={group.label}>{group.label}</h2>
          <div className="media-gallery__stacks">{group.albums.map((album, i) => <GalleryStack key={album.id} name={album.name}
            items={byAlbum.get(album.id) ?? []} tilt={stackTilts[i % stackTilts.length]} current={!needle && openAlbum?.id === album.id}
            onOpen={() => update({ album: String(album.id), q: null })} onMenu={(x, y) => albumMenu(x, y, album)}
            onDropImage={id => { const item = images.find(image => image.id === id); if (item) void move(item, album); }} />)}</div>
        </section>)}
        {(unfiled.length > 0 || picked === "loose") && <section className="media-gallery__owner media-gallery__owner--loose" aria-label="Без альбома">
          <GalleryStack name="Без альбома" items={unfiled} hideCovers tilt={stackTilts[0]} current={!needle && !openAlbum}
            onOpen={() => update({ album: "loose", q: null })}
            onDropImage={id => { const item = images.find(image => image.id === id); if (item) void move(item, null); }} />
        </section>}
      </div>}
      <section className={!needle && openAlbum ? "d-focal media-gallery__open" : undefined} aria-label={needle ? "Результаты поиска" : openAlbum?.name ?? "Без альбома"}>
        {(needle || openAlbum) && <header className="media-gallery__album-head">
          <h2>{needle ? "Найдено" : openAlbum?.name}</h2>
          <span className="d-note">{!needle && openOwner && <span className="media-gallery__album-owner">{ownerLabel(openOwner)} · </span>}{shown.length}<span className="media-gallery__image-word"> {plural(shown.length, "картинка", "картинки", "картинок")}</span></span>
          {!needle && openAlbum && <button className="d-btn d-btn--sm" type="button" aria-label={`Действия альбома: ${openAlbum.name}`}
            onClick={event => { const box = event.currentTarget.getBoundingClientRect(); albumMenu(box.left, box.bottom, openAlbum); }}>⋯</button>}
        </header>}
        {shown.length === 0 ? <EmptyState kind={needle ? "search" : "primary"} title={needle ? "Картинки не найдены" : "Картинок пока нет"} />
          : !needle && openAlbum ? <ul className="media-gallery__wall">{shown.map((item, i) => <li key={item.id}
            className="media-gallery__wall-photo">
            <GalleryPhoto resource={item} taped={i % 3 !== 1} onOpen={() => setViewId(item.id)} onMenu={(x, y) => imageMenu(x, y, item)} />
          </li>)}</ul> : <div className="media-gallery__loose">{shown.map(item => <LoosePhoto key={item.id} item={item}
            owner={findOwner(item, owners)} onOpen={() => setViewId(item.id)} onMenu={(x, y) => imageMenu(x, y, item)} />)}</div>}
      </section>
    </div>
    {confirmDialog}{promptDialog}
    {menu && <ContextMenu {...menu} ariaLabel="Действия Галереи" onClose={() => setMenu(null)} />}
    {viewIndex >= 0 && <ImageLightbox variant="media" images={shown.map(item => ({ id: item.id, image_url: item.file_url ?? item.link_url ?? "", caption: item.name }))}
      index={viewIndex} onIndexChange={index => setViewId(shown[index]?.id ?? null)} onClose={() => setViewId(null)}
      onDelete={id => { const item = shown.find(image => image.id === id); setViewId(null); if (item) void archive(item); }}
      onCaptionChange={(id, name) => void run(labelled("Подпись не сохранена", () => write.put(`/resources/${id}`, { name })), { affects: imageAffects })} />}
    {dialog === "album" && <AlbumDialog owners={[...owners.values()]} initialOwner={currentOwner ?? openOwner} onSave={saveAlbum} onClose={() => setDialog(null)} />}
    {dialog === "upload" && <UploadDialog onSave={upload} onClose={() => setDialog(null)} />}
  </Loadable>);
}

function LoosePhoto({ item, owner, onOpen, onMenu }: { item: Resource; owner?: Owner; onOpen: () => void; onMenu: (x: number, y: number) => void }) {
  const src = useGalleryImage(item.file_url ?? item.link_url);
  return <article className="media-gallery__loose-photo" draggable
    onDragStart={event => event.dataTransfer.setData(DRAG_IMAGE, String(item.id))}
    onContextMenu={event => { if (!event.shiftKey) { event.preventDefault(); onMenu(event.clientX, event.clientY); } }}>
    <button className="media-gallery__image" type="button" onClick={onOpen} aria-label={`Открыть: ${item.name}`}>
      {src ? <img src={src} alt="" loading="lazy" draggable={false} /> : <NavIcon name="image" />}
    </button>
    <div className="media-gallery__caption"><h3>{item.name}</h3><span>{owner ? ownerLabel(owner) : "нигде"}</span></div>
    <button className="d-btn d-btn--sm media-gallery__more" type="button" aria-label={`Действия: ${item.name}`}
      onClick={event => { const box = event.currentTarget.getBoundingClientRect(); onMenu(box.left, box.bottom); }}>⋯</button>
  </article>;
}

function AlbumDialog({ owners, initialOwner, onSave, onClose }: { owners: Owner[]; initialOwner?: Owner; onSave: (name: string, owner: Owner) => Promise<void>; onClose: () => void }) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState<Owner["kind"]>(initialOwner?.kind ?? "setting");
  const [selection, setSelection] = useState(initialOwner ? ownerKey(initialOwner) : "");
  const [busy, setBusy] = useState(false);
  const choices = owners.filter(owner => owner.kind === kind);
  const owner = choices.find(option => ownerKey(option) === selection);
  return <Modal ariaLabel="Новый альбом" onClose={onClose} className="media-dialog">
    <h2>Новый альбом</h2>
    <form onSubmit={async event => {
      event.preventDefault();
      if (!owner || !name.trim() || busy) return;
      setBusy(true);
      try { await onSave(name.trim(), owner); }
      finally { setBusy(false); }
    }}>
      <div className="media-dialog__body">
        <label>Название<input className="d-input" value={name} onChange={event => setName(event.target.value)} placeholder="Например, Лица Нижнего города" required /></label>
        <fieldset>
          <legend>Чей альбом</legend>
          <div className="d-seg">{(["setting", "campaign"] as const).map(value =>
            <button key={value} type="button" className={kind === value ? "active" : ""} aria-pressed={kind === value}
              onClick={() => setKind(value)}>{value === "setting" ? "Сеттинг" : "Кампания"}</button>)}</div>
          <select className="d-select" aria-label={kind === "setting" ? "Сеттинг" : "Кампания"} value={owner ? selection : ""} required onChange={event => setSelection(event.target.value)}>
            <option value="">Выбрать…</option>{choices.map(option => <option key={ownerKey(option)} value={ownerKey(option)}>{option.name}</option>)}
          </select>
          <p className="media-dialog__note">Альбом появится в группе выбранного сеттинга или кампании.</p>
        </fieldset>
      </div>
      <div className="modal-footer"><button className="d-btn" type="button" onClick={onClose}>Отмена</button>
        <button className="d-btn d-btn--primary" type="submit" disabled={busy || !owner || !name.trim()}>Создать</button></div>
    </form>
  </Modal>;
}

function UploadDialog({ onSave, onClose }: { onSave: (data: FormData) => Promise<void>; onClose: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState(false);
  return <Modal ariaLabel="Загрузить изображение" onClose={onClose} className="media-dialog">
    <h2>Загрузить изображение</h2>
    <form onSubmit={async event => {
      event.preventDefault();
      if (busy || (!file && !link.trim())) return;
      const form = new FormData(event.currentTarget);
      const category = String(form.get("category"));
      form.set("type", category);
      form.set("name", String(form.get("name")).trim() || file?.name.replace(/\.[^.]+$/, "") || link.trim());
      if (!file) form.delete("file");
      setBusy(true);
      try { await onSave(form); }
      finally { setBusy(false); }
    }}>
      <div className="media-dialog__body">
        <label>Название<input className="d-input" name="name" placeholder={file?.name.replace(/\.[^.]+$/, "")} /></label>
        <label>Тип<select className="d-select" name="category"><option value="image">Изображение</option><option value="map">Карта</option></select></label>
        <label>Файл<input type="file" name="file" accept={IMAGE_ACCEPT} onChange={event => setFile(event.target.files?.[0] ?? null)} /></label>
        {!file && <label>Или ссылка<input className="d-input" name="link_url" type="url" value={link} onChange={event => setLink(event.target.value)} /></label>}
        <label>Теги<input className="d-input" name="tags" placeholder="Через запятую" /></label>
      </div>
      <div className="modal-footer"><button className="d-btn" type="button" onClick={onClose}>Отмена</button>
        <button className="d-btn d-btn--primary" type="submit" disabled={busy || (!file && !link.trim())}>Загрузить</button></div>
    </form>
  </Modal>;
}
