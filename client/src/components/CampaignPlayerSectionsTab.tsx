import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueries, useQueryClient } from "@tanstack/react-query";
import { resourceQuery, useAction, useResource, write } from "../data/hooks";
import { dataKeys } from "../data/entities";
import { campaignPaths, playerArticleAffects, playerSectionAffects } from "../data/campaigns";
import { galleryAffects, settingPaths } from "../data/settingEntities";
import { labelled } from "../data/notices";
import { GalleryTab } from "./GalleryTab";
import { PlayerVisibilityPicker } from "./PlayerVisibilityPicker";
import { MentionTextarea } from "./mentions/MentionTextarea";
import { MentionText } from "./mentions/MentionText";
import { syncMentionLinks } from "../mentions";
import { EmptyState } from "./EmptyState";
import { NavIcon } from "./NavIcons";
import { RowDeleteButton } from "./RowIconButtons";
import { useConfirm } from "../hooks/useConfirm";
import { IssuanceColumns } from "./IssuanceColumns";
import { Modal } from "./Modal";
import { isSafeImageUrl } from "../utils/safeUrl";
import type { CampaignPlayerArticle, CampaignPlayerSection, CampaignPlayerSectionKind, GalleryImage, RosterPlayer } from "../types";

const SECTION_NAME_MAX = 80;
const NO_SECTIONS: CampaignPlayerSection[] = [];
const NO_ARTICLES: CampaignPlayerArticle[] = [];

interface Props {
  campaignId: number;
  roster: RosterPlayer[];
  defaultSettingId?: number;
  showCreation?: boolean;
  onCreateSection?: () => void;
  onCreated?: () => void;
}

export function CampaignPlayerSectionsTab({ campaignId, roster, defaultSettingId, showCreation = true, onCreateSection, onCreated }: Props) {
  const client = useQueryClient();
  const run = useAction();
  const sectionsPath = campaignPaths.playerSections(campaignId);
  const sectionsState = useResource<CampaignPlayerSection[]>(sectionsPath);
  const allSections = sectionsState.data ?? NO_SECTIONS;
  const sections = useMemo(() => allSections.filter(section => !section.archived_at), [allSections]);
  const loading = sectionsState.loading;
  const [newName, setNewName] = useState("");
  const [newKind, setNewKind] = useState<CampaignPlayerSectionKind>("articles");
  // Ошибка здесь — только чтения или проверки названия; отказ записи — плашкой.
  const [validationError, setError] = useState<string | null>(null);
  const error = validationError ?? sectionsState.error;
  const [saving, setSaving] = useState(false);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const [filter, setFilter] = useState("");
  // Master–Detail: выбранный раздел и (для статей) статья. Пункты статей
  // в навигации — из кэша, который докладывает ArticlesList при загрузке.
  const [sel, setSel] = useState<{ sectionId: number | null; articleId?: number; imageId?: number }>({ sectionId: null });
  const [uploadGallery, setUploadGallery] = useState(false);
  const [artCache, setArtCache] = useState<Record<number, CampaignPlayerArticle[]>>({});

  function load() {
    setError(null);
    sectionsState.reload();
  }

  async function addSection() {
    const trimmed = newName.trim();
    if (!trimmed || saving) return;
    if (trimmed.length > SECTION_NAME_MAX) {
      setError(`Название не длиннее ${SECTION_NAME_MAX} символов`);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      // Без «Повторить»: ответ мог потеряться после записи, повтор создал бы второй.
      const created = await run(
        labelled("Новый подраздел", () =>
          write.post("/campaign-player-sections", { campaign_id: campaignId, name: trimmed, kind: newKind }).then(() => true)
        ),
        { affects: playerSectionAffects(campaignId), retry: false }
      );
      if (created) { setNewName(""); onCreated?.(); }
    } finally {
      setSaving(false);
    }
  }

  async function archiveFocusedImage(id: number, sectionId: number) {
    const saved = await run(labelled("Архивация изображения", () => write.put(`/gallery/${id}/archive`, { archived: true }).then(() => true)), { affects: [...galleryAffects("campaign_player_section", sectionId), ...playerSectionAffects(campaignId), { path: "/archive" }] });
    if (saved) setSel({ sectionId });
  }

  async function archiveSection(id: number, archived: boolean) {
    await run(labelled(archived ? "Архивация раздела" : "Восстановление раздела", () => write.put(`/campaign-player-sections/${id}/archive`, { archived })), { affects: [...playerSectionAffects(campaignId, id), { path: "/archive" }] });
  }

  async function reorderSections(draggedId: number, targetId: number) {
    if (draggedId === targetId) return;
    const ids = sections.map((s) => s.id);
    const from = ids.indexOf(draggedId);
    const to = ids.indexOf(targetId);
    if (from === -1 || to === -1) return;
    ids.splice(to, 0, ...ids.splice(from, 1));
    const order = new Map(ids.map((id, i) => [id, i]));
    const key = dataKeys.resource(sectionsPath);
    const previous = client.getQueryData<CampaignPlayerSection[]>(key);
    if (previous) client.setQueryData(key, [...previous].sort((a, b) => order.get(a.id)! - order.get(b.id)!));
    const moved = await run(labelled("Порядок подразделов", () => write.put("/campaign-player-sections/reorder", { order: ids })), {
      affects: playerSectionAffects(campaignId),
    });
    if (moved === undefined && previous) client.setQueryData(key, previous);
  }

  const filtered = filter.trim() ? sections.filter((s) => s.name.toLowerCase().includes(filter.trim().toLowerCase())) : sections;

  // Выбор пережил удаление/фильтр: нет выбранного — берём первый раздел.
  useEffect(() => {
    if (filtered.length === 0) {
      if (sel.sectionId !== null) setSel({ sectionId: null });
      return;
    }
    if (!filtered.some((s) => s.id === sel.sectionId)) setSel({ sectionId: filtered[0].id });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered, sel.sectionId]);

  // Счётчики галерей для навигации (статьи докладывает ArticlesList сам) —
  // под тем же ключом, что читает сама галерея подраздела.
  const galleries = useMemo(() => sections.filter((s) => s.kind === "gallery"), [sections]);
  const galleryQueries = useQueries({
    queries: galleries.map((g) => resourceQuery<GalleryImage[]>(settingPaths.gallery("campaign_player_section", g.id))),
  });
  const galCounts: Record<number, number> = {};
  galleries.forEach((g, i) => {
    const rows = galleryQueries[i]?.data;
    if (rows) galCounts[g.id] = rows.length;
  });

  const reportArticles = useCallback((sectionId: number, arts: CampaignPlayerArticle[]) => {
    setArtCache((prev) => {
      const old = prev[sectionId];
      if (old && old.length === arts.length && old.every((a, i) => a.id === arts[i].id && a.title === arts[i].title))
        return prev;
      return { ...prev, [sectionId]: arts };
    });
  }, []);

  function moveSection(id: number, dir: -1 | 1) {
    const ids = sections.map((s) => s.id);
    const from = ids.indexOf(id);
    const to = from + dir;
    if (from === -1 || to < 0 || to >= ids.length) return;
    reorderSections(id, ids[to]);
  }

  const navSections = filtered.map((s) => {
    const isGallery = s.kind === "gallery";
    const arts = artCache[s.id];
    return {
      id: String(s.id),
      label: s.name,
      count: isGallery ? galCounts[s.id] : arts?.length,
      items: !isGallery && arts ? arts.map((a) => ({ id: String(a.id), label: a.title || "Без названия" })) : undefined,
    };
  });

  const selectedSection = filtered.find((s) => s.id === sel.sectionId) ?? null;
  const focusedKnown = selectedSection && sel.articleId != null ? artCache[selectedSection.id] : undefined;
  const focusedFound = focusedKnown?.some((a) => a.id === sel.articleId) ?? null;

  return (
    <div className="stack campaign-player-overview">
      {sections.length > 1 && (
        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          <input placeholder="Поиск по подразделам" value={filter} onChange={(e) => setFilter(e.target.value)} style={{ flex: "1 1 200px" }} />
          {filter && <button onClick={() => setFilter("")}>Сбросить</button>}
        </div>
      )}
      {showCreation && <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
        <input ref={nameInputRef} placeholder="Название подраздела" value={newName} onChange={(e) => setNewName(e.target.value)} maxLength={SECTION_NAME_MAX} style={{ flex: "1 1 200px", minWidth: 0 }} />
        <select value={newKind} onChange={(e) => setNewKind(e.target.value as CampaignPlayerSectionKind)}>
          <option value="articles">Статьи</option>
          <option value="gallery">Галерея</option>
        </select>
        <button className="primary" onClick={addSection} disabled={!newName.trim() || newName.trim().length > SECTION_NAME_MAX || saving}>
          {saving ? "Создание…" : "+ Добавить подраздел"}
        </button>
      </div>}
      {newName.trim().length > SECTION_NAME_MAX && <span className="muted" style={{ fontSize: "var(--fs-meta)" }}>До {SECTION_NAME_MAX} символов</span>}
      {loading && <p className="muted">Загрузка…</p>}
      {error && (
        <div className="card" style={{ borderColor: "var(--danger, #c00)", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
          <span style={{ color: "var(--danger, #c00)", fontSize: "var(--fs-meta)" }}>{error}</span>
          <button onClick={() => load()}>Повторить</button>
        </div>
      )}
      {!loading && !error && sections.length === 0 && (
        <EmptyState
          title="Игрокам пока нечего открыть"
          hint="Создайте первый — статьи или галерею — и откройте игрокам глазом «Кому видно»."
          action={
            <button className="primary" onClick={() => { onCreateSection?.(); nameInputRef.current?.focus(); }}>
              Создать подраздел
            </button>
          }
        />
      )}
      {filtered.length > 0 && selectedSection && (
        <IssuanceColumns
          sections={navSections}
          selectedSection={String(selectedSection.id)}
          onSection={(id) => { setSel({ sectionId: Number(id) }); setUploadGallery(false); }}
          items={selectedSection.kind === "gallery"
            ? (galleryQueries[galleries.findIndex(g => g.id === selectedSection.id)]?.data ?? []).map((img, i) => ({ id: String(img.id), label: img.caption || `Изображение ${i + 1}` }))
            : (artCache[selectedSection.id] ?? []).map(a => ({ id: String(a.id), label: a.title || "Без названия" }))}
          selectedItem={sel.articleId != null ? String(sel.articleId) : sel.imageId != null ? String(sel.imageId) : undefined}
          onItem={(id) => setSel(selectedSection.kind === "gallery" ? { sectionId: selectedSection.id, imageId: Number(id) } : { sectionId: selectedSection.id, articleId: Number(id) })}
          title={selectedSection.name}
        >
          {(() => {
            if (sel.imageId != null) {
              const image = galleryQueries[galleries.findIndex(g => g.id === selectedSection.id)]?.data?.find(i => i.id === sel.imageId);
              return image ? <div className="stack">
                <div className="issuance-section__header issuance-image-header paper-group__head">
                  <h2>{image.caption || "Изображение"}</h2>
                  <span className="issuance-added">Добавлено {new Date(image.created_at).toLocaleDateString("ru-RU")}</span>
                  <div className="issuance-section__actions">
                    <PlayerVisibilityPicker campaignId={campaignId} targetType="campaign_player_image" targetId={image.id} roster={roster} />
                    <button type="button" className="row-icon row-icon--trash" title="Архивировать изображение" aria-label="Архивировать изображение" onClick={() => void archiveFocusedImage(image.id, selectedSection.id)} />
                  </div>
                </div>
                <GalleryTab ownerType="campaign_player_section" ownerId={selectedSection.id} focusedId={image.id} hideDelete />
              </div> : <p className="muted">Изображение удалено.</p>;
            }
            if (sel.articleId != null) {
              if (focusedKnown && !focusedFound) {
                return (
                  <div className="card stack">
                    <p className="muted">Статья удалена или перемещена.</p>
                    <button onClick={() => setSel({ sectionId: selectedSection.id })} style={{ alignSelf: "flex-start" }}>
                      К разделу
                    </button>
                  </div>
                );
              }
              return (
                <>
                  <ArticlesList
                    campaignId={campaignId}
                    sectionId={selectedSection.id}
                    roster={roster}
                    defaultSettingId={defaultSettingId}
                    focusedId={sel.articleId}
                    onStats={(arts) => reportArticles(selectedSection.id, arts)}
                  />
                </>
              );
            }
            if (selectedSection.kind === "gallery") {
              return <div className="stack">
                <SectionSummaryHeader key={selectedSection.id} campaignId={campaignId} section={selectedSection} roster={roster}
                  count={galCounts[selectedSection.id] ?? 0}
                  onArchive={() => void archiveSection(selectedSection.id, true)}
                  onMoveUp={sections.indexOf(selectedSection) > 0 ? () => moveSection(selectedSection.id, -1) : undefined}
                  onMoveDown={sections.indexOf(selectedSection) < sections.length - 1 ? () => moveSection(selectedSection.id, 1) : undefined} />
                <GallerySummary key={`gallery-${selectedSection.id}`} campaignId={campaignId} sectionId={selectedSection.id} roster={roster}
                  onPick={(imageId) => setSel({ sectionId: selectedSection.id, imageId })} />
                <div className="row"><button className="issuance-frame-button" onClick={() => setUploadGallery(true)}>+ Изображение</button></div>
                {uploadGallery && <Modal onClose={() => setUploadGallery(false)}><GalleryTab ownerType="campaign_player_section" ownerId={selectedSection.id} /></Modal>}
              </div>;
            }
            return (
              <div className="stack">
                <SectionSummaryHeader key={selectedSection.id} campaignId={campaignId} section={selectedSection} roster={roster}
                  count={selectedSection.kind === "articles" ? (artCache[selectedSection.id] ?? []).length : galCounts[selectedSection.id] ?? 0}
                  onArchive={() => void archiveSection(selectedSection.id, true)}
                  onMoveUp={sections.indexOf(selectedSection) > 0 ? () => moveSection(selectedSection.id, -1) : undefined}
                  onMoveDown={sections.indexOf(selectedSection) < sections.length - 1 ? () => moveSection(selectedSection.id, 1) : undefined} />
                <ArticlesList campaignId={campaignId} sectionId={selectedSection.id} roster={roster}
                  defaultSettingId={defaultSettingId}
                  onPick={(articleId) => setSel({ sectionId: selectedSection.id, articleId })}
                  onStats={(arts) => reportArticles(selectedSection.id, arts)} />
              </div>
            );
          })()}
        </IssuanceColumns>
      )}
      {filter && filtered.length === 0 && <p className="muted">Ничего не найдено.</p>}

    </div>
  );
}


function GallerySummary({ campaignId, sectionId, roster, onPick }: {
  campaignId: number; sectionId: number; roster: RosterPlayer[]; onPick: (id: number) => void;
}) {
  const run = useAction();
  const path = `${settingPaths.gallery("campaign_player_section", sectionId)}&include_archived=true`;
  const state = useResource<GalleryImage[]>(path);
  const allImages = state.data ?? [];
  const images = allImages.filter(image => !image.archived_at);
  const [editing, setEditing] = useState<GalleryImage | null>(null);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const affects = [...galleryAffects("campaign_player_section", sectionId), ...playerSectionAffects(campaignId), { path: "/archive" }];
  async function move(index: number, direction: -1 | 1) {
    const order = images.map(image => image.id);
    const target = index + direction;
    if (target < 0 || target >= order.length) return;
    [order[index], order[target]] = [order[target], order[index]];
    await run(labelled("Порядок изображений", () => write.put("/gallery/reorder", { order })), { affects });
  }
  async function archive(id: number, archived: boolean) {
    await run(labelled(archived ? "Архивация изображения" : "Восстановление изображения", () => write.put(`/gallery/${id}/archive`, { archived })), { affects });
  }
  async function saveName() {
    if (!editing || !draft.trim() || saving) return;
    setSaving(true);
    try {
      const saved = await run(labelled("Название изображения", () => write.put(`/gallery/${editing.id}`, { caption: draft.trim() }).then(() => true)), { affects });
      if (saved) setEditing(null);
    } finally { setSaving(false); }
  }
  return <div className="stack">
    {state.loading ? <p className="muted">Загрузка…</p> : state.error ? <p role="alert">Не удалось загрузить изображения. <button onClick={state.reload}>Повторить</button></p> : images.map((image, index) => {
      const title = image.caption || `Изображение ${index + 1}`;
      return <div className="issuance-image-row" key={image.id}>
        <button className="issuance-image-thumb" aria-label={`Открыть изображение — ${title}`} onClick={() => onPick(image.id)}><img src={isSafeImageUrl(image.image_url) ? image.image_url : undefined} alt="" loading="lazy" /></button>
        <div className="issuance-image-info"><button className="issuance-article-title" onClick={() => onPick(image.id)}>{title}</button><span className="issuance-added">Добавлено {new Date(image.created_at).toLocaleDateString("ru-RU")}</span></div>
        <div className="issuance-section__actions">
          <div className="issuance-section__moves">
            <button type="button" className="row-icon" aria-label={`Переместить выше — ${title}`} title="Вверх" disabled={index === 0} onClick={() => void move(index, -1)}>↑</button>
            <button type="button" className="row-icon" aria-label={`Переместить ниже — ${title}`} title="Вниз" disabled={index === images.length - 1} onClick={() => void move(index, 1)}>↓</button>
          </div>
          <PlayerVisibilityPicker campaignId={campaignId} targetType="campaign_player_image" targetId={image.id} roster={roster} />
          <button className="row-icon row-icon--edit" title="Редактировать название" aria-label={`Редактировать название — ${title}`} onClick={() => { setEditing(image); setDraft(image.caption); }} />
          <button className="row-icon row-icon--trash" title="Архивировать изображение" aria-label={`Архивировать изображение — ${title}`} onClick={() => void archive(image.id, true)} />
        </div>
      </div>;
    })}
    {editing && <Modal onClose={() => setEditing(null)} ariaLabel="Название изображения"><form className="stack" onSubmit={(event) => { event.preventDefault(); void saveName(); }}><h2>Название изображения</h2><input autoFocus aria-label="Название изображения" maxLength={500} value={draft} onChange={(event) => setDraft(event.target.value)} /><div className="row"><button type="submit" disabled={saving || !draft.trim()}>Сохранить</button><button type="button" onClick={() => setEditing(null)}>Отмена</button></div></form></Modal>}
  </div>;
}


function SectionSummaryHeader({ campaignId, section, roster, count, onMoveUp, onMoveDown, onArchive }: {
  campaignId: number; section: CampaignPlayerSection; roster: RosterPlayer[]; count: number;
  onMoveUp?: () => void; onMoveDown?: () => void; onArchive: () => void;
}) {
  const run = useAction();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(section.name);
  const [saving, setSaving] = useState(false);
  async function saveName() {
    if (!draft.trim() || saving) return;
    setSaving(true);
    try {
      const saved = await run(labelled("Название подраздела", () => write.put(`/campaign-player-sections/${section.id}`, { name: draft.trim() }).then(() => true)), { affects: playerSectionAffects(campaignId, section.id) });
      if (saved) setEditing(false);
    } finally { setSaving(false); }
  }
  return <div className="issuance-section__header paper-group__head">
    <h2>{section.name}<span className="issuance-section__count" aria-label={`${section.kind === "articles" ? "Статей" : "Изображений"}: ${count}`}>{count}</span></h2>
    <div className="issuance-section__actions">
      <div className="issuance-section__moves">
        <button type="button" className="row-icon" title="Вверх" aria-label="Переместить выше" disabled={!onMoveUp} onClick={onMoveUp}>↑</button>
        <button type="button" className="row-icon" title="Вниз" aria-label="Переместить ниже" disabled={!onMoveDown} onClick={onMoveDown}>↓</button>
      </div>
      <PlayerVisibilityPicker campaignId={campaignId} targetType="campaign_player_section" targetId={section.id} roster={roster} />
      <button type="button" className="row-icon row-icon--edit" title="Редактировать название" aria-label="Редактировать название" onClick={() => { setDraft(section.name); setEditing(true); }} />
      <button type="button" className="row-icon row-icon--trash" title="Архивировать раздел" aria-label="Архивировать раздел" onClick={onArchive} />
    </div>
    {editing && <Modal onClose={() => setEditing(false)}>
      <form className="stack" onSubmit={(event) => { event.preventDefault(); void saveName(); }}>
        <h2>Название раздела</h2>
        <input aria-label="Название раздела" autoFocus maxLength={SECTION_NAME_MAX} value={draft} onChange={(event) => setDraft(event.target.value)} />
        <div className="row"><button type="submit" disabled={saving || !draft.trim()}>Сохранить</button><button type="button" onClick={() => setEditing(false)}>Отмена</button></div>
      </form>
    </Modal>}
  </div>;
}

function ArticlesList({
  campaignId,
  sectionId,
  roster,
  defaultSettingId,
  focusedId,
  onStats,
  onPick,
}: {
  campaignId: number;
  sectionId: number;
  roster: RosterPlayer[];
  defaultSettingId?: number;
  /** Master–Detail: показать только одну статью (навигация — снаружи). */
  focusedId?: number | null;
  /** Статьи для пунктов навигации (id + заголовки). */
  onStats?: (articles: CampaignPlayerArticle[]) => void;
  onPick?: (articleId: number) => void;
}) {
  const client = useQueryClient();
  const run = useAction();
  const articlesPath = campaignPaths.sectionArticles(sectionId);
  const articlesState = useResource<CampaignPlayerArticle[]>(articlesPath);
  const allArticles = articlesState.data ?? NO_ARTICLES;
  const articles = useMemo(() => allArticles.filter(article => !article.archived_at), [allArticles]);
  const [renaming, setRenaming] = useState<CampaignPlayerArticle | null>(null);
  const [titleDraft, setTitleDraft] = useState("");
  const [savingTitle, setSavingTitle] = useState(false);
  const loading = articlesState.loading;
  const error = articlesState.error;
  const [saving, setSaving] = useState(false);
  const [dragId, setDragId] = useState<number | null>(null);

  function load() {
    articlesState.reload();
  }

  // Статьи для пунктов навигации Master–Detail.
  useEffect(() => {
    onStats?.(articles);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [articles]);

  async function addArticle() {
    if (saving) return;
    setSaving(true);
    try {
      const created = await run(
        labelled("Новая статья", () =>
          write.post<CampaignPlayerArticle>(`/campaign-player-sections/${sectionId}/articles`, { title: `Статья ${articles.length + 1}`, content: "" })
        ),
        { affects: playerArticleAffects(sectionId), retry: false }
      );
      if (created) onPick?.(created.id);
    } finally {
      setSaving(false);
    }
  }

  async function archiveArticle(id: number, archived: boolean) {
    await run(labelled(archived ? "Архивация статьи" : "Восстановление статьи", () => write.put(`/campaign-player-sections/articles/${id}/archive`, { archived })), { affects: [...playerArticleAffects(sectionId), { path: "/archive" }] });
  }

  async function saveTitle() {
    if (!renaming || !titleDraft.trim() || savingTitle) return;
    setSavingTitle(true);
    try {
      const saved = await run(labelled("Название статьи", () => write.put(`/campaign-player-sections/articles/${renaming.id}`, { title: titleDraft.trim() }).then(() => true)), { affects: [...playerArticleAffects(sectionId), { path: "/archive" }] });
      if (saved) setRenaming(null);
    } finally { setSavingTitle(false); }
  }

  async function removeArticle(id: number) {
    await archiveArticle(id, true);
  }

  async function reorderArticles(draggedId: number, targetId: number) {
    if (draggedId === targetId) return;
    const ids = articles.map((a) => a.id);
    const from = ids.indexOf(draggedId);
    const to = ids.indexOf(targetId);
    if (from === -1 || to === -1) return;
    ids.splice(to, 0, ...ids.splice(from, 1));
    const order = new Map(ids.map((id, i) => [id, i]));
    const key = dataKeys.resource(articlesPath);
    const previous = client.getQueryData<CampaignPlayerArticle[]>(key);
    if (previous) client.setQueryData(key, [...previous].sort((a, b) => order.get(a.id)! - order.get(b.id)!));
    const moved = await run(labelled("Порядок статей", () => write.put("/campaign-player-sections/articles/reorder", { order: ids })), {
      affects: playerArticleAffects(sectionId),
    });
    if (moved === undefined && previous) client.setQueryData(key, previous);
  }

  const visible = focusedId != null ? articles.filter((a) => a.id === focusedId) : articles;

  return (
    <div className="stack">
      {loading && <p className="muted">Загрузка статей…</p>}
      {error && (
        <div className="card" style={{ borderColor: "var(--danger, #c00)", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
          <span style={{ color: "var(--danger, #c00)", fontSize: "var(--fs-meta)" }}>{error}</span>
          <button onClick={() => load()}>Повторить</button>
        </div>
      )}
      {!loading && !error && articles.length === 0 && (
        <EmptyState
          title="Чистый лист"
          hint="Добавьте первую статью — она откроется сразу в режиме редактирования."
          action={
            <button className="issuance-frame-button" onClick={addArticle} disabled={saving}>
              + Статья
            </button>
          }
        />
      )}
      {visible.map((a, index) => (
        <div
          key={a.id}
          className={onPick ? "issuance-article-row" : undefined}
          draggable={focusedId == null}
          onDragStart={() => focusedId == null && setDragId(a.id)}
          onDragEnd={() => setDragId(null)}
          onDragOver={(e) => e.preventDefault()}
          onDrop={() => {
            if (focusedId == null && dragId != null) {
              reorderArticles(dragId, a.id);
              setDragId(null);
            }
          }}
          style={{ opacity: dragId === a.id ? 0.6 : 1 }}
        >
          {onPick ? (
            <div className="row" style={{ justifyContent: "space-between" }}>
              <div><button className="issuance-article-title" onClick={() => onPick(a.id)}>{a.title || "Без названия"}</button><span className="issuance-added">Добавлено {new Date(a.created_at).toLocaleDateString("ru-RU")}</span></div>
              <div className="issuance-section__actions">
                <div className="issuance-section__moves">
                  <button type="button" className="row-icon" title="Вверх" aria-label={`Переместить выше — ${a.title}`} disabled={index === 0} onClick={() => void reorderArticles(a.id, articles[index - 1].id)}>↑</button>
                  <button type="button" className="row-icon" title="Вниз" aria-label={`Переместить ниже — ${a.title}`} disabled={index === articles.length - 1} onClick={() => void reorderArticles(a.id, articles[index + 1].id)}>↓</button>
                </div>
                <PlayerVisibilityPicker campaignId={campaignId} targetType="campaign_player_article" targetId={a.id} roster={roster} />
                <button type="button" className="row-icon row-icon--edit" title="Редактировать название" aria-label={`Редактировать название — ${a.title}`} onClick={() => { setTitleDraft(a.title); setRenaming(a); }} />
                <button type="button" className="row-icon row-icon--trash" title="Архивировать статью" aria-label={`Архивировать статью — ${a.title}`} onClick={() => void archiveArticle(a.id, true)} />
              </div>
            </div>
          ) : <ArticleCard
            campaignId={campaignId}
            sectionId={sectionId}
            article={a}
            roster={roster}
            defaultSettingId={defaultSettingId}
            forceOpen={focusedId != null}
            onRemove={() => removeArticle(a.id)}
          />}
        </div>
      ))}
      {!loading && !error && articles.length > 0 && focusedId == null && (
        <button className="issuance-frame-button" onClick={addArticle} style={{ alignSelf: "flex-start" }} disabled={saving}>
          {saving ? "Создание…" : "+ Статья"}
        </button>
      )}
      {renaming && <Modal onClose={() => setRenaming(null)} ariaLabel="Название статьи">
        <form className="stack" onSubmit={(event) => { event.preventDefault(); void saveTitle(); }}>
          <h2>Название статьи</h2>
          <input aria-label="Название статьи" autoFocus maxLength={SECTION_NAME_MAX} value={titleDraft} onChange={(event) => setTitleDraft(event.target.value)} />
          <div className="row"><button type="submit" disabled={savingTitle || !titleDraft.trim()}>Сохранить</button><button type="button" onClick={() => setRenaming(null)}>Отмена</button></div>
        </form>
      </Modal>}
    </div>
  );
}

function ArticleCard({
  campaignId,
  sectionId,
  article,
  roster,
  defaultSettingId,
  onRemove,
  forceOpen = false,
}: {
  campaignId: number;
  sectionId: number;
  article: CampaignPlayerArticle;
  roster: RosterPlayer[];
  defaultSettingId?: number;
  onRemove: () => void;
  /** Внутри Master–Detail карточка всегда раскрыта, сворачивать нечего. */
  forceOpen?: boolean;
}) {
  const [editMode, setEditMode] = useState(() => !article.content);
  const [expanded, setExpanded] = useState(false);
  const [title, setTitle] = useState(article.title);
  const [content, setContent] = useState(article.content);
  const [saving, setSaving] = useState(false);
  const [confirmDialog, confirm] = useConfirm();
  const [clampOpen, setClampOpen] = useState(false);
  const open = editMode || expanded || forceOpen;
  const isDirty = title !== article.title || content !== article.content;

  const run = useAction();
  async function save() {
    if (saving) return;
    setSaving(true);
    try {
      // Правка закрывается только после записи: при отказе набранное остаётся.
      const saved = await run(
        labelled("Статья", () => write.put(`/campaign-player-sections/articles/${article.id}`, { title, content }).then(() => true)),
        { affects: playerArticleAffects(sectionId) }
      );
      if (!saved) return;
      void syncMentionLinks("campaign_player_article", article.id, article.content, content);
      setEditMode(false);
    } finally {
      setSaving(false);
    }
  }

  async function handleCancel() {
    if (isDirty) {
      const ok = await confirm({ title: "Отменить изменения?", message: "Несохранённые правки будут потеряны.", confirmLabel: "Отменить", danger: false });
      if (!ok) return;
    }
    setTitle(article.title);
    setContent(article.content);
    setEditMode(false);
  }

  return (
    <div className="card stack">
      <div
        className="row collapsible-header campaign-player-header"
        style={{ justifyContent: "space-between", cursor: editMode || forceOpen ? "default" : "pointer" }}
        onClick={() => !editMode && !forceOpen && setExpanded((v) => !v)}
      >
        <span className="row" style={{ alignItems: "center" }}>
          {!editMode && !forceOpen && <NavIcon name="chevron" className={`chevron-icon${expanded ? " is-open" : ""}`} />}
          {editMode ? (
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Заголовок"
              maxLength={SECTION_NAME_MAX}
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <strong className="entry-title">{article.title}</strong>
          )}
        </span>
        <span className="issuance-section__actions" onClick={(e) => e.stopPropagation()}>
          <PlayerVisibilityPicker campaignId={campaignId} targetType="campaign_player_article" targetId={article.id} roster={roster} />
          <RowDeleteButton onClick={onRemove} label="Архивировать статью" />
        </span>
      </div>
      {open &&
        (editMode ? (
          <div
            onKeyDown={(e) => {
              if ((e.ctrlKey || e.metaKey) && e.key === "s") {
                e.preventDefault();
                save();
              }
            }}
          >
            <MentionTextarea value={content} onChange={setContent} rows={4} defaultSettingId={defaultSettingId} />
            <div className="row" style={{ marginTop: 8 }}>
              <button className="primary" onClick={save} disabled={saving}>
                {saving ? "Сохранение…" : "Сохранить"}
              </button>
              <button onClick={handleCancel} disabled={saving}>Отмена</button>
            </div>
          </div>
        ) : (
          <>
            <div className={`reading-text ${clampOpen ? "" : "editable-clamp"}`} style={{ whiteSpace: "pre-wrap" }}>
              <MentionText text={article.content} />
            </div>
            {article.content.split("\n").length > 8 || article.content.length > 600 ? (
              <button className="editable-clamp-toggle" onClick={() => setClampOpen((v) => !v)}>
                {clampOpen ? "Свернуть" : "Показать полностью"}
              </button>
            ) : null}
            <button onClick={() => setEditMode(true)} style={{ alignSelf: "flex-start" }}>
              Редактировать
            </button>
          </>
        ))}
      {confirmDialog}
    </div>
  );
}
