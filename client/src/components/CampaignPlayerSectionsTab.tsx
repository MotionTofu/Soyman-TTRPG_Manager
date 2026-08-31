import { useEffect, useState } from "react";
import { api } from "../api/client";
import { GalleryTab } from "./GalleryTab";
import { PlayerVisibilityPicker } from "./PlayerVisibilityPicker";
import { MentionTextarea } from "./mentions/MentionTextarea";
import { MentionText } from "./mentions/MentionText";
import { syncMentionLinks } from "../mentions";
import { EmptyState } from "./EmptyState";
import { NavIcon } from "./NavIcons";
import { useConfirm } from "../hooks/useConfirm";
import type { CampaignPlayerArticle, CampaignPlayerSection, CampaignPlayerSectionKind, RosterPlayer } from "../types";

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
    if (!newName.trim() || saving) return;
    setSaving(true);
    try {
      await api.post("/campaign-player-sections", { campaign_id: campaignId, name: newName.trim(), kind: newKind });
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

  return (
    <div className="stack campaign-player-overview">
      <p className="muted" style={{ maxWidth: "62ch" }}>
        Подразделы этого раздела не видны игрокам, пока вы явно не откроете их (или отдельные
        статьи внутри) конкретным игрокам кнопкой-глазом.
      </p>
      <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
        <input placeholder="Название подраздела" value={newName} onChange={(e) => setNewName(e.target.value)} style={{ flex: "1 1 200px", minWidth: 0 }} />
        <select value={newKind} onChange={(e) => setNewKind(e.target.value as CampaignPlayerSectionKind)}>
          <option value="articles">Статьи</option>
          <option value="gallery">Галерея</option>
        </select>
        <button className="primary" onClick={addSection} disabled={!newName.trim() || saving}>
          {saving ? "Создание…" : "+ Добавить подраздел"}
        </button>
      </div>
      {loading && <p className="muted">Загрузка…</p>}
      {error && (
        <div className="card" style={{ borderColor: "var(--danger, #c00)", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
          <span style={{ color: "var(--danger, #c00)", fontSize: 13 }}>{error}</span>
          <button onClick={() => load()}>Повторить</button>
        </div>
      )}
      {!loading && !error && sections.length === 0 && (
        <EmptyState
          icon="skullDie"
          title="ПОДРАЗДЕЛОВ НЕТ"
          hint="Создайте первый — статьи или галерею — и откройте игрокам глазом «Кому видно»."
          action={
            <span className="muted" style={{ fontSize: 12 }}>
              Введите название выше и нажмите «+ Добавить подраздел»
            </span>
          }
        />
      )}
      {sections.map((s) => (
        <SectionCard
          key={s.id}
          campaignId={campaignId}
          section={s}
          roster={roster}
          defaultSettingId={defaultSettingId}
          onRemove={() => removeSection(s.id)}
          onRenamed={refresh}
        />
      ))}
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

  async function saveName() {
    if (!nameDraft.trim()) return;
    await api.put(`/campaign-player-sections/${section.id}`, { name: nameDraft.trim() });
    setRenaming(false);
    onRenamed();
  }

  return (
    <div className="card stack">
      <div
        className="row collapsible-header"
        style={{ justifyContent: "space-between", cursor: renaming ? "default" : "pointer" }}
        onClick={() => !renaming && setExpanded((v) => !v)}
      >
        <span className="row" style={{ alignItems: "center" }}>
          <NavIcon name="chevron" className={`chevron-icon${expanded ? " is-open" : ""}`} />
          {renaming ? (
            <input
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
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
        </span>
        <span className="row" onClick={(e) => e.stopPropagation()}>
          {renaming ? (
            <>
              <button className="primary" onClick={saveName}>
                ОК
              </button>
              <button onClick={() => setRenaming(false)}>Отмена</button>
            </>
          ) : (
            <button onClick={() => setRenaming(true)}>Переименовать</button>
          )}
          <PlayerVisibilityPicker campaignId={campaignId} targetType="campaign_player_section" targetId={section.id} roster={roster} />
          <button className="danger" onClick={onRemove} aria-label="Удалить подраздел">
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

  return (
    <div className="stack">
      {loading && <p className="muted">Загрузка статей…</p>}
      {error && (
        <div className="card" style={{ borderColor: "var(--danger, #c00)", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
          <span style={{ color: "var(--danger, #c00)", fontSize: 13 }}>{error}</span>
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
        <ArticleCard
          key={a.id}
          campaignId={campaignId}
          article={a}
          roster={roster}
          defaultSettingId={defaultSettingId}
          onChange={refresh}
          onRemove={() => removeArticle(a.id)}
        />
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
  const open = editMode || expanded;

  async function save() {
    await api.put(`/campaign-player-sections/articles/${article.id}`, { title, content });
    syncMentionLinks("campaign_player_article", article.id, article.content, content);
    setEditMode(false);
    onChange();
  }

  return (
    <div className="card stack">
      <div
        className="row collapsible-header"
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
          <>
            <MentionTextarea value={content} onChange={setContent} rows={4} defaultSettingId={defaultSettingId} />
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
              <MentionText text={article.content} />
            </div>
            <button onClick={() => setEditMode(true)} style={{ alignSelf: "flex-start" }}>
              Редактировать
            </button>
          </>
        ))}
    </div>
  );
}
