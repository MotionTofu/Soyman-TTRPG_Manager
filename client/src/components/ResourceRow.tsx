import { useState } from "react";
import { api } from "../api/client";
import { MentionTextarea } from "./mentions/MentionTextarea";
import { syncMentionLinks } from "../mentions";
import { NavIcon } from "./NavIcons";
import { SettingLinksPopover } from "./SettingLinksPopover";
import type { Resource, Setting } from "../types";

const IMAGE_EXT = /\.(jpe?g|png|gif|webp)$/i;

// Строка библиотеки «Ресурсы» → вкладка «Все». Отдельный компонент, а не
// режим ResourceCard: карточка (кампания, сеттинг) показывает ресурс как
// объект — с превью, заметками и аудиоплеером, а список библиотеки нужен
// для поиска глазами, и там всё держится на том, что колонки стоят на
// одной вертикали независимо от длины названия. Раньше это была одна
// flex-строка с flex-wrap, и колонка кнопок ехала за длиной имени.
interface Props {
  resource: Resource;
  onChange: () => void;
  onArchive: (id: number) => void;
  allSettings: Setting[];
}

function formatSize(bytes: number | null | undefined): string {
  if (bytes == null) return "—";
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} МБ`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} КБ`;
  return `${bytes} Б`;
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso.includes("T") ? iso : `${iso.replace(" ", "T")}`);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "2-digit" });
}

// Тегов в строке видно три: дальше они съедают колонку имени, ради которой
// строку и переделали. Остальные считаются в «+N».
const TAGS_SHOWN = 3;

export function ResourceRow({ resource, onChange, onArchive, allSettings }: Props) {
  const [editMode, setEditMode] = useState(false);
  const [name, setName] = useState(resource.name);
  const [linkUrl, setLinkUrl] = useState(resource.link_url ?? "");
  const [tags, setTags] = useState(resource.tags);
  const [notes, setNotes] = useState(resource.notes);

  async function save() {
    await api.put(`/resources/${resource.id}`, { name, link_url: linkUrl, tags, notes });
    syncMentionLinks("resource", resource.id, resource.notes, notes);
    setEditMode(false);
    onChange();
  }

  const href = resource.link_url || resource.file_url || null;
  // Расширение проверяется по пути, а не по всему URL: /files/... приходит
  // с ?v=…&token=… на хвосте, и якорь регулярки на конце строки не срабатывал
  // — картинки в списке показывались иконкой документа.
  const isImage = !!resource.file_url && IMAGE_EXT.test(resource.file_url.split(/[?#]/)[0]);
  const tagList = resource.tags
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);

  return (
    <div className={`res-row${editMode ? " is-editing" : ""}`}>
      <div className="res-row__line">
        <span className="res-row__mark" aria-hidden="true">
          {isImage ? (
            // Единственное место, где иконка типа не несёт информации: тип
            // назван в шапке подраздела. Обесцвечивание — тем же тумблером
            // дуотона, что и обложки (§3), правило в index.css: класс
            // .cover-art-image сюда не годится, он position:absolute.
            <img src={resource.file_url ?? ""} alt="" className="res-row__thumb" />
          ) : (
            <NavIcon name={resource.link_url ? "link" : "document"} />
          )}
        </span>

        {href ? (
          <a
            className="res-row__name"
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            title={resource.name}
          >
            {resource.name}
          </a>
        ) : (
          <span className="res-row__name res-row__name--plain" title={resource.name}>
            {resource.name}
          </span>
        )}

        {tagList.length > 0 && (
          <span className="res-row__tags">
            {tagList.slice(0, TAGS_SHOWN).map((t) => (
              <span key={t} className="res-row__tag">
                {t}
              </span>
            ))}
            {tagList.length > TAGS_SHOWN && (
              <span className="res-row__tag res-row__tag--more" title={tagList.join(", ")}>
                +{tagList.length - TAGS_SHOWN}
              </span>
            )}
          </span>
        )}

        <span className="res-row__meta">
          {formatSize(resource.size_bytes)} · {formatDate(resource.created_at)}
        </span>

        <span className="res-row__actions">
          <SettingLinksPopover
            compact
            ownerType="resource"
            ownerId={resource.id}
            homeSettingId={resource.setting_id}
            linkedSettingIds={resource.also_in_settings ?? []}
            allSettings={allSettings}
            onChange={onChange}
          />
          <button
            type="button"
            className="res-row__act"
            onClick={() => setEditMode((v) => !v)}
            title={editMode ? "Отмена" : "Редактировать"}
          >
            <NavIcon name={editMode ? "close" : "edit"} />
          </button>
          <button
            type="button"
            className="res-row__act"
            onClick={() => onArchive(resource.id)}
            title="Удалить"
          >
            <NavIcon name="delete" />
          </button>
        </span>
      </div>

      {editMode && (
        <div className="res-row__form stack">
          <label>
            Название
            <input value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label>
            Ссылка (вместо файла — например, папка на компьютере или сайт)
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
        </div>
      )}
    </div>
  );
}
