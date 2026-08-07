import { useState, type ReactNode } from "react";
import { api } from "../api/client";
import { MentionTextarea } from "./mentions/MentionTextarea";
import { MentionText } from "./mentions/MentionText";
import { syncMentionLinks } from "../mentions";
import { NavIcon } from "./NavIcons";
import type { Resource } from "../types";

const IMAGE_EXT = /\.(jpe?g|png|gif|webp)$/i;
// Only direct audio-file URLs can be previewed with a plain <audio> element
// — a link to a page on a streaming service (Spotify, YouTube, SoundCloud…)
// isn't a raw audio stream and needs that service's own embed player, which
// isn't attempted here.
const AUDIO_EXT = /\.(mp3|wav|ogg|m4a|flac|aac)$/i;

interface Props {
  resource: Resource;
  onChange: () => void;
  onArchive: (id: number) => void;
  // Extra buttons rendered next to the edit/delete icons — used by the
  // global Ресурсы library for its multi-setting-membership popover.
  extraActions?: ReactNode;
}

export function ResourceCard({ resource, onChange, onArchive, extraActions }: Props) {
  const [editMode, setEditMode] = useState(false);
  const [name, setName] = useState(resource.name);
  const [linkUrl, setLinkUrl] = useState(resource.link_url ?? "");
  const [tags, setTags] = useState(resource.tags);
  const [notes, setNotes] = useState(resource.notes);

  async function save() {
    await api.put(`/resources/${resource.id}`, {
      name,
      link_url: linkUrl,
      tags,
      notes,
    });
    syncMentionLinks("resource", resource.id, resource.notes, notes);
    setEditMode(false);
    onChange();
  }

  const isImage = resource.file_url && IMAGE_EXT.test(resource.file_url);
  // Only a direct link to an audio *file* can be previewed this way — a
  // link to a page on a streaming service still just opens as a plain link.
  const audioSrc = resource.file_url && AUDIO_EXT.test(resource.file_url)
    ? resource.file_url
    : resource.link_url && AUDIO_EXT.test(resource.link_url)
      ? resource.link_url
      : null;

  return (
    <div className="card stack">
      <div className="row" style={{ justifyContent: "space-between" }}>
        {editMode ? (
          <input value={name} onChange={(e) => setName(e.target.value)} />
        ) : (
          <strong>{resource.name}</strong>
        )}
        <div className="row">
          {extraActions}
          <button onClick={() => setEditMode((v) => !v)} title={editMode ? "Отмена" : "Редактировать"}>
            <NavIcon name={editMode ? "close" : "edit"} />
          </button>
          <button onClick={() => onArchive(resource.id)} title="Удалить">
            <NavIcon name="delete" />
          </button>
        </div>
      </div>

      {editMode ? (
        <>
          <label>
            Ссылка (кнопка вместо файла — например, папка на компьютере или сайт)
            <input
              placeholder="https:// или file:///E:/..."
              value={linkUrl}
              onChange={(e) => setLinkUrl(e.target.value)}
            />
          </label>
          <label>
            Теги
            <input value={tags} onChange={(e) => setTags(e.target.value)} />
          </label>
          <label>
            Заметки
            <MentionTextarea value={notes} onChange={setNotes} rows={3} />
          </label>
          <button className="primary" onClick={save} style={{ alignSelf: "flex-start" }}>
            Сохранить
          </button>
        </>
      ) : (
        <>
          {resource.link_url && (
            <a
              href={resource.link_url}
              target="_blank"
              rel="noopener noreferrer"
              className="badge planned resource-link-button"
            >
              <NavIcon name="link" /> Открыть
            </a>
          )}
          {!resource.link_url && resource.file_url && isImage && (
            <a href={resource.file_url} target="_blank" rel="noopener noreferrer">
              <img src={resource.file_url} alt="" className="resource-thumb" />
            </a>
          )}
          {!resource.link_url && resource.file_url && !isImage && !audioSrc && (
            <a href={resource.file_url} target="_blank" rel="noopener noreferrer">
              <NavIcon name="document" /> Открыть файл
            </a>
          )}
          {audioSrc && (
            // eslint-disable-next-line jsx-a11y/media-has-caption
            <audio controls src={audioSrc} style={{ width: "100%" }} />
          )}
          {resource.tags && <div className="muted">{resource.tags}</div>}
          {resource.notes && (
            <div className="muted">
              <MentionText text={resource.notes} />
            </div>
          )}
        </>
      )}
    </div>
  );
}
