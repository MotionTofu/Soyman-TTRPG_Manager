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

// Сколько звуков без папки видно до «Показать все» (макет «Д» Roll-Audio).
const ROOT_LIMIT = 12;

export function SoundLibrarySection({ section, sounds, folders, durations, uploading, playingId, query = "", onPreview, onUpload, onEdit, onCreate, onRename, onDelete }: {
  section: SoundSection;
  sounds: SoundButton[];
  folders: SoundFolder[];
  durations: Map<number, number>;
  uploading: AudioRole | null;
  playingId: number | null;
  /** Поиск по имени: раскрывает папки и снимает предел корня. */
  query?: string;
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
  const [showAll, setShowAll] = useState(false);
  const needle = query.trim().toLocaleLowerCase("ru");
  const items = sortSounds(sounds.filter((s) => s.role === section.role
    && (!needle || s.name.toLocaleLowerCase("ru").includes(needle))), sort, durations);
  const sectionFolders = folders.filter((f) => f.role === section.role)
    .sort((a, b) => a.name.localeCompare(b.name, "ru", { numeric: true, sensitivity: "base" }) || a.id - b.id);
  const folderIds = new Set(sectionFolders.map((f) => f.id));
  const loose = items.filter((s) => s.folder_id == null || !folderIds.has(s.folder_id));
  const limited = !needle && !showAll && loose.length > ROOT_LIMIT;
  const looping = section.role === "ambient" || section.role === "weather";

  function uploadButton(folder: SoundFolder | null) {
    return <label className="d-btn d-btn--sm sl-upload">
      <input className="sl-upload-input" type="file" multiple accept="audio/*"
        aria-label={folder ? `Добавить звуки в папку «${folder.name}»` : `Добавить в ${section.into}`}
        disabled={uploading !== null}
        onChange={(event) => onUpload(section.role, folder?.id ?? null, event)} />
      {uploading === section.role ? "Загружаю…" : folder ? "+ Звуки" : `+ Добавить в ${section.into}`}
    </label>;
  }

  function renderSounds(list: SoundButton[]) {
    if (!list.length) return <p className="sl-empty">{needle ? "Не найдено." : "Пока пусто."}</p>;
    return <div className="sl-tracks">
      {list.map((sound) => {
        const seconds = durations.get(sound.resource_id);
        const time = seconds !== undefined ? formatDuration(seconds) : "";
        const playing = playingId === sound.resource_id;
        return <div key={sound.resource_id} className={`sl-track${sound.missing ? " broken" : ""}${playing ? " is-playing" : ""}`}>
          <SoundPreviewButton sound={sound} playing={playing} onPreview={onPreview} />
          <button type="button" className="sl-track-edit" onClick={() => onEdit(sound.resource_id)}
            aria-label={`Редактировать звук: ${sound.name}`}>
            {/* Иконка — та же, что на кнопке пульта: глаз узнаёт звук в обоих местах. */}
            {section.role !== "background" && (sound.icon || sound.icon_url) &&
              <SoundIcon name={sound.icon} imageUrl={sound.icon_url} size={18} />}
            <span className="sl-track-name">{sound.name}</span>
            {looping && <span className="sl-loop" title="Зациклен">↻</span>}
            {sound.pinned && <span className="sl-pin" title="Постоянно в пульте">★</span>}
            <span className="sl-track-time">{sound.missing ? "нет файла" : time}</span>
          </button>
        </div>;
      })}
    </div>;
  }

  return <section className="sl-section" aria-label={section.title}>
    <div className="d-plate-row sl-section-head">
      <h2 className="d-plate">{section.title}</h2>
      <span className="d-note">{items.length} · {section.hint}</span>
      <span className="d-end sl-section-end">
        <select className="sl-sort" aria-label={`Сортировка: ${section.title}`} value={sort}
          onChange={(event) => {
            const value = event.target.value;
            if (!isSoundSort(value)) return;
            setSort(value);
            try { localStorage.setItem(storageKey, value); } catch { /* Недоступное хранилище не мешает сортировке. */ }
          }}>
          {SOUND_SORTS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
        <button className="d-btn d-btn--sm" onClick={onCreate}>+ Папка</button>
        {uploadButton(null)}
      </span>
    </div>
    {sectionFolders.length > 0 && <span className="sl-root-label">Без папки · {loose.length}</span>}
    {renderSounds(limited ? loose.slice(0, ROOT_LIMIT) : loose)}
    {!needle && loose.length > ROOT_LIMIT && <button type="button" className="sl-more" onClick={() => setShowAll(!showAll)}>
      {showAll ? "Свернуть ‹" : `Показать все ${loose.length} ›`}
    </button>}
    {sectionFolders.map((folder) => {
      const members = items.filter((s) => s.folder_id === folder.id);
      if (needle && !members.length) return null;
      const open = !!needle || !collapsed.has(folder.id);
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
            <span className="d-note">{members.length}</span>
          </button>
          <div className="sl-folder-actions">
            <button className="d-btn d-btn--sm" aria-label={`Переименовать папку «${folder.name}»`} onClick={() => onRename(folder)}>Переименовать</button>
            <button className="d-btn d-btn--sm" aria-label={`Удалить папку «${folder.name}»`} onClick={() => onDelete(folder)}>Удалить</button>
            {uploadButton(folder)}
          </div>
        </div>
        <div id={`sound-folder-${folder.id}`} hidden={!open}>{open && renderSounds(members)}</div>
      </section>;
    })}
  </section>;
}
