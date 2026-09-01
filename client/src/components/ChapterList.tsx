import { useMemo, useState, type MouseEvent, type ReactNode } from "react";
import { api } from "../api/client";
import { IMAGE_ACCEPT, IMAGE_HINT } from "../imageUpload";
import { useImageCrop } from "../hooks/useImageCrop";
import { MentionTextarea } from "./mentions/MentionTextarea";
import { MentionText } from "./mentions/MentionText";
import { syncMentionLinks } from "../mentions";
import { NavIcon } from "./NavIcons";

interface ChapterLike {
  id: number;
  title: string;
  content: string;
  image_url?: string | null;
  // Present only for chapters created with a `campaigns` list passed in (see
  // below) — e.g. a being's Текущая ситуация articles.
  campaign_id?: number | null;
  campaign_name?: string | null;
  important?: boolean | number;
  visible_to_players?: boolean | number;
}

interface Props<T extends ChapterLike> {
  ownerId: number;
  ownerType: string;
  apiBase: string; // e.g. "/characters" or "/setting-locations"
  section?: string; // sent when creating a chapter, for owners that distinguish sections
  chapters: T[];
  onChange: () => void;
  allowImage?: boolean;
  titlePrefix?: string; // default new-chapter title, e.g. "Глава" or "Статья"
  addLabel?: string; // label on the add button, e.g. "главу" or "статью"
  defaultSettingId?: number; // forwarded to MentionTextarea, see its own doc comment
  // When provided, each chapter can be tagged to one of these campaigns and
  // marked "important" — enables a campaign picker + importance checkbox in
  // edit mode, a campaign/important badge in view mode, and a "sort by
  // campaign" control above the list. Omit for owners that don't need this
  // (character/location/community chapters).
  campaigns?: { id: number; name: string }[];
  // Shows a "видно игрокам" toggle in each chapter's summary row — the GM's
  // explicit reveal flag for the remote/hosted deployment's player sync API
  // (routes/player.ts). Only meaningful for location/being chapters, the
  // narrow set of content that gets this treatment for now.
  visibilityToggle?: boolean;
  // Custom content shown when the chapter list is empty. When omitted, the
  // default "Пока пусто" muted text is used. Pass an <EmptyState> for
  // main-screen sections per §11a/11b.
  emptyState?: ReactNode;
  // Optional title rendered as <h3> above the chapter list. Provides a
  // consistent card-header pattern with EntityFieldsCard and AliasesCard.
  listTitle?: string;
}

export function ChapterList<T extends ChapterLike>({
  ownerId,
  ownerType,
  apiBase,
  section,
  chapters,
  onChange,
  allowImage,
  titlePrefix = "Глава",
  addLabel,
  defaultSettingId,
  campaigns,
  visibilityToggle,
  emptyState,
  listTitle,
}: Props<T>) {
  const label = addLabel ?? (allowImage ? "предмет" : "главу");
  const [sortCampaignId, setSortCampaignId] = useState<number | "">("");

  const displayedChapters = useMemo(() => {
    if (!campaigns || sortCampaignId === "") return chapters;
    // Stable partition: chapters tagged with the picked campaign float to
    // the top, everything else keeps its original relative order below.
    return [...chapters].sort((a, b) => {
      const aMatch = a.campaign_id === sortCampaignId ? 0 : 1;
      const bMatch = b.campaign_id === sortCampaignId ? 0 : 1;
      return aMatch - bMatch;
    });
  }, [chapters, campaigns, sortCampaignId]);

  async function addChapter() {
    await api.post(`${apiBase}/${ownerId}/chapters`, {
      ...(section ? { section } : {}),
      title: `${titlePrefix} ${chapters.length + 1}`,
      content: "",
    });
    onChange();
  }

  async function removeChapter(id: number) {
    if (!confirm("Вы уверены, что хотите удалить ЭТО?")) return;
    await api.del(`${apiBase}/chapters/${id}`);
    onChange();
  }

  return (
    <div className="stack">
      {listTitle && (
        <h3>
          {listTitle}
          {chapters.length > 0 && (
            <span className="muted" style={{ fontWeight: 400, fontSize: "var(--fs-meta)", marginLeft: 6 }}>
              {chapters.length}
            </span>
          )}
        </h3>
      )}
      {campaigns && chapters.length > 0 && (
        <label className="row" style={{ alignItems: "center", gap: 6 }}>
          <span className="muted">Сортировать по кампании</span>
          <select
            value={sortCampaignId}
            onChange={(e) => setSortCampaignId(e.target.value ? Number(e.target.value) : "")}
          >
            <option value="">Без сортировки</option>
            {campaigns.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {displayedChapters.map((ch) => (
        <ChapterCard
          key={ch.id}
          chapter={ch}
          ownerType={ownerType}
          ownerId={ownerId}
          apiBase={apiBase}
          onChange={onChange}
          onRemove={removeChapter}
          allowImage={allowImage}
          defaultSettingId={defaultSettingId}
          campaigns={campaigns}
          visibilityToggle={visibilityToggle}
        />
      ))}
      <button onClick={addChapter} style={{ alignSelf: "flex-start" }}>
        + Добавить {label}
      </button>
      {chapters.length === 0 && (emptyState ?? <p className="muted">Пока пусто.</p>)}
    </div>
  );
}

function ChapterCard<T extends ChapterLike>({
  chapter,
  ownerType,
  ownerId,
  apiBase,
  onChange,
  onRemove,
  allowImage,
  defaultSettingId,
  campaigns,
  visibilityToggle,
}: {
  chapter: T;
  ownerType: string;
  ownerId: number;
  apiBase: string;
  onChange: () => void;
  onRemove: (id: number) => void;
  allowImage?: boolean;
  defaultSettingId?: number;
  campaigns?: { id: number; name: string }[];
  visibilityToggle?: boolean;
}) {
  const [editMode, setEditMode] = useState(() => !chapter.content);
  const [title, setTitle] = useState(chapter.title);
  const [content, setContent] = useState(chapter.content);
  const [campaignId, setCampaignId] = useState<number | "">(chapter.campaign_id ?? "");
  const [important, setImportant] = useState(!!chapter.important);
  const [uploading, setUploading] = useState(false);

  async function toggleVisibleToPlayers(e: MouseEvent) {
    e.preventDefault();
    await api.put(`${apiBase}/chapters/${chapter.id}`, { visible_to_players: !chapter.visible_to_players });
    onChange();
  }

  async function save() {
    await api.put(`${apiBase}/chapters/${chapter.id}`, {
      title,
      content,
      ...(campaigns ? { campaign_id: campaignId || null, important } : {}),
    });
    syncMentionLinks(ownerType, ownerId, chapter.content, content);
    setEditMode(false);
    onChange();
  }

  async function handleImageChange(file: File | null) {
    if (!file) return;
    setUploading(true);
    const form = new FormData();
    form.append("file", file);
    await api.post(`${apiBase}/chapters/${chapter.id}/image`, form);
    setUploading(false);
    onChange();
  }
  const imageCrop = useImageCrop("square", handleImageChange);

  return (
    <details className="card" open={editMode}>
      <summary className="chevron-summary">
        <NavIcon name="chevron" className="chevron-icon" />
        {!!chapter.important && (
          <span title="Важно">
            <NavIcon name="star" />{" "}
          </span>
        )}
        <strong className="entry-title">{chapter.title || "Без названия"}</strong>
        {chapter.campaign_name && <span className="badge tag">{chapter.campaign_name}</span>}
        {visibilityToggle && (
          <button
            className={`visibility-toggle${chapter.visible_to_players ? " is-visible" : ""}`}
            title={chapter.visible_to_players ? "Видно игрокам — нажмите, чтобы скрыть" : "Скрыто от игроков — нажмите, чтобы открыть"}
            onClick={toggleVisibleToPlayers}
          >
            <NavIcon name="eye" /> {chapter.visible_to_players ? "Видно игрокам" : "Скрыто"}
          </button>
        )}
        <button
          className="danger"
          style={{ float: "right" }}
          title="Удалить"
          onClick={(e) => {
            e.preventDefault();
            onRemove(chapter.id);
          }}
        >
          <NavIcon name="delete" />
        </button>
      </summary>
      <div className="row" style={{ alignItems: "flex-start" }}>
        {allowImage && (
          <div className="stack" style={{ alignItems: "center" }}>
            {chapter.image_url ? (
              <img src={chapter.image_url} alt="" className="chapter-image" />
            ) : (
              <div className="chapter-image chapter-image-placeholder">Нет фото</div>
            )}
            <label className="character-avatar-upload" title={IMAGE_HINT}>
              {uploading ? "Загрузка…" : "Фото"}
              <input
                type="file"
                accept={IMAGE_ACCEPT}
                style={{ display: "none" }}
                onChange={(e) => imageCrop.onSelect(e.target.files?.[0] ?? null)}
              />
            </label>
            <span className="muted image-hint">{IMAGE_HINT}</span>
            {imageCrop.modal}
          </div>
        )}
        <div className="stack" style={{ flex: 1 }}>
          {editMode ? (
            <>
              <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Название" />
              {campaigns && (
                <div className="row" style={{ alignItems: "center" }}>
                  <label>
                    Кампания
                    <select
                      value={campaignId}
                      onChange={(e) => setCampaignId(e.target.value ? Number(e.target.value) : "")}
                    >
                      <option value="">— без кампании —</option>
                      {campaigns.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="row" style={{ alignItems: "center", gap: 4 }}>
                    <input type="checkbox" checked={important} onChange={(e) => setImportant(e.target.checked)} />
                    Важно
                  </label>
                </div>
              )}
              <MentionTextarea value={content} onChange={setContent} rows={8} defaultSettingId={defaultSettingId} />
              <div className="row">
                <button className="primary" onClick={save}>
                  Сохранить
                </button>
                <button onClick={() => setEditMode(false)}>Отмена</button>
              </div>
            </>
          ) : (
            <>
              <div style={{ whiteSpace: "pre-wrap" }}>
                <MentionText text={chapter.content} />
              </div>
              <button onClick={() => setEditMode(true)} style={{ alignSelf: "flex-start" }}>
                Редактировать
              </button>
            </>
          )}
        </div>
      </div>
    </details>
  );
}
