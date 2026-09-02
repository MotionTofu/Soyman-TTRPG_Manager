import { useEffect, useRef, useState } from "react";
import { api } from "../api/client";
import { GalleryTab } from "./GalleryTab";
import { PlayerVisibilityPicker } from "./PlayerVisibilityPicker";
import { MentionTextarea } from "./mentions/MentionTextarea";
import { MentionText } from "./mentions/MentionText";
import { syncMentionLinks } from "../mentions";
import { EmptyState } from "./EmptyState";
import { NavIcon } from "./NavIcons";
import { useConfirm } from "../hooks/useConfirm";
import { Modal } from "./Modal";
import type { CampaignPlayerArticle, CampaignPlayerSection, CampaignPlayerSectionKind, RosterPlayer } from "../types";

const SECTION_NAME_MAX = 80;

interface Props {
  campaignId: number;
  roster: RosterPlayer[];
  defaultSettingId?: number;
}

export function CampaignPlayerSectionsTab({ campaignId, roster, defaultSettingId }: Props) {
  const [sections, setSections] = useState<CampaignPlayerSection[]>([]);
  const [newName, setNewName] = useState("");
  const [newKind, setNewKind] = useState<CampaignPlayerSectionKind>("articles");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmDialog, confirm] = useConfirm();
  const nameInputRef = useRef<HTMLInputElement>(null);
  const [filter, setFilter] = useState("");
  const [dragSectionId, setDragSectionId] = useState<number | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);

  function load(signal?: AbortSignal) {
    setLoading(true);
    setError(null);
    api
      .get<CampaignPlayerSection[]>(`/campaign-player-sections?campaign_id=${campaignId}`, { signal } as any)
      .then((data) => {
        setSections(data);
        setLoading(false);
      })
      .catch((e: any) => {
        if (e?.name === "AbortError") return;
        setError(e?.message ?? "Ошибка загрузки");
        setLoading(false);
      });
  }

  useEffect(() => {
    const c = new AbortController();
    load(c.signal);
    return () => c.abort();
  }, [campaignId]);

  function refresh() {
    load();
  }

  async function addSection() {
    const trimmed = newName.trim();
    if (!trimmed || saving) return;
    if (trimmed.length > SECTION_NAME_MAX) {
      setError(`Название не длиннее ${SECTION_NAME_MAX} символов`);
      return;
    }
    setSaving(true);
    try {
      await api.post("/campaign-player-sections", { campaign_id: campaignId, name: trimmed, kind: newKind });
      setNewName("");
      refresh();
    } catch (e: any) {
      setError(e?.message ?? "Не удалось создать подраздел");
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
    try {
      await api.del(`/campaign-player-sections/${id}`);
      refresh();
    } catch (e: any) {
      setError(e?.message ?? "Не удалось удалить подраздел");
    }
  }

  async function reorderSections(draggedId: number, targetId: number) {
    if (draggedId === targetId) return;
    const ids = sections.map((s) => s.id);
    const from = ids.indexOf(draggedId);
    const to = ids.indexOf(targetId);
    if (from === -1 || to === -1) return;
    ids.splice(to, 0, ...ids.splice(from, 1));
    const order = new Map(ids.map((id, i) => [id, i]));
    setSections((prev) => [...prev].sort((a, b) => order.get(a.id)! - order.get(b.id)!));
    try {
      await api.put("/campaign-player-sections/reorder", { order: ids });
    } catch (e: any) {
      setError(e?.message ?? "Не удалось переместить");
      load();
    }
  }

  const filtered = filter.trim() ? sections.filter((s) => s.name.toLowerCase().includes(filter.trim().toLowerCase())) : sections;

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
          <button onClick={() => setPreviewOpen(true)}>Предпросмотр как игрок</button>
        </div>
      )}
      {sections.length === 1 && (
        <div className="row" style={{ justifyContent: "flex-end" }}>
          <button onClick={() => setPreviewOpen(true)}>Предпросмотр как игрок</button>
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
          icon="skullDie"
          title="ПОДРАЗДЕЛОВ НЕТ"
          hint="Создайте первый — статьи или галерею — и откройте игрокам глазом «Кому видно»."
          action={
            <button className="primary" onClick={() => nameInputRef.current?.focus()}>
              Создать подраздел
            </button>
          }
        />
      )}
      {filtered.map((s) => (
        <div
          key={s.id}
          draggable
          onDragStart={() => setDragSectionId(s.id)}
          onDragEnd={() => setDragSectionId(null)}
          onDragOver={(e) => e.preventDefault()}
          onDrop={() => {
            if (dragSectionId != null) {
              reorderSections(dragSectionId, s.id);
              setDragSectionId(null);
            }
          }}
          style={{ opacity: dragSectionId === s.id ? 0.6 : 1 }}
        >
          <SectionCard
            campaignId={campaignId}
            section={s}
            roster={roster}
            defaultSettingId={defaultSettingId}
            onRemove={() => removeSection(s.id)}
            onRenamed={refresh}
          />
        </div>
      ))}
      {filter && filtered.length === 0 && <p className="muted">Ничего не найдено.</p>}
      {confirmDialog}
      {previewOpen && (
        <Modal onClose={() => setPreviewOpen(false)}>
          <div className="stack">
            <h3>Предпросмотр как игрок</h3>
            <p className="muted" style={{ maxWidth: "62ch" }}>Так видит раздел игрок — только открытые ему подразделы и статьи. Сейчас это превью по данным мастера (глаз показывает кому что открыто).</p>
            <div className="stack">
              {sections.map((s) => (
                <div key={s.id} className="card" style={{ padding: 12 }}>
                  <strong style={{ fontFamily: "var(--font-ui)", textTransform: "uppercase", fontSize: "var(--fs-meta)" }}>{s.name}</strong> <span className="badge tag">{s.kind === "gallery" ? "Галерея" : "Статьи"}</span>
                </div>
              ))}
              {sections.length === 0 && <p className="muted">Подразделов нет.</p>}
            </div>
            <div className="row" style={{ justifyContent: "flex-end" }}>
              <button className="primary" onClick={() => setPreviewOpen(false)}>Закрыть</button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function SectionCard({
  campaignId,
  section,
  roster,
  defaultSettingId,
  onRemove,
  onRenamed,
}: {
  campaignId: number;
  section: CampaignPlayerSection;
  roster: RosterPlayer[];
  defaultSettingId?: number;
  onRemove: () => void;
  onRenamed: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState(section.name);
  const [savingName, setSavingName] = useState(false);
  const [countLabel, setCountLabel] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    if (section.kind === "gallery") {
      api.get<any[]>(`/gallery?owner_type=campaign_player_section&owner_id=${section.id}`).then((rows) => {
        if (!cancelled) setCountLabel(`${rows.length} изо`);
      }).catch(() => {});
    } else {
      api.get<any[]>(`/campaign-player-sections/${section.id}/articles`).then((rows) => {
        if (!cancelled) setCountLabel(`${rows.length} ст`);
      }).catch(() => {});
    }
    return () => { cancelled = true; };
  }, [section.id, section.kind]);

  async function saveName() {
    const trimmed = nameDraft.trim();
    if (!trimmed || trimmed.length > SECTION_NAME_MAX) return;
    setSavingName(true);
    try {
      await api.put(`/campaign-player-sections/${section.id}`, { name: trimmed });
      setRenaming(false);
      onRenamed();
    } finally {
      setSavingName(false);
    }
  }

  return (
    <div className="card stack">
      <div
        className="row collapsible-header campaign-player-header"
        style={{ justifyContent: "space-between", cursor: renaming ? "default" : "pointer" }}
        onClick={() => !renaming && setExpanded((v) => !v)}
      >
        <span className="row" style={{ alignItems: "center" }}>
          <NavIcon name="chevron" className={`chevron-icon${expanded ? " is-open" : ""}`} />
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
      {expanded &&
        (section.kind === "gallery" ? (
          <GalleryTab ownerType="campaign_player_section" ownerId={section.id} />
        ) : (
          <ArticlesList campaignId={campaignId} sectionId={section.id} roster={roster} defaultSettingId={defaultSettingId} />
        ))}
    </div>
  );
}

function ArticlesList({
  campaignId,
  sectionId,
  roster,
  defaultSettingId,
}: {
  campaignId: number;
  sectionId: number;
  roster: RosterPlayer[];
  defaultSettingId?: number;
}) {
  const [articles, setArticles] = useState<CampaignPlayerArticle[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmDialog, confirm] = useConfirm();
  const [dragId, setDragId] = useState<number | null>(null);

  function load(signal?: AbortSignal) {
    setLoading(true);
    setError(null);
    api
      .get<CampaignPlayerArticle[]>(`/campaign-player-sections/${sectionId}/articles`, { signal } as any)
      .then((data) => {
        setArticles(data);
        setLoading(false);
      })
      .catch((e: any) => {
        if (e?.name === "AbortError") return;
        setError(e?.message ?? "Ошибка загрузки статей");
        setLoading(false);
      });
  }

  useEffect(() => {
    const c = new AbortController();
    load(c.signal);
    return () => c.abort();
  }, [sectionId]);

  function refresh() {
    load();
  }

  async function addArticle() {
    if (saving) return;
    setSaving(true);
    try {
      await api.post(`/campaign-player-sections/${sectionId}/articles`, {
        title: `Статья ${articles.length + 1}`,
        content: "",
      });
      refresh();
    } catch (e: any) {
      setError(e?.message ?? "Не удалось создать статью");
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
    try {
      await api.del(`/campaign-player-sections/articles/${id}`);
      refresh();
    } catch (e: any) {
      setError(e?.message ?? "Не удалось удалить статью");
    }
  }

  async function reorderArticles(draggedId: number, targetId: number) {
    if (draggedId === targetId) return;
    const ids = articles.map((a) => a.id);
    const from = ids.indexOf(draggedId);
    const to = ids.indexOf(targetId);
    if (from === -1 || to === -1) return;
    ids.splice(to, 0, ...ids.splice(from, 1));
    const order = new Map(ids.map((id, i) => [id, i]));
    setArticles((prev) => [...prev].sort((a, b) => order.get(a.id)! - order.get(b.id)!));
    try {
      await api.put("/campaign-player-sections/articles/reorder", { order: ids });
    } catch (e: any) {
      setError(e?.message ?? "Не удалось переместить статью");
      load();
    }
  }

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
          icon="skullDie"
          title="СТАТЕЙ НЕТ"
          hint="Добавьте первую статью — она откроется сразу в режиме редактирования."
          action={
            <button className="primary" onClick={addArticle} disabled={saving}>
              + Добавить статью
            </button>
          }
        />
      )}
      {articles.map((a) => (
        <div
          key={a.id}
          draggable
          onDragStart={() => setDragId(a.id)}
          onDragEnd={() => setDragId(null)}
          onDragOver={(e) => e.preventDefault()}
          onDrop={() => {
            if (dragId != null) {
              reorderArticles(dragId, a.id);
              setDragId(null);
            }
          }}
          style={{ opacity: dragId === a.id ? 0.6 : 1 }}
        >
          <ArticleCard
            campaignId={campaignId}
            article={a}
            roster={roster}
            defaultSettingId={defaultSettingId}
            onChange={refresh}
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
  article,
  roster,
  defaultSettingId,
  onChange,
  onRemove,
}: {
  campaignId: number;
  article: CampaignPlayerArticle;
  roster: RosterPlayer[];
  defaultSettingId?: number;
  onChange: () => void;
  onRemove: () => void;
}) {
  const [editMode, setEditMode] = useState(() => !article.content);
  const [expanded, setExpanded] = useState(false);
  const [title, setTitle] = useState(article.title);
  const [content, setContent] = useState(article.content);
  const [saving, setSaving] = useState(false);
  const [confirmDialog, confirm] = useConfirm();
  const [clampOpen, setClampOpen] = useState(false);
  const open = editMode || expanded;
  const isDirty = title !== article.title || content !== article.content;

  async function save() {
    if (saving) return;
    setSaving(true);
    try {
      await api.put(`/campaign-player-sections/articles/${article.id}`, { title, content });
      syncMentionLinks("campaign_player_article", article.id, article.content, content);
      setEditMode(false);
      onChange();
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
        style={{ justifyContent: "space-between", cursor: editMode ? "default" : "pointer" }}
        onClick={() => !editMode && setExpanded((v) => !v)}
      >
        <span className="row" style={{ alignItems: "center" }}>
          {!editMode && <NavIcon name="chevron" className={`chevron-icon${expanded ? " is-open" : ""}`} />}
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
            {article.content.split("\n").length > 8 || article.content.length > 400 ? (
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
