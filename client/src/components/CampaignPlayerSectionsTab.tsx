import { useEffect, useState } from "react";
import { api } from "../api/client";
import { GalleryTab } from "./GalleryTab";
import { PlayerVisibilityPicker } from "./PlayerVisibilityPicker";
import { MentionTextarea } from "./mentions/MentionTextarea";
import { MentionText } from "./mentions/MentionText";
import { syncMentionLinks } from "../mentions";
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

  function refresh() {
    api.get<CampaignPlayerSection[]>(`/campaign-player-sections?campaign_id=${campaignId}`).then(setSections);
  }
  useEffect(refresh, [campaignId]);

  async function addSection() {
    if (!newName.trim()) return;
    await api.post("/campaign-player-sections", { campaign_id: campaignId, name: newName, kind: newKind });
    setNewName("");
    refresh();
  }

  async function removeSection(id: number) {
    if (!confirm("Удалить подраздел? Все статьи/изображения внутри будут удалены.")) return;
    await api.del(`/campaign-player-sections/${id}`);
    refresh();
  }

  return (
    <div className="stack">
      <p className="muted">
        Подразделы этого раздела не видны игрокам, пока вы явно не откроете их (или отдельные
        статьи внутри) конкретным игрокам кнопкой 👁.
      </p>
      <div className="row">
        <input placeholder="Название подраздела" value={newName} onChange={(e) => setNewName(e.target.value)} />
        <select value={newKind} onChange={(e) => setNewKind(e.target.value as CampaignPlayerSectionKind)}>
          <option value="articles">Статьи</option>
          <option value="gallery">Галерея</option>
        </select>
        <button className="primary" onClick={addSection}>
          + Добавить подраздел
        </button>
      </div>
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
      {sections.length === 0 && <p className="muted">Подразделов пока нет.</p>}
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
    await api.put(`/campaign-player-sections/${section.id}`, { name: nameDraft });
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
          <span className="comp-toggle" aria-hidden="true">
            {expanded ? "▾" : "▸"}
          </span>
          {renaming ? (
            <input
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              onClick={(e) => e.stopPropagation()}
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
          <button className="danger" onClick={onRemove}>
            ✕
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

  function refresh() {
    api.get<CampaignPlayerArticle[]>(`/campaign-player-sections/${sectionId}/articles`).then(setArticles);
  }
  useEffect(refresh, [sectionId]);

  async function addArticle() {
    await api.post(`/campaign-player-sections/${sectionId}/articles`, {
      title: `Статья ${articles.length + 1}`,
      content: "",
    });
    refresh();
  }

  async function removeArticle(id: number) {
    if (!confirm("Вы уверены, что хотите удалить ЭТО?")) return;
    await api.del(`/campaign-player-sections/articles/${id}`);
    refresh();
  }

  return (
    <div className="stack">
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
      <button onClick={addArticle} style={{ alignSelf: "flex-start" }}>
        + Добавить статью
      </button>
      {articles.length === 0 && <p className="muted">Статей пока нет.</p>}
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
          {!editMode && (
            <span className="comp-toggle" aria-hidden="true">
              {expanded ? "▾" : "▸"}
            </span>
          )}
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
          <button className="danger" onClick={onRemove}>
            ✕
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
