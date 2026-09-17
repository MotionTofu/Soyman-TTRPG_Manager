import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueries, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import { useAction, useResource, write } from "../data/hooks";
import { dataKeys } from "../data/entities";
import { campaignPaths, playerArticleAffects, playerSectionAffects } from "../data/campaigns";
import { settingPaths } from "../data/settingEntities";
import { labelled } from "../data/notices";
import { GalleryTab } from "./GalleryTab";
import { PlayerVisibilityPicker } from "./PlayerVisibilityPicker";
import { MentionTextarea } from "./mentions/MentionTextarea";
import { MentionText } from "./mentions/MentionText";
import { syncMentionLinks } from "../mentions";
import { EmptyState } from "./EmptyState";
import { NavIcon } from "./NavIcons";
import { useConfirm } from "../hooks/useConfirm";
import { EntityTabWorkspace } from "./EntityTabWorkspace";
import type { CampaignPlayerArticle, CampaignPlayerSection, CampaignPlayerSectionKind, RosterPlayer } from "../types";

const SECTION_NAME_MAX = 80;
const NO_SECTIONS: CampaignPlayerSection[] = [];
const NO_ARTICLES: CampaignPlayerArticle[] = [];

interface Props {
  campaignId: number;
  roster: RosterPlayer[];
  defaultSettingId?: number;
}

export function CampaignPlayerSectionsTab({ campaignId, roster, defaultSettingId }: Props) {
  const client = useQueryClient();
  const run = useAction();
  const sectionsPath = campaignPaths.playerSections(campaignId);
  const sectionsState = useResource<CampaignPlayerSection[]>(sectionsPath);
  const sections = sectionsState.data ?? NO_SECTIONS;
  const loading = sectionsState.loading;
  const [newName, setNewName] = useState("");
  const [newKind, setNewKind] = useState<CampaignPlayerSectionKind>("articles");
  // Ошибка здесь — только чтения или проверки названия; отказ записи — плашкой.
  const [validationError, setError] = useState<string | null>(null);
  const error = validationError ?? sectionsState.error;
  const [saving, setSaving] = useState(false);
  const [confirmDialog, confirm] = useConfirm();
  const nameInputRef = useRef<HTMLInputElement>(null);
  const [filter, setFilter] = useState("");
  // Master–Detail: выбранный раздел и (для статей) статья. Пункты статей
  // в навигации — из кэша, который докладывает ArticlesList при загрузке.
  const [sel, setSel] = useState<{ sectionId: number | null; articleId?: number }>({ sectionId: null });
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
      if (created) setNewName("");
    } finally {
      setSaving(false);
    }
  }

  async function removeSection(id: number) {
    const ok = await confirm({
      title: "Удалить подраздел?",
      message: "Все статьи и изображения внутри будут удалены безвозвратно.",
      confirmLabel: "Удалить",
      danger: true,
    });
    if (!ok) return;
    // Статьи удалённого подраздела не перечитываются: их карточка уже уходит с экрана.
    await run(labelled("Удаление подраздела", () => write.del(`/campaign-player-sections/${id}`)), {
      affects: playerSectionAffects(campaignId),
    });
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
    queries: galleries.map((g) => {
      const path = settingPaths.gallery("campaign_player_section", g.id);
      return {
        queryKey: dataKeys.resource(path),
        queryFn: ({ signal }: { signal: AbortSignal }) => api.get<unknown[]>(path, { signal }),
      };
    }),
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
      label: `${s.name} · ${isGallery ? "Галерея" : "Статьи"}`,
      count: isGallery ? galCounts[s.id] : arts?.length,
      items: !isGallery && arts ? arts.map((a) => ({ id: String(a.id), label: a.title || "Без названия" })) : undefined,
    };
  });

  const selectedSection = filtered.find((s) => s.id === sel.sectionId) ?? null;
  const focusedKnown = selectedSection && sel.articleId != null ? artCache[selectedSection.id] : undefined;
  const focusedFound = focusedKnown?.some((a) => a.id === sel.articleId) ?? null;

  return (
    <div className="stack campaign-player-overview">
      <p className="muted" style={{ maxWidth: "62ch" }}>
        Подразделы этого раздела не видны игрокам, пока вы явно не откроете их (или отдельные
        статьи внутри) конкретным игрокам кнопкой-глазом.
      </p>
      {sections.length > 1 && (
        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          <input placeholder="Поиск по подразделам" value={filter} onChange={(e) => setFilter(e.target.value)} style={{ flex: "1 1 200px" }} />
          {filter && <button onClick={() => setFilter("")}>Сбросить</button>}
        </div>
      )}
      <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
        <input ref={nameInputRef} placeholder="Название подраздела" value={newName} onChange={(e) => setNewName(e.target.value)} maxLength={SECTION_NAME_MAX} style={{ flex: "1 1 200px", minWidth: 0 }} />
        <select value={newKind} onChange={(e) => setNewKind(e.target.value as CampaignPlayerSectionKind)}>
          <option value="articles">Статьи</option>
          <option value="gallery">Галерея</option>
        </select>
        <button className="primary" onClick={addSection} disabled={!newName.trim() || newName.trim().length > SECTION_NAME_MAX || saving}>
          {saving ? "Создание…" : "+ Добавить подраздел"}
        </button>
      </div>
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
            <button className="primary" onClick={() => nameInputRef.current?.focus()}>
              Создать подраздел
            </button>
          }
        />
      )}
      {filtered.length > 0 && selectedSection && (
        <EntityTabWorkspace
          sections={navSections}
          selection={{
            section: String(selectedSection.id),
            item: sel.articleId != null ? String(sel.articleId) : undefined,
          }}
          onSelect={(next) =>
            setSel(
              next.item != null
                ? { sectionId: Number(next.section), articleId: Number(next.item) }
                : { sectionId: Number(next.section) }
            )
          }
          workspaceKey={campaignId}
          navFooter={
            <button
              className="primary"
              onClick={() => nameInputRef.current?.focus()}
              style={{ alignSelf: "flex-start" }}
            >
              + Добавить подраздел
            </button>
          }
        >
          {(() => {
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
                <ArticlesList
                  campaignId={campaignId}
                  sectionId={selectedSection.id}
                  roster={roster}
                  defaultSettingId={defaultSettingId}
                  focusedId={sel.articleId}
                  onStats={(arts) => reportArticles(selectedSection.id, arts)}
                />
              );
            }
            const idx = sections.findIndex((s) => s.id === selectedSection.id);
            return (
              <SectionCard
                campaignId={campaignId}
                section={selectedSection}
                roster={roster}
                defaultSettingId={defaultSettingId}
                forceExpanded
                onMoveUp={idx > 0 ? () => moveSection(selectedSection.id, -1) : undefined}
                onMoveDown={idx >= 0 && idx < sections.length - 1 ? () => moveSection(selectedSection.id, 1) : undefined}
                onRemove={() => removeSection(selectedSection.id)}
                onArticlesStats={(arts) => reportArticles(selectedSection.id, arts)}
              />
            );
          })()}
        </EntityTabWorkspace>
      )}
      {filter && filtered.length === 0 && <p className="muted">Ничего не найдено.</p>}
      {confirmDialog}
    </div>
  );
}

function SectionCard({
  campaignId,
  section,
  roster,
  defaultSettingId,
  onRemove,
  forceExpanded = false,
  onMoveUp,
  onMoveDown,
  onArticlesStats,
}: {
  campaignId: number;
  section: CampaignPlayerSection;
  roster: RosterPlayer[];
  defaultSettingId?: number;
  onRemove: () => void;
  /** Внутри Master–Detail карточка всегда раскрыта, сворачивать нечего. */
  forceExpanded?: boolean;
  /** Порядок разделов — стрелками вместо drag (в навигации drag нет). */
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  onArticlesStats?: (articles: CampaignPlayerArticle[]) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState(section.name);
  const [savingName, setSavingName] = useState(false);
  const run = useAction();
  // Число изображений или статей — те же ключи, что у галереи и списка статей.
  const isGallery = section.kind === "gallery";
  const galleryRows = useResource<unknown[]>(isGallery ? settingPaths.gallery("campaign_player_section", section.id) : null).data;
  const articleRows = useResource<unknown[]>(isGallery ? null : campaignPaths.sectionArticles(section.id)).data;
  const countLabel = isGallery
    ? galleryRows ? `${galleryRows.length} изо` : null
    : articleRows ? `${articleRows.length} ст` : null;

  async function saveName() {
    const trimmed = nameDraft.trim();
    if (!trimmed || trimmed.length > SECTION_NAME_MAX) return;
    setSavingName(true);
    try {
      // Поле закрывается только после записи: при отказе набранное остаётся.
      const saved = await run(
        labelled("Название подраздела", () => write.put(`/campaign-player-sections/${section.id}`, { name: trimmed }).then(() => true)),
        { affects: playerSectionAffects(campaignId, section.id) }
      );
      if (saved) setRenaming(false);
    } finally {
      setSavingName(false);
    }
  }

  return (
    <div className="card stack">
      <div
        className="row collapsible-header campaign-player-header"
        style={{ justifyContent: "space-between", cursor: renaming || forceExpanded ? "default" : "pointer" }}
        onClick={() => !renaming && !forceExpanded && setExpanded((v) => !v)}
      >
        <span className="row" style={{ alignItems: "center" }}>
          {!forceExpanded && <NavIcon name="chevron" className={`chevron-icon${expanded ? " is-open" : ""}`} />}
          {renaming ? (
            <input
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              maxLength={SECTION_NAME_MAX}
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => {
                if (e.key === "Enter") saveName();
                if (e.key === "Escape") setRenaming(false);
              }}
              autoFocus
            />
          ) : (
            <strong className="entry-title">{section.name}</strong>
          )}
          <span className="badge tag">{section.kind === "gallery" ? "Галерея" : "Статьи"}</span>
          {countLabel && <span className="muted" style={{ fontFamily: "var(--font-mono)", fontSize: "var(--fs-meta)" }}>· {countLabel}</span>}
        </span>
        <span className="row" onClick={(e) => e.stopPropagation()}>
          {(onMoveUp || onMoveDown) && (
            <span className="row" style={{ gap: 2 }}>
              <button onClick={onMoveUp} disabled={!onMoveUp} title="Выше" aria-label="Переместить выше" style={{ width: 26, height: 26, padding: 0, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
                ↑
              </button>
              <button onClick={onMoveDown} disabled={!onMoveDown} title="Ниже" aria-label="Переместить ниже" style={{ width: 26, height: 26, padding: 0, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
                ↓
              </button>
            </span>
          )}
          {renaming ? (
            <>
              <button className="primary" onClick={saveName} disabled={!nameDraft.trim() || nameDraft.trim().length > SECTION_NAME_MAX || savingName}>
                {savingName ? "…" : "ОК"}
              </button>
              <button onClick={() => { setNameDraft(section.name); setRenaming(false); }}>Отмена</button>
            </>
          ) : (
            <button onClick={() => setRenaming(true)} title="Переименовать" aria-label="Переименовать" style={{ width: 26, height: 26, padding: 0, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
              <NavIcon name="edit" />
            </button>
          )}
          <PlayerVisibilityPicker campaignId={campaignId} targetType="campaign_player_section" targetId={section.id} roster={roster} />
          <button className="danger" onClick={onRemove} aria-label="Удалить подраздел" style={{ width: 26, height: 26, padding: 0, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
            <NavIcon name="delete" />
          </button>
        </span>
      </div>
      {(expanded || forceExpanded) &&
        (section.kind === "gallery" ? (
          <GalleryTab ownerType="campaign_player_section" ownerId={section.id} />
        ) : (
          <ArticlesList campaignId={campaignId} sectionId={section.id} roster={roster} defaultSettingId={defaultSettingId} onStats={onArticlesStats} />
        ))}
    </div>
  );
}

function ArticlesList({
  campaignId,
  sectionId,
  roster,
  defaultSettingId,
  focusedId,
  onStats,
}: {
  campaignId: number;
  sectionId: number;
  roster: RosterPlayer[];
  defaultSettingId?: number;
  /** Master–Detail: показать только одну статью (навигация — снаружи). */
  focusedId?: number | null;
  /** Статьи для пунктов навигации (id + заголовки). */
  onStats?: (articles: CampaignPlayerArticle[]) => void;
}) {
  const client = useQueryClient();
  const run = useAction();
  const articlesPath = campaignPaths.sectionArticles(sectionId);
  const articlesState = useResource<CampaignPlayerArticle[]>(articlesPath);
  const articles = articlesState.data ?? NO_ARTICLES;
  const loading = articlesState.loading;
  const error = articlesState.error;
  const [saving, setSaving] = useState(false);
  const [confirmDialog, confirm] = useConfirm();
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
      await run(
        labelled("Новая статья", () =>
          write.post(`/campaign-player-sections/${sectionId}/articles`, { title: `Статья ${articles.length + 1}`, content: "" })
        ),
        { affects: playerArticleAffects(sectionId), retry: false }
      );
    } finally {
      setSaving(false);
    }
  }

  async function removeArticle(id: number) {
    const ok = await confirm({
      title: "Удалить статью?",
      message: "Статья будет удалена безвозвратно.",
      confirmLabel: "Удалить",
      danger: true,
    });
    if (!ok) return;
    await run(labelled("Удаление статьи", () => write.del(`/campaign-player-sections/articles/${id}`)), {
      affects: playerArticleAffects(sectionId),
    });
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
            <button className="primary" onClick={addArticle} disabled={saving}>
              + Добавить статью
            </button>
          }
        />
      )}
      {visible.map((a) => (
        <div
          key={a.id}
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
          <ArticleCard
            campaignId={campaignId}
            sectionId={sectionId}
            article={a}
            roster={roster}
            defaultSettingId={defaultSettingId}
            forceOpen={focusedId != null}
            onRemove={() => removeArticle(a.id)}
          />
        </div>
      ))}
      {!loading && !error && articles.length > 0 && (
        <button onClick={addArticle} style={{ alignSelf: "flex-start" }} disabled={saving}>
          {saving ? "Создание…" : "+ Добавить статью"}
        </button>
      )}
      {confirmDialog}
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
        <span className="row" onClick={(e) => e.stopPropagation()}>
          <PlayerVisibilityPicker campaignId={campaignId} targetType="campaign_player_article" targetId={article.id} roster={roster} />
          <button className="danger" onClick={onRemove} aria-label="Удалить статью">
            <NavIcon name="delete" />
          </button>
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
              <span className="muted" style={{ fontSize: "var(--fs-meta)" }}>Ctrl+S</span>
            </div>
          </div>
        ) : (
          <>
            <div className={clampOpen ? "" : "editable-clamp"} style={{ whiteSpace: "pre-wrap" }}>
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
