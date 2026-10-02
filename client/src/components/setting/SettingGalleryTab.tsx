import { useMemo, useRef, useState, type DragEvent } from "react";
import { Link } from "react-router-dom";
import { getAuthToken } from "../../api/client";
import { useAction, useResource, write } from "../../data/hooks";
import { labelled, showSaveError } from "../../data/notices";
import { settingPagePaths } from "../../data/settingPage";
import { useConfirm } from "../../hooks/useConfirm";
import { IMAGE_ACCEPT } from "../../imageUpload";
import { RESOURCE_CATEGORIES, guessResourceCategory } from "../../resourceCategories";
import { isSafeImageUrl } from "../../utils/safeUrl";
import { useAuthenticatedFileUrl } from "../../utils/fileUrl";
import { ContextMenu, type ContextMenuItem } from "../ContextMenu";
import { EmptyState } from "../EmptyState";
import { ImageLightbox } from "../ImageLightbox";
import type { Album, Resource, Setting } from "../../types";

// «Галерея» сеттинга (разбор профиля сеттинга, Q12/Q28; альбомы — Q20–Q22,
// Q26–Q28; макеты — доски 19 и 19б): ресурсы-изображения и карты сеттинга —
// те же, что в глобальной «Галерее». Сверху стопки альбомов, ниже висит
// открытый альбом. Картинка лежит в одном альбоме; перетаскивание на стопку
// или «В альбом ›» перекладывает. Слоты «Фон профиля» и «Обложка» берут
// картинку из любого альбома (ПКМ по картинке).

const NO_RESOURCES: Resource[] = [];
const NO_ALBUMS: Album[] = [];
const TILT = [-1.2, 0.8, 1.1, -0.7, 0.5, -1];
const STACK_TILT = [
  [-4, -6, 3],
  [3, 5, -2],
  [-2, 2, 4],
  [5, -3, -5],
];
/** «Без альбома» — не альбом, а остаток: картинки без альбома этого сеттинга. */
const LOOSE = "loose";
const DRAG_IMAGE = "application/x-soyman-gallery-image";
const DRAG_ALBUM = "application/x-soyman-gallery-album";

type Open = number | typeof LOOSE;

function kindOf(r: Resource): string {
  if (r.category && RESOURCE_CATEGORIES.some((c) => c.key === r.category)) return r.category;
  return guessResourceCategory(r.file_url || r.link_url || r.name);
}

function useImageSrc(url: string | null | undefined): string | null {
  const safe = url && isSafeImageUrl(url) ? url : null;
  const auth = useAuthenticatedFileUrl(safe);
  return safe?.startsWith("/files/") ? auth : safe;
}

const imagesWord = (n: number) => {
  const d = n % 10;
  const dd = n % 100;
  if (d === 1 && dd !== 11) return `${n} картинка`;
  if (d >= 2 && d <= 4 && (dd < 12 || dd > 14)) return `${n} картинки`;
  return `${n} картинок`;
};

export function SettingGalleryTab({ setting }: { setting: Setting }) {
  const run = useAction();
  const [confirmDialog, confirm] = useConfirm();
  const albumsPath = `/albums?setting_id=${setting.id}`;
  const all = useResource<Resource[]>(settingPagePaths.resources(setting.id)).data ?? NO_RESOURCES;
  const albums = useResource<Album[]>(albumsPath).data ?? NO_ALBUMS;
  const images = useMemo(() => all.filter((r) => ["image", "map"].includes(kindOf(r))), [all]);
  const [picked, setPicked] = useState<Open | null>(null);
  const [query, setQuery] = useState("");
  const [slotsOpen, setSlotsOpen] = useState(false);
  const [naming, setNaming] = useState<{ id: number | null; name: string } | null>(null);
  const [view, setView] = useState<number | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; items: ContextMenuItem[] } | null>(null);
  const upload = useRef<HTMLInputElement>(null);
  const albumFile = useRef<HTMLInputElement>(null);
  const [imported, setImported] = useState<string | null>(null);
  const settingAffects = [{ kind: "setting" as const, id: setting.id }];
  const resourceAffects = [{ kind: "resource" as const }, { path: settingPagePaths.resources(setting.id) }];
  const albumAffects = [{ path: "/albums" }];

  // Картинка чужого альбома (из другого сеттинга, куда её тоже отметили)
  // здесь считается «без альбома».
  const albumIds = new Set(albums.map((a) => a.id));
  const inAlbum = (r: Resource): Open => (r.album_id != null && albumIds.has(r.album_id) ? r.album_id : LOOSE);
  const byAlbum = new Map<Open, Resource[]>();
  for (const r of images) byAlbum.set(inAlbum(r), [...(byAlbum.get(inAlbum(r)) ?? []), r]);
  const loose = byAlbum.get(LOOSE) ?? [];

  // Открыт выбранный альбом; если его нет (удалён, первый заход) — первый,
  // а без альбомов — остаток.
  const open: Open = picked !== null && (picked === LOOSE ? loose.length > 0 || !albums.length : albumIds.has(picked)) ? picked : (albums[0]?.id ?? LOOSE);
  const openAlbum = albums.find((a) => a.id === open);
  const q = query.trim().toLowerCase();
  const shown = q
    ? images.filter((r) => r.name.toLowerCase().includes(q) || (r.tags ?? "").toLowerCase().includes(q))
    : [...(byAlbum.get(open) ?? [])].sort((a, b) => b.id - a.id);

  async function uploadFile(file: File | undefined) {
    if (!file) return;
    const form = new FormData();
    form.append("name", file.name.replace(/\.[^.]+$/, ""));
    form.append("scope", "setting");
    form.append("setting_id", String(setting.id));
    form.append("type", "image");
    form.append("category", "image");
    // Загрузка — в открытый альбом (Q28).
    if (typeof open === "number") form.append("album_id", String(open));
    form.append("file", file);
    await run(labelled("Картинка не загружена", () => write.post<Resource>("/resources", form, { timeoutMs: 120000 })), {
      affects: resourceAffects,
      retry: false,
    });
  }

  async function moveTo(r: Resource, album: Open) {
    setMenu(null);
    if (inAlbum(r) === album) return;
    await run(labelled("Картинка не переложена", () => write.put(`/resources/${r.id}`, { album_id: album === LOOSE ? null : album })), {
      affects: resourceAffects,
    });
  }

  async function saveName() {
    const name = naming?.name.trim();
    const id = naming?.id;
    setNaming(null);
    if (!name) return;
    if (id == null) {
      const created = await run(labelled("Альбом не создан", () => write.post<Album>("/albums", { name, setting_id: setting.id })), { affects: albumAffects });
      if (created) setPicked(created.id);
    } else {
      await run(labelled("Альбом не переименован", () => write.put(`/albums/${id}`, { name })), { affects: albumAffects });
    }
  }

  async function removeAlbum(a: Album) {
    setMenu(null);
    const ok = await confirm({
      title: `Удалить альбом «${a.name}»?`,
      message: "Картинки останутся в галерее — в «Без альбома».",
      confirmLabel: "Удалить",
      danger: true,
    });
    if (!ok) return;
    await run(labelled("Альбом не удалён", () => write.del(`/albums/${a.id}`)), { affects: [...albumAffects, ...resourceAffects] });
  }

  // Файл альбома (разбор 2026-10-02, Q3–Q7): ZIP с картинками и album.json.
  async function exportAlbum(a: Album) {
    setMenu(null);
    const token = getAuthToken();
    const res = await fetch(`/api/albums/${a.id}/export`, { headers: token ? { Authorization: `Bearer ${token}` } : undefined }).catch(() => null);
    if (!res?.ok) {
      showSaveError("Альбом не выгружен");
      return;
    }
    const url = URL.createObjectURL(await res.blob());
    const link = document.createElement("a");
    link.href = url;
    link.download = `${a.name}.zip`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function importAlbum(file: File | undefined) {
    if (!file) return;
    const form = new FormData();
    form.append("file", file);
    const result = await run(
      labelled("Альбом не импортирован", () =>
        write.post<{ album: { id: number; name: string } | null; added: number; skipped: number }>(`/albums/import?setting_id=${setting.id}`, form, { timeoutMs: 600000 })
      ),
      { affects: [...albumAffects, ...resourceAffects], retry: false }
    );
    if (!result) return;
    if (!result.album) {
      setImported("Все картинки альбома уже есть в галерее — новый альбом не заведён.");
      return;
    }
    setPicked(result.album.id);
    setQuery("");
    setImported(
      `Альбом «${result.album.name}»: добавлено — ${imagesWord(result.added)}` +
        (result.skipped ? `; уже были в галерее и остались на своих местах — ${imagesWord(result.skipped)}` : "")
    );
  }

  async function reorder(dragged: number, before: number) {
    if (dragged === before) return;
    const ids = albums.map((a) => a.id).filter((id) => id !== dragged);
    ids.splice(ids.indexOf(before), 0, dragged);
    await run(labelled("Порядок альбомов не сохранён", () => write.put("/albums/reorder", { order: ids })), { affects: albumAffects });
  }

  async function toSlot(kind: "background" | "thumbnail", r: Resource) {
    setMenu(null);
    await run(labelled("Слот не обновлён", () => write.post(`/settings/${setting.id}/${kind}/from-resource`, { resource_id: r.id })), {
      affects: settingAffects,
    });
  }

  async function clearSlot(kind: "background" | "thumbnail") {
    const ok = await confirm({
      title: kind === "background" ? "Убрать фон?" : "Убрать обложку?",
      message: "Картинка останется в галерее.",
      confirmLabel: "Убрать",
    });
    if (!ok) return;
    await run(() => write.del(`/settings/${setting.id}/${kind}`).then(() => true), { affects: settingAffects });
  }

  async function archive(r: Resource) {
    setMenu(null);
    const ok = await confirm({ message: `Отправить «${r.name}» в архив?`, confirmLabel: "В архив", danger: true });
    if (!ok) return;
    await run(labelled("Картинка не архивирована", () => write.del(`/resources/${r.id}`)), { affects: [...resourceAffects, { path: "/archive" }] });
  }

  function imageMenu(x: number, y: number, r: Resource) {
    const targets: ContextMenuItem[] = albums.filter((a) => a.id !== inAlbum(r)).map((a) => ({ label: a.name, onClick: () => void moveTo(r, a.id) }));
    if (inAlbum(r) !== LOOSE) targets.push({ label: "Без альбома", onClick: () => void moveTo(r, LOOSE) });
    setMenu({
      x,
      y,
      items: [
        { label: "Сделать фоном", onClick: () => void toSlot("background", r) },
        { label: "Сделать обложкой", onClick: () => void toSlot("thumbnail", r) },
        ...(targets.length ? [{ label: "В альбом", children: targets }] : []),
        { label: "В архив", danger: true, onClick: () => void archive(r) },
      ],
    });
  }

  function albumMenu(x: number, y: number, a: Album) {
    setMenu({
      x,
      y,
      items: [
        {
          label: "Переименовать",
          onClick: () => {
            setMenu(null);
            setNaming({ id: a.id, name: a.name });
          },
        },
        { label: "Экспорт альбома", onClick: () => void exportAlbum(a) },
        { label: "Удалить альбом", danger: true, onClick: () => void removeAlbum(a) },
      ],
    });
  }

  const nameInput = (
    <input
      className="setting-gallery__name-input"
      autoFocus
      aria-label="Название альбома"
      placeholder="Название альбома"
      value={naming?.name ?? ""}
      onChange={(e) => setNaming((n) => n && { ...n, name: e.target.value })}
      onBlur={() => void saveName()}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") setNaming(null);
      }}
    />
  );

  return (
    <div className="setting-gallery">
      {confirmDialog}
      <div className="population__toolbar">
        <input className="population__search" type="search" placeholder="Картинка во всех альбомах" aria-label="Поиск по галерее" value={query} onChange={(e) => setQuery(e.target.value)} />
        <span className="population__spacer" />
        <button type="button" className={`population__chip${slotsOpen ? " is-on" : ""}`} aria-expanded={slotsOpen} onClick={() => setSlotsOpen((v) => !v)}>
          Слоты «Фон» и «Обложка»
        </button>
        <Link to="/gallery">Открыть в Галерее ›</Link>
        <button type="button" className="population__create" onClick={() => upload.current?.click()}>
          Загрузить
        </button>
        <input ref={upload} type="file" accept={IMAGE_ACCEPT} hidden onChange={(e) => {
          void uploadFile(e.target.files?.[0]);
          e.target.value = "";
        }} />
      </div>

      {slotsOpen && (
        <div className="setting-gallery__slots">
          <Slot label="Фон профиля" wide url={setting.background_image_url} hint="ПКМ по картинке ниже — «Сделать фоном»" onClear={() => clearSlot("background")} />
          <Slot label="Обложка" url={setting.thumbnail_image_url} hint="ПКМ по картинке — «Сделать обложкой»" onClear={() => clearSlot("thumbnail")} />
          <p className="muted setting-gallery__note">Слоты берут картинку из любого альбома. Обложка видна в списке сеттингов и на «Обзоре».</p>
        </div>
      )}

      <section className="setting-gallery__albums" aria-label="Альбомы">
        {albums.map((a, i) => (
          <Stack
            key={a.id}
            name={a.name}
            items={byAlbum.get(a.id) ?? []}
            tilt={STACK_TILT[i % STACK_TILT.length]}
            current={!q && open === a.id}
            onOpen={() => {
              setPicked(a.id);
              setQuery("");
            }}
            onMenu={(x, y) => albumMenu(x, y, a)}
            onDragStart={(e) => e.dataTransfer.setData(DRAG_ALBUM, String(a.id))}
            onDropImage={(id) => {
              const r = images.find((x) => x.id === id);
              if (r) void moveTo(r, a.id);
            }}
            onDropAlbum={(id) => void reorder(id, a.id)}
          />
        ))}
        {/* «Без альбома» — последней и только непустой (Q26). */}
        {loose.length > 0 && albums.length > 0 && (
          <Stack
            name="Без альбома"
            items={loose}
            tilt={STACK_TILT[albums.length % STACK_TILT.length]}
            current={!q && open === LOOSE}
            onOpen={() => {
              setPicked(LOOSE);
              setQuery("");
            }}
            onDropImage={(id) => {
              const r = images.find((x) => x.id === id);
              if (r) void moveTo(r, LOOSE);
            }}
          />
        )}
        {naming?.id === null ? (
          <div className="setting-gallery__new is-naming">{nameInput}</div>
        ) : (
          <div className="setting-gallery__new">
            <button type="button" className="setting-gallery__new-main" onClick={() => setNaming({ id: null, name: "" })}>
              <span aria-hidden="true">+</span>
              Альбом
            </button>
            <button type="button" className="setting-gallery__new-file" onClick={() => albumFile.current?.click()}>
              из файла…
            </button>
          </div>
        )}
        <input ref={albumFile} type="file" accept=".zip,application/zip" hidden onChange={(e) => {
          void importAlbum(e.target.files?.[0]);
          e.target.value = "";
        }} />
      </section>
      {imported && (
        <p className="muted setting-gallery__imported">
          {imported}
          <button type="button" className="setting-gallery__more" aria-label="Скрыть" onClick={() => setImported(null)}>
            ×
          </button>
        </p>
      )}

      {images.length === 0 ? (
        <EmptyState title="Картинок пока нет" hint="Референсы, скетчи, карты этого мира. Загруженное здесь появится и в общей «Галерее»." />
      ) : (
        <>
          <div className="setting-gallery__head">
            {q ? (
              <h3>Найдено</h3>
            ) : naming && naming.id === openAlbum?.id ? (
              nameInput
            ) : (
              <h3>{openAlbum?.name ?? "Без альбома"}</h3>
            )}
            <span className="muted">{imagesWord(shown.length)}</span>
            <span className="population__spacer" />
            {!q && openAlbum && (
              <button
                type="button"
                className="setting-gallery__more"
                aria-label={`Альбом «${openAlbum.name}»: переименовать, экспорт, удалить`}
                onClick={(e) => {
                  const r = e.currentTarget.getBoundingClientRect();
                  albumMenu(r.right, r.bottom, openAlbum);
                }}
              >
                ⋯
              </button>
            )}
          </div>
          {shown.length === 0 ? (
            <p className="muted">{q ? "Ничего не нашлось." : "Альбом пуст. Перетащите сюда картинку из другого альбома или загрузите новую."}</p>
          ) : (
            <ul className="setting-gallery__wall">
              {shown.map((r, i) => (
                <li key={r.id} style={{ ["--tilt" as string]: `${TILT[i % TILT.length]}deg` }}>
                  <Tile resource={r} taped={i % 3 !== 1} onOpen={() => setView(i)} onMenu={(x, y) => imageMenu(x, y, r)} />
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
      {view !== null && (
        <ImageLightbox
          images={shown.map((r) => ({ id: r.id, image_url: r.file_url ?? r.link_url ?? "", caption: r.name }))}
          index={view}
          onIndexChange={setView}
          onClose={() => setView(null)}
          onDelete={(id) => {
            setView(null);
            const r = shown.find((x) => x.id === id);
            if (r) void archive(r);
          }}
          onCaptionChange={(id, caption) => void run(() => write.put(`/resources/${id}`, { name: caption }), { affects: resourceAffects })}
        />
      )}
    </div>
  );
}

function Stack({
  name,
  items,
  tilt,
  current,
  onOpen,
  onMenu,
  onDragStart,
  onDropImage,
  onDropAlbum,
}: {
  name: string;
  items: Resource[];
  tilt: number[];
  current: boolean;
  onOpen: () => void;
  onMenu?: (x: number, y: number) => void;
  onDragStart?: (e: DragEvent) => void;
  onDropImage: (id: number) => void;
  onDropAlbum?: (id: number) => void;
}) {
  const [over, setOver] = useState(false);
  // Стопка — три последние картинки (Q26); пустой альбом — рамка с названием.
  const top = [...items].sort((a, b) => b.id - a.id).slice(0, 3).reverse();
  const accepts = (e: DragEvent) => e.dataTransfer.types.includes(DRAG_IMAGE) || (!!onDropAlbum && e.dataTransfer.types.includes(DRAG_ALBUM));
  return (
    <button
      type="button"
      className={`setting-gallery__stack${current ? " is-current" : ""}${over ? " is-over" : ""}${items.length ? "" : " is-empty"}`}
      aria-current={current}
      draggable={!!onDragStart}
      onDragStart={onDragStart}
      onClick={onOpen}
      onContextMenu={(e) => {
        if (!onMenu) return;
        e.preventDefault();
        onMenu(e.clientX, e.clientY);
      }}
      onDragOver={(e) => {
        if (!accepts(e)) return;
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        setOver(false);
        const image = Number(e.dataTransfer.getData(DRAG_IMAGE));
        const album = Number(e.dataTransfer.getData(DRAG_ALBUM));
        if (image) onDropImage(image);
        else if (album && onDropAlbum) onDropAlbum(album);
      }}
    >
      {top.map((r, i) => (
        <StackLayer key={r.id} resource={r} index={i} tilt={tilt[i]} />
      ))}
      {items.length > 0 && <span className="setting-gallery__stack-tape" aria-hidden="true" />}
      <span className="setting-gallery__stack-name">
        {name}
        <span>· {items.length}</span>
      </span>
    </button>
  );
}

function StackLayer({ resource, index, tilt }: { resource: Resource; index: number; tilt: number }) {
  const src = useImageSrc(resource.file_url ?? resource.link_url);
  return (
    <span className="setting-gallery__stack-layer" aria-hidden="true" style={{ ["--i" as string]: index, ["--tilt" as string]: `${tilt}deg` }}>
      {src && <img src={src} alt="" loading="lazy" draggable={false} />}
    </span>
  );
}

function Slot({ label, url, hint, wide, onClear }: { label: string; url: string | null; hint: string; wide?: boolean; onClear: () => void }) {
  const src = useImageSrc(url);
  return (
    <div className={`setting-gallery__slot${wide ? " is-wide" : ""}`}>
      <span className="paper-label">{label}</span>
      <div className="setting-gallery__slot-frame">
        {src ? <img src={src} alt={label} /> : <span>{hint}</span>}
      </div>
      {src && (
        <button type="button" className="setting-passport__empty" onClick={onClear}>
          Убрать
        </button>
      )}
    </div>
  );
}

function Tile({ resource, taped, onOpen, onMenu }: { resource: Resource; taped: boolean; onOpen: () => void; onMenu: (x: number, y: number) => void }) {
  const src = useImageSrc(resource.file_url ?? resource.link_url);
  return (
    <figure
      className="setting-gallery__tile"
      draggable
      onDragStart={(e) => e.dataTransfer.setData(DRAG_IMAGE, String(resource.id))}
      onContextMenu={(e) => {
        e.preventDefault();
        onMenu(e.clientX, e.clientY);
      }}
    >
      {taped && <span className="setting-gallery__tape" aria-hidden="true" />}
      <button type="button" className="setting-gallery__photo" onClick={onOpen} aria-label={`Открыть: ${resource.name}`}>
        {src ? <img src={src} alt="" loading="lazy" draggable={false} /> : <span>{resource.name}</span>}
      </button>
      <figcaption>
        {resource.name}
        <button
          type="button"
          className="setting-gallery__more"
          aria-label={`Действия: ${resource.name}`}
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            onMenu(r.right, r.bottom);
          }}
        >
          ⋯
        </button>
      </figcaption>
    </figure>
  );
}
