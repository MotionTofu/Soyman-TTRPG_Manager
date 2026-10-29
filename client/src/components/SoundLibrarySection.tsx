import { useState, type ChangeEvent } from "react";
import { SoundIcon } from "../sound/SoundIcon";
import { formatDuration } from "../sound/duration";
import { isSoundSort, sortSounds, SOUND_SORTS, type SoundSort } from "../sound/librarySort";
import type { AudioRole, SoundButton, SoundFolder } from "../sound/types";
import { SoundPreviewButton } from "./SoundPreviewButton";

export interface SoundSection {
  role: AudioRole;
  title: string;
  into: string;
  hint: string;
  icon: string;
}

export function SoundLibrarySection({ section, sounds, folders, durations, uploading, playingId, onPreview, onUpload, onEdit, onCreate, onRename, onDelete }: {
  section: SoundSection;
  sounds: SoundButton[];
  folders: SoundFolder[];
  durations: Map<number, number>;
  uploading: AudioRole | null;
  playingId: number | null;
  onPreview: (sound: SoundButton) => void;
  onUpload: (role: AudioRole, folderId: number | null, event: ChangeEvent<HTMLInputElement>) => void;
  onEdit: (id: number) => void;
  onCreate: () => void;
  onRename: (folder: SoundFolder) => void;
  onDelete: (folder: SoundFolder) => void;
}) {
  const storageKey = `soyman.audio-library.sort.${section.role}`;
  const [sort, setSort] = useState<SoundSort>(() => {
    try {
      const stored = localStorage.getItem(storageKey);
      return isSoundSort(stored) ? stored : "name-asc";
    } catch { return "name-asc"; }
  });
  const [collapsed, setCollapsed] = useState<Set<number>>(() => new Set());
  const items = sortSounds(sounds.filter((s) => s.role === section.role), sort, durations);
  const sectionFolders = folders.filter((f) => f.role === section.role)
    .sort((a, b) => a.name.localeCompare(b.name, "ru", { numeric: true, sensitivity: "base" }) || a.id - b.id);
  const folderIds = new Set(sectionFolders.map((f) => f.id));
  const loose = items.filter((s) => s.folder_id == null || !folderIds.has(s.folder_id));

  function uploadButton(folder: SoundFolder | null) {
    return <label className="sl-add">
      <input className="sl-upload-input" type="file" multiple accept="audio/*"
        aria-label={folder ? `Добавить звуки в папку «${folder.name}»` : `Добавить в ${section.into}`}
        disabled={uploading !== null}
        onChange={(event) => onUpload(section.role, folder?.id ?? null, event)} />
      {uploading === section.role ? "Загружаю…" : folder ? "+ Добавить звуки" : `+ Добавить в ${section.into}`}
    </label>;
  }

  function renderSounds(list: SoundButton[]) {
    if (!list.length) return <p className="sl-empty">Пока пусто.</p>;
    return <div className={section.role === "background" ? "sl-tracks" : "sl-tiles"}>
      {list.map((sound) => {
        const seconds = durations.get(sound.resource_id);
        const time = seconds !== undefined ? formatDuration(seconds) : "";
        return section.role === "background" ? (
          <div key={sound.resource_id} className={sound.missing ? "sl-track broken" : "sl-track"}>
            <SoundPreviewButton sound={sound} playing={playingId === sound.resource_id} onPreview={onPreview} />
            <button type="button" className="sl-track-edit" onClick={() => onEdit(sound.resource_id)}
              aria-label={`Редактировать звук: ${sound.name}`}>
              <span className="sl-track-name">{sound.name}</span>
              <span className="sl-track-time">{sound.missing ? "нет файла" : time}</span>
            </button>
          </div>
        ) : (
          <div key={sound.resource_id} className={sound.missing ? "sl-tile broken" : "sl-tile"}>
            <SoundPreviewButton sound={sound} playing={playingId === sound.resource_id} onPreview={onPreview} />
            {sound.pinned ? <span className="sl-pin">★</span> : null}
            <button type="button" className="sl-tile-edit" onClick={() => onEdit(sound.resource_id)}
              aria-label={`Редактировать звук: ${sound.name}`}>
              <SoundIcon name={sound.icon} imageUrl={sound.icon_url} size={26} />
              <span className="sl-tile-name">{sound.name}</span>
              {sound.missing ? <span className="sl-tile-note broken">файл не найден</span> : <>
                {time && <span className="sl-tile-note">{time}</span>}
                {!sound.icon && !sound.icon_url && <span className="sl-tile-note">без иконки</span>}
              </>}
            </button>
          </div>
        );
      })}
    </div>;
  }

  return <section className="sl-section" aria-label={section.title}>
    <div className="sl-section-head">
      <SoundIcon name={section.icon} size={18} />
      <span className="sl-section-title">{section.title}</span>
      <span className="sl-section-hint">{items.length} · {section.hint}</span>
      <span className="sl-section-spacer" />
      <select className="sl-sort" aria-label={`Сортировка: ${section.title}`} value={sort}
        onChange={(event) => {
          const value = event.target.value;
          if (!isSoundSort(value)) return;
          setSort(value);
          try { localStorage.setItem(storageKey, value); } catch { /* Недоступное хранилище не мешает сортировке. */ }
        }}>
        {SOUND_SORTS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
      <button className="sl-add" onClick={onCreate}>+ Папка</button>
      {uploadButton(null)}
    </div>
    {sectionFolders.length > 0 && <span className="sl-root-label">Без папки · {loose.length}</span>}
    {renderSounds(loose)}
    {sectionFolders.map((folder) => {
      const members = items.filter((s) => s.folder_id === folder.id);
      const open = !collapsed.has(folder.id);
      return <section key={folder.id} className="sl-folder" aria-label={`Папка: ${folder.name}`}>
        <div className="sl-folder-head">
          <button className="sl-folder-toggle" aria-expanded={open} aria-controls={`sound-folder-${folder.id}`}
            onClick={() => setCollapsed((previous) => {
              const next = new Set(previous);
              if (next.has(folder.id)) next.delete(folder.id); else next.add(folder.id);
              return next;
            })}>
            <span aria-hidden="true">{open ? "▾" : "▸"}</span>
            <span className="sl-folder-name">{folder.name}</span>
            <span className="sl-section-hint">{members.length}</span>
          </button>
          <div className="sl-folder-actions">
            <button className="sl-add" aria-label={`Переименовать папку «${folder.name}»`} onClick={() => onRename(folder)}>Переименовать</button>
            <button className="sl-add" aria-label={`Удалить папку «${folder.name}»`} onClick={() => onDelete(folder)}>Удалить папку</button>
            {uploadButton(folder)}
          </div>
        </div>
        <div id={`sound-folder-${folder.id}`} hidden={!open}>{open && renderSounds(members)}</div>
      </section>;
    })}
  </section>;
}
