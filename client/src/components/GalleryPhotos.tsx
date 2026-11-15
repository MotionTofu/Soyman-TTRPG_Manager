import { useState, type DragEvent } from "react";
import type { Resource } from "../types";
import { DRAG_ALBUM, DRAG_IMAGE, useGalleryImage } from "../media/galleryImages";

export function GalleryStack({
  name,
  items,
  tilt,
  hideCovers = false,
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
  hideCovers?: boolean;
  current: boolean;
  onOpen: () => void;
  onMenu?: (x: number, y: number) => void;
  onDragStart?: (e: DragEvent) => void;
  onDropImage: (id: number) => void;
  onDropAlbum?: (id: number) => void;
}) {
  const [over, setOver] = useState(false);
  // Стопка — три последние картинки (Q26); пустой альбом — рамка с названием.
  const top = hideCovers ? [] : [...items].sort((a, b) => b.id - a.id).slice(0, 3).reverse();
  const accepts = (e: DragEvent) => e.dataTransfer.types.includes(DRAG_IMAGE) || (!!onDropAlbum && e.dataTransfer.types.includes(DRAG_ALBUM));
  return (
    <button
      type="button"
      className={`setting-gallery__stack${current ? " is-current" : ""}${over ? " is-over" : ""}${top.length ? "" : " is-empty"}`}
      aria-current={current}
      draggable={!!onDragStart}
      onDragStart={onDragStart}
      onClick={onOpen}
      onContextMenu={(e) => {
        if (!onMenu || e.shiftKey) return;
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
        if (!accepts(e)) return;
        e.preventDefault();
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
      {top.length > 0 && <span className="setting-gallery__stack-tape" aria-hidden="true" />}
      <span className="setting-gallery__stack-name">
        <strong>{name}</strong>
        <span>{items.length}</span>
      </span>
    </button>
  );
}

function StackLayer({ resource, index, tilt }: { resource: Resource; index: number; tilt: number }) {
  const src = useGalleryImage(resource.file_url ?? resource.link_url);
  return (
    <span className="setting-gallery__stack-layer" aria-hidden="true" style={{ ["--i" as string]: index, ["--tilt" as string]: `${tilt}deg` }}>
      {src && <img src={src} alt="" loading="lazy" draggable={false} />}
    </span>
  );
}

export function GalleryPhoto({ resource, taped, onOpen, onMenu }: { resource: Resource; taped: boolean; onOpen: () => void; onMenu: (x: number, y: number) => void }) {
  const src = useGalleryImage(resource.file_url ?? resource.link_url);
  return (
    <figure
      className="setting-gallery__tile"
      draggable
      onDragStart={(e) => e.dataTransfer.setData(DRAG_IMAGE, String(resource.id))}
      onContextMenu={(e) => {
        if (e.shiftKey) return;
        e.preventDefault();
        onMenu(e.clientX, e.clientY);
      }}
    >
      {taped && <span className="setting-gallery__tape" aria-hidden="true" />}
      <button type="button" className="setting-gallery__photo" onClick={onOpen} aria-label={`Открыть: ${resource.name}`}>
        {src ? <img src={src} alt="" loading="lazy" draggable={false} /> : <span>{resource.name}</span>}
      </button>
      <figcaption>
        <span title={resource.name}>{resource.name}</span>
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
