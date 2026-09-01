import { useEffect, useState, type ReactNode } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api } from "../api/client";
import { Breadcrumbs } from "../components/Breadcrumbs";
import { EntityTypeChip } from "../components/EntityTypeChip";
import { EditableTextCard } from "../components/EditableTextCard";
import { MentionText } from "../components/mentions/MentionText";
import { useTabState } from "../hooks/useTabState";
import { SCENE_KINDS, SCENE_STATUSES, sceneWord } from "../sceneKinds";
import { CrossLinksWizard } from "../components/CrossLinksWizard";
import type { Setting, StoryArcDetail, StoryScene } from "../types";
import { NavIcon } from "../components/NavIcons";

// «Действующие лица» и «Награды» убраны с профиля: список действующих лиц
// собирался из связей сцен и информационной пользы не нёс, а награды книги без
// работы с сокровищницей выглядели свалкой строк. Данные наград и связей
// остались в базе нетронутыми — вернуть их будет чем.
const TABS = ["Обзор", "Главы и сцены", "Вехи", "Тайны и зацепки"] as const;

const SECRET_KINDS = [
  { key: "secret", label: "Тайна" },
  { key: "clue", label: "Улика" },
  { key: "thread", label: "Нить" },
];

// Profile of one adventure. Opened from a setting (originals) or from a
// campaign (?campaign=<id>), where scene edits go through the copy-on-write
// layer and milestones/secrets/scenes additionally carry that campaign's
// progress.
export function AdventureDetailPage() {
  const { id } = useParams();
  const arcId = Number(id);
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const campaignId = params.get("campaign") ? Number(params.get("campaign")) : null;

  const [arc, setArc] = useState<StoryArcDetail | null>(null);
  const [setting, setSetting] = useState<Setting | null>(null);
  const [tab, selectTab] = useTabState(TABS, "Обзор");

  function refresh() {
    const q = campaignId ? `?campaign_id=${campaignId}` : "";
    api.get<StoryArcDetail>(`/story/arcs/${arcId}${q}`).then(setArc);
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(refresh, [arcId, campaignId]);

  useEffect(() => {
    if (arc) api.get<Setting>(`/settings/${arc.setting_id}`).then(setSetting);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [arc?.setting_id]);

  if (!arc) return <p className="muted">Загрузка…</p>;

  async function save(patch: Record<string, unknown>) {
    await api.put(`/story/arcs/${arcId}`, patch);
    refresh();
  }

  async function archive() {
    if (!confirm("Отправить приключение в архив вместе с главами и сценами?")) return;
    await api.del(`/story/arcs/${arcId}`);
    navigate(`/settings/${arc?.setting_id}?tab=${encodeURIComponent("Приключения")}`);
  }

  async function exportAdventure() {
    const res = await fetch(`/api/story/arcs/${arcId}/export`, { credentials: "include" });
    if (!res.ok) return;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${arc.name.replace(/[^a-z0-9а-яё]+/gi, "_").slice(0, 60) || "adventure"}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="stack">
      <Breadcrumbs
        items={[
          { label: setting?.name ?? "Сеттинг", to: `/settings/${arc.setting_id}` },
          {
            label: "Приключения",
            to: `/settings/${arc.setting_id}?tab=${encodeURIComponent("Приключения")}`,
          },
          { label: arc.name },
        ]}
      />

      <div className="entity-header">
        <div className="stack">
          <div className="row" style={{ alignItems: "center" }}>
            <h2>{arc.name}</h2>
            <EntityTypeChip type="adventure" />
            <Link
              to={`/canvas?setting=${arc.setting_id}&arc=${arc.id}`}
              className="graph-neighbourhood-link"
              title="Открыть схему на полотне"
            >
              <NavIcon name="canvas" /> На полотне
            </Link>
          </div>
          <div className="row">
            {arc.is_default === 1 && <span className="badge tag">стандартное</span>}
            {arc.recommended_level && <span className="muted">{arc.recommended_level}</span>}
            {arc.duration && <span className="muted">{arc.duration}</span>}
          </div>
        </div>
        <div className="entity-header-actions">
          <button onClick={exportAdventure}>
            Экспорт
          </button>
          {arc.is_default !== 1 && (
            <>
              <button
                onClick={() => {
                  const name = prompt("Название приключения", arc.name);
                  if (name?.trim()) save({ name: name.trim() });
                }}
              >
                Переименовать
              </button>
              <button className="danger" onClick={archive}>
                <NavIcon name="archive" /> Архивировать
              </button>
            </>
          )}
        </div>
      </div>

      <div className="tabs">
        {TABS.map((t) => (
          <button key={t} className={tab === t ? "active" : ""} onClick={() => selectTab(t)}>
            {t}
          </button>
        ))}
      </div>

      {tab === "Обзор" && (
        <div className="stack">
          <div className="card stack">
            <FieldRow label="Уровень персонажей" value={arc.recommended_level} onSave={(v) => save({ recommended_level: v })} />
            <FieldRow label="Число игроков" value={arc.player_count} onSave={(v) => save({ player_count: v })} />
            <FieldRow label="Длительность" value={arc.duration} onSave={(v) => save({ duration: v })} />
            <FieldRow label="Источник" value={arc.source} onSave={(v) => save({ source: v })} />
            <FieldRow label="Теги" value={arc.tags} onSave={(v) => save({ tags: v })} />
          </div>
          <EditableTextCard
            title="Логлайн"
            value={arc.description}
            onSave={(v) => save({ description: v })}
            rows={5}
            entityType="adventure"
            entityId={arcId}
            defaultSettingId={arc.setting_id}
            collapsible
            defaultOpen
          />
          <EditableTextCard
            title="Завязка"
            help="Как партия вообще попадает в это приключение."
            value={arc.hook}
            onSave={(v) => save({ hook: v })}
            rows={4}
            entityType="adventure"
            entityId={arcId}
            defaultSettingId={arc.setting_id}
            collapsible
            defaultOpen
          />
        </div>
      )}

      {tab === "Главы и сцены" && (
        <>
          {campaignId == null && (
            <CrossLinksWizard
              ownerKind="adventure"
              ownerId={arcId}
              help="Ищет в тексте сцен имена сущностей сеттинга и записей компендиума — и делает их кликабельными. Шаг за шагом, по одному типу цели. Ничего не пишет, пока вы не подтвердите."
            />
          )}
          <ChaptersAndScenes arc={arc} campaignId={campaignId} onChange={refresh} />
        </>
      )}

      {tab === "Вехи" && <Milestones arc={arc} campaignId={campaignId} onChange={refresh} />}

      {tab === "Тайны и зацепки" && (
        <Secrets arc={arc} campaignId={campaignId} onChange={refresh} />
      )}
    </div>
  );
}

// One short single-line field of the Обзор card, edited in place.
function FieldRow({
  label,
  value,
  onSave,
}: {
  label: string;
  value: string;
  onSave: (v: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <div className="row" style={{ justifyContent: "space-between" }}>
      <span className="muted">{label}</span>
      {editing ? (
        <span className="row">
          <input value={draft} onChange={(e) => setDraft(e.target.value)} />
          <button
            className="primary"
            onClick={() => {
              onSave(draft);
              setEditing(false);
            }}
          >
            OK
          </button>
        </span>
      ) : (
        <span className="row">
          <span>{value || "—"}</span>
          <button onClick={() => setEditing(true)}>Изменить</button>
        </span>
      )}
    </div>
  );
}

function ChaptersAndScenes({
  arc,
  campaignId,
  onChange,
}: {
  arc: StoryArcDetail;
  campaignId: number | null;
  onChange: () => void;
}) {
  const [chapterName, setChapterName] = useState("");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [dragId, setDragId] = useState<number | null>(null);
  // Collapsed chapters, remembered per adventure so a long book doesn't
  // re-expand every time the tab is reopened.
  const storageKey = `adventure-collapsed-${arc.id}`;
  const [collapsed, setCollapsed] = useState<number[]>(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      return raw ? (JSON.parse(raw) as number[]) : [];
    } catch {
      return [];
    }
  });
  const suffix = campaignId ? `?campaign=${campaignId}` : "";

  function toggleCollapsed(groupArcId: number) {
    setCollapsed((prev) => {
      const next = prev.includes(groupArcId)
        ? prev.filter((id) => id !== groupArcId)
        : [...prev, groupArcId];
      localStorage.setItem(storageKey, JSON.stringify(next));
      return next;
    });
  }

  async function createChapter() {
    if (!chapterName.trim()) return;
    await api.post("/story/arcs", {
      setting_id: arc.setting_id,
      parent_id: arc.id,
      kind: "chapter",
      name: chapterName,
    });
    setChapterName("");
    onChange();
  }

  async function createScene(targetArcId: number) {
    const key = String(targetArcId);
    const name = drafts[key];
    if (!name?.trim()) return;
    await api.post("/story/scenes", {
      setting_id: arc.setting_id,
      arc_id: targetArcId,
      campaign_id: campaignId,
      name: name.trim(),
    });
    setDrafts((d) => ({ ...d, [key]: "" }));
    onChange();
  }

  // Reorder is scoped to one group: the ids sent are exactly the scenes of
  // that chapter, in their new order.
  async function reorderScenes(group: StoryScene[], draggedId: number, targetId: number) {
    if (draggedId === targetId) return;
    const ids = group.map((s) => s.id);
    const from = ids.indexOf(draggedId);
    const to = ids.indexOf(targetId);
    if (from === -1 || to === -1) return;
    ids.splice(to, 0, ...ids.splice(from, 1));
    await api.put("/story/scenes/reorder", { order: ids });
    onChange();
  }

  async function moveChapter(chapterId: number, delta: number) {
    const ids = arc.chapters.map((c) => c.id);
    const i = ids.indexOf(chapterId);
    const j = i + delta;
    if (i === -1 || j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    await api.put("/story/arcs/reorder", { order: ids });
    onChange();
  }

  async function setStatus(scene: StoryScene, status: string) {
    if (!campaignId) return;
    await api.put(`/story/scenes/${scene.id}/state`, { campaign_id: campaignId, status });
    onChange();
  }

  // Renaming a scene from inside a campaign goes through the same
  // copy-on-write path as any other edit, so the setting's title is safe.
  async function renameScene(scene: StoryScene) {
    const name = prompt("Название сцены", scene.name);
    if (!name?.trim() || name.trim() === scene.name) return;
    await api.put(`/story/scenes/${scene.id}`, { name: name.trim(), campaign_id: campaignId });
    onChange();
  }

  async function archiveScene(scene: StoryScene) {
    if (!confirm(`Отправить сцену «${scene.name}» в архив?`)) return;
    await api.del(`/story/scenes/${scene.id}`);
    onChange();
  }

  function renderGroup(title: string, groupArcId: number, scenes: StoryScene[], controls?: ReactNode) {
    const isCollapsed = collapsed.includes(groupArcId);
    return (
      <div className="card stack" key={groupArcId}>
        <div className="row" style={{ justifyContent: "space-between" }}>
          <button
            type="button"
            onClick={() => toggleCollapsed(groupArcId)}
            title={isCollapsed ? "Развернуть" : "Свернуть"}
          >
            {isCollapsed ? "▶" : "▼"}
          </button>
          <strong className="entry-title" style={{ flex: 1 }}>
            {title}
            {isCollapsed && (
              <span className="muted"> · {scenes.length} {sceneWord(scenes.length)}</span>
            )}
          </strong>
          {controls}
        </div>
        {!isCollapsed && (
          <>
            <div className="entity-row-list">
              {scenes.map((s) => (
                <div
                  key={s.id}
                  className="entity-row"
                  draggable
                  onDragStart={() => setDragId(s.id)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => dragId != null && reorderScenes(scenes, dragId, s.id)}
                >
                  <Link to={`/scenes/${s.id}${suffix}`} className="entity-row-name">
                    {s.name}
                  </Link>
                  <span className="muted">{SCENE_KINDS.find((k) => k.key === s.kind)?.label}</span>
                  {s.is_override && <span className="badge tag">изменено в кампании</span>}
                  {s.campaign_only && <span className="badge tag">только в кампании</span>}
                  <span className="entity-row-actions">
                    {campaignId && (
                      <select
                        value={s.state?.status ?? "pending"}
                        onChange={(e) => setStatus(s, e.target.value)}
                      >
                        {SCENE_STATUSES.map((st) => (
                          <option key={st.key} value={st.key}>
                            {st.label}
                          </option>
                        ))}
                      </select>
                    )}
                    <button onClick={() => renameScene(s)}>Переименовать</button>
                    {/* Archiving a setting scene from inside a campaign would
                        remove it for every other campaign too — only scenes
                        that belong to this campaign can be archived here. */}
                    {(!campaignId || s.campaign_only) && (
                      <button className="danger" onClick={() => archiveScene(s)}>
                        <NavIcon name="archive" /> Архивировать
                      </button>
                    )}
                  </span>
                </div>
              ))}
              {scenes.length === 0 && <p className="muted">Сцен пока нет.</p>}
            </div>
            <div className="row">
              <input
                placeholder="Название сцены"
                value={drafts[String(groupArcId)] ?? ""}
                onChange={(e) => setDrafts((d) => ({ ...d, [String(groupArcId)]: e.target.value }))}
              />
              <button onClick={() => createScene(groupArcId)}>+ Сцена</button>
            </div>
          </>
        )}
      </div>
    );
  }

  const direct = arc.scenes.filter((s) => s.arc_id === arc.id);

  return (
    <div className="stack">
      <span className="muted">
        Сцены перетаскиваются внутри главы, главы двигаются стрелками и сворачиваются.
      </span>
      {renderGroup(arc.chapters.length > 0 ? "Без главы" : "Сцены", arc.id, direct)}
      {arc.chapters.map((c) =>
        renderGroup(
          c.name,
          c.id,
          arc.scenes.filter((s) => s.arc_id === c.id),
          <span className="row">
            <button onClick={() => moveChapter(c.id, -1)}>↑</button>
            <button onClick={() => moveChapter(c.id, 1)}>↓</button>
            {!campaignId && (
              <>
                <button
                  onClick={async () => {
                    const name = prompt("Название главы", c.name);
                    if (name?.trim()) {
                      await api.put(`/story/arcs/${c.id}`, { name: name.trim() });
                      onChange();
                    }
                  }}
                >
                  Переименовать
                </button>
                <button
                  className="danger"
                  onClick={async () => {
                    if (!confirm(`Отправить главу «${c.name}» в архив вместе со сценами?`)) return;
                    await api.del(`/story/arcs/${c.id}`);
                    onChange();
                  }}
                >
                  <NavIcon name="archive" /> Архивировать
                </button>
              </>
            )}
          </span>
        )
      )}
      {!campaignId && (
        <div className="row">
          <input
            placeholder="Название главы"
            value={chapterName}
            onChange={(e) => setChapterName(e.target.value)}
          />
          <button className="primary" onClick={createChapter}>
            + Глава
          </button>
        </div>
      )}
    </div>
  );
}

function Milestones({
  arc,
  campaignId,
  onChange,
}: {
  arc: StoryArcDetail;
  campaignId: number | null;
  onChange: () => void;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [sceneId, setSceneId] = useState("");

  async function add() {
    if (!title.trim()) return;
    await api.post(`/story/arcs/${arc.id}/milestones`, {
      title,
      description,
      scene_id: sceneId ? Number(sceneId) : null,
    });
    setTitle("");
    setDescription("");
    setSceneId("");
    onChange();
  }

  async function toggle(milestoneId: number, achieved: boolean) {
    if (!campaignId) return;
    await api.put(`/story/milestones/${milestoneId}/state`, {
      campaign_id: campaignId,
      achieved,
    });
    onChange();
  }

  async function move(milestoneId: number, delta: number) {
    const ids = arc.milestones.map((m) => m.id);
    const i = ids.indexOf(milestoneId);
    const j = i + delta;
    if (i === -1 || j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    await api.put("/story/milestones/reorder", { order: ids });
    onChange();
  }

  return (
    <div className="card stack">
      <span className="muted">
        Ключевые точки сюжета в порядке следования.{" "}
        {campaignId
          ? "Отметки достижения относятся только к этой кампании."
          : "В кампании у каждой вехи появится отметка «достигнута»."}
      </span>
      {arc.milestones.map((m) => (
        <div key={m.id} className="row" style={{ justifyContent: "space-between" }}>
          <span>
            {campaignId && (
              <input
                type="checkbox"
                checked={m.state?.achieved === 1}
                onChange={(e) => toggle(m.id, e.target.checked)}
              />
            )}{" "}
            <strong>{m.title}</strong>
            {m.scene_name && <span className="muted"> · сцена «{m.scene_name}»</span>}
            {m.description && (
              <div className="muted">
                <MentionText text={m.description} />
              </div>
            )}
          </span>
          <span className="row">
            <button onClick={() => move(m.id, -1)}>↑</button>
            <button onClick={() => move(m.id, 1)}>↓</button>
            {!campaignId && (
              <button
                className="danger"
                onClick={async () => {
                  await api.del(`/story/milestones/${m.id}`);
                  onChange();
                }}
              >
                ✕
              </button>
            )}
          </span>
        </div>
      ))}
      {arc.milestones.length === 0 && <p className="muted">Вех пока нет.</p>}
      {!campaignId && (
        <div className="row">
          <input placeholder="Название вехи" value={title} onChange={(e) => setTitle(e.target.value)} />
          <input
            placeholder="Описание"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
          <select value={sceneId} onChange={(e) => setSceneId(e.target.value)}>
            <option value="">Без привязки к сцене</option>
            {arc.scenes.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <button className="primary" onClick={add}>
            Добавить
          </button>
        </div>
      )}
    </div>
  );
}

function Secrets({
  arc,
  campaignId,
  onChange,
}: {
  arc: StoryArcDetail;
  campaignId: number | null;
  onChange: () => void;
}) {
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [kind, setKind] = useState("secret");

  async function add() {
    if (!title.trim()) return;
    await api.post(`/story/arcs/${arc.id}/secrets`, { title, content, kind });
    setTitle("");
    setContent("");
    onChange();
  }

  async function toggle(secretId: number, revealed: boolean) {
    if (!campaignId) return;
    await api.put(`/story/secrets/${secretId}/state`, { campaign_id: campaignId, revealed });
    onChange();
  }

  return (
    <div className="card stack">
      <span className="muted">
        Тайны, улики и сюжетные нити приключения.{" "}
        {campaignId && "Отметка «раскрыто» относится только к этой кампании."}
      </span>
      {arc.secrets.map((s) => (
        <div key={s.id} className="row" style={{ justifyContent: "space-between" }}>
          <span>
            {campaignId && (
              <input
                type="checkbox"
                checked={s.state?.revealed === 1}
                onChange={(e) => toggle(s.id, e.target.checked)}
              />
            )}{" "}
            <strong>{s.title}</strong>
            <span className="muted"> · {SECRET_KINDS.find((k) => k.key === s.kind)?.label}</span>
            {s.content && (
              <div className="muted">
                <MentionText text={s.content} />
              </div>
            )}
          </span>
          {!campaignId && (
            <button
              className="danger"
              onClick={async () => {
                await api.del(`/story/secrets/${s.id}`);
                onChange();
              }}
            >
              ✕
            </button>
          )}
        </div>
      ))}
      {arc.secrets.length === 0 && <p className="muted">Пока пусто.</p>}
      {!campaignId && (
        <div className="row">
          <select value={kind} onChange={(e) => setKind(e.target.value)}>
            {SECRET_KINDS.map((k) => (
              <option key={k.key} value={k.key}>
                {k.label}
              </option>
            ))}
          </select>
          <input placeholder="Название" value={title} onChange={(e) => setTitle(e.target.value)} />
          <input placeholder="Содержание" value={content} onChange={(e) => setContent(e.target.value)} />
          <button className="primary" onClick={add}>
            Добавить
          </button>
        </div>
      )}
    </div>
  );
}
