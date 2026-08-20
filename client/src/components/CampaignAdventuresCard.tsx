import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import { MentionText } from "./mentions/MentionText";
import { MentionTextarea } from "./mentions/MentionTextarea";
import { syncMentionLinks } from "../mentions";
import { chapterWord, sceneWord } from "../sceneKinds";
import type { StoryArc } from "../types";

// Обзорные тексты приключений кампании: по подблоку на приключение, внутри —
// «Сводка», «Синопсис» и «Завязка». Всё свёрнуто: у книжной кампании таких
// подблоков может быть с десяток, и разворачивать их сразу — тот самый
// бесконечный свиток, от которого профиль кампании и уходил.
//
// Правка здесь не трогает оригинал сеттинга: первая же правка создаёт
// собственную копию приключения для этой кампании (copy-on-write, как у
// сцен), и подблок помечается «правка кампании».

const SUMMARY_FIELDS = [
  { key: "recommended_level", label: "Уровень персонажей" },
  { key: "player_count", label: "Число игроков" },
  { key: "duration", label: "Длительность" },
  { key: "source", label: "Источник" },
  { key: "tags", label: "Теги" },
] as const;

const TEXT_FIELDS = [
  { key: "description", label: "Синопсис", help: "О чём это приключение." },
  { key: "hook", label: "Завязка", help: "Как партия вообще попадает в это приключение." },
] as const;

type Draft = Record<string, string>;

export function CampaignAdventuresCard({
  campaignId,
  settingId,
}: {
  campaignId: number;
  settingId: number | null;
}) {
  const [adventures, setAdventures] = useState<StoryArc[]>([]);
  const [available, setAvailable] = useState<StoryArc[]>([]);
  const [adding, setAdding] = useState(false);

  function refresh() {
    api
      .get<StoryArc[]>(`/story/campaign-adventures?campaign_id=${campaignId}`)
      // «Сцены вне приключений» — служебная корзина сеттинга без синопсиса и
      // завязки; она нужна в разделе «Главы и сцены», а здесь была бы пустым
      // подблоком.
      .then((rows) => setAdventures(rows.filter((a) => a.is_default !== 1)));
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(refresh, [campaignId]);

  async function openAdd() {
    const rows = await api.get<StoryArc[]>(
      `/story/campaign-adventures/available?campaign_id=${campaignId}`
    );
    setAvailable(rows);
    setAdding(true);
  }

  async function attach(arcId: number) {
    await api.post("/story/campaign-adventures", { campaign_id: campaignId, arc_id: arcId });
    setAdding(false);
    refresh();
  }

  async function detach(arc: StoryArc) {
    const warning = arc.has_campaign_edits
      ? `\n\nУ кампании есть свои правки и отметки по этому приключению — они сохранятся и вернутся, если привязать его снова.`
      : "";
    if (!confirm(`Убрать «${arc.name}» из кампании?${warning}`)) return;
    await api.del(`/story/campaign-adventures?campaign_id=${campaignId}&arc_id=${arc.id}`);
    refresh();
  }

  if (settingId == null) {
    return (
      <p className="muted">
        Приключения живут в сеттинге — выберите сеттинг кампании в разделе «Препродакшен».
      </p>
    );
  }

  return (
    <div className="stack">
      <p className="muted">
        Приключения этой кампании. Тексты правятся прямо здесь: правка создаёт версию для кампании,
        оригинал в сеттинге не меняется.
      </p>

      {adventures.map((arc) => (
        <AdventureBlock key={arc.id} arc={arc} campaignId={campaignId} onChange={refresh} onDetach={detach} />
      ))}
      {adventures.length === 0 && <p className="muted">В кампании пока нет приключений.</p>}

      {adding ? (
        <div className="card stack">
          <strong className="entry-title">Добавить приключение из сеттинга</strong>
          <div className="entity-row-list">
            {available.map((a) => (
              <div key={a.id} className="entity-row">
                <span className="entity-row-name">{a.name}</span>
                <span className="muted">
                  {!!a.chapter_count && `${a.chapter_count} ${chapterWord(a.chapter_count)} · `}
                  {a.scene_count} {sceneWord(a.scene_count)}
                  {a.recommended_level && ` · ${a.recommended_level}`}
                </span>
                <span className="entity-row-actions">
                  <button className="primary" onClick={() => attach(a.id)}>
                    Добавить
                  </button>
                </span>
              </div>
            ))}
            {available.length === 0 && (
              <p className="muted">Все приключения сеттинга уже в кампании.</p>
            )}
          </div>
          <button onClick={() => setAdding(false)} style={{ alignSelf: "flex-start" }}>
            Закрыть
          </button>
        </div>
      ) : (
        <div className="row">
          <button className="primary" onClick={openAdd}>
            + Приключение
          </button>
          <Link to={`/import?setting=${settingId}&campaign=${campaignId}`}>
            Импортировать книгу →
          </Link>
        </div>
      )}
    </div>
  );
}

function AdventureBlock({
  arc,
  campaignId,
  onChange,
  onDetach,
}: {
  arc: StoryArc;
  campaignId: number;
  onChange: () => void;
  onDetach: (arc: StoryArc) => void;
}) {
  const [editMode, setEditMode] = useState(false);
  const [draft, setDraft] = useState<Draft>({});

  function startEdit() {
    const next: Draft = {};
    for (const f of [...SUMMARY_FIELDS, ...TEXT_FIELDS]) {
      next[f.key] = (arc as unknown as Record<string, string>)[f.key] ?? "";
    }
    setDraft(next);
    setEditMode(true);
  }

  async function save() {
    await api.put(`/story/arcs/${arc.id}`, { ...draft, campaign_id: campaignId });
    // Меншены в синопсисе и завязке ведут в общий граф связей и висят на
    // оригинале приключения, а не на копии кампании.
    for (const f of TEXT_FIELDS) {
      const before = (arc as unknown as Record<string, string>)[f.key] ?? "";
      if (before !== draft[f.key]) syncMentionLinks("adventure", arc.id, before, draft[f.key] ?? "");
    }
    setEditMode(false);
    onChange();
  }

  async function revert() {
    if (!confirm("Вернуть тексты приключения такими, какие они в сеттинге?")) return;
    await api.post(`/story/arcs/${arc.id}/revert`, { campaign_id: campaignId });
    setEditMode(false);
    onChange();
  }

  const filledSummary = SUMMARY_FIELDS.filter(
    (f) => (arc as unknown as Record<string, string>)[f.key]
  );
  const filledTexts = TEXT_FIELDS.filter((f) => (arc as unknown as Record<string, string>)[f.key]);

  return (
    <details className="card">
      <summary>
        <strong className="entry-title">{arc.name}</strong>
        {arc.is_override && <span className="badge tag"> правка кампании</span>}
      </summary>
      <div className="stack" style={{ marginTop: 8 }}>
        {!editMode ? (
          <>
            {filledSummary.length > 0 && (
              <div className="card stack">
                <strong>Сводка</strong>
                {filledSummary.map((f) => (
                  <div key={f.key} className="row" style={{ justifyContent: "space-between" }}>
                    <span className="muted">{f.label}</span>
                    <span>{(arc as unknown as Record<string, string>)[f.key]}</span>
                  </div>
                ))}
              </div>
            )}
            {filledTexts.map((f) => (
              <div key={f.key} className="card stack">
                <strong>{f.label}</strong>
                <div style={{ whiteSpace: "pre-wrap" }}>
                  <MentionText text={(arc as unknown as Record<string, string>)[f.key]} />
                </div>
              </div>
            ))}
            {filledSummary.length === 0 && filledTexts.length === 0 && (
              <p className="muted">Обзор ещё не заполнен.</p>
            )}
            <div className="row">
              <button className="primary" onClick={startEdit}>
                Редактировать
              </button>
              {arc.is_override && <button onClick={revert}>Вернуть как в сеттинге</button>}
              <button className="danger" onClick={() => onDetach(arc)}>
                Убрать из кампании
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="card stack">
              <strong>Сводка</strong>
              {SUMMARY_FIELDS.map((f) => (
                <div key={f.key} className="row" style={{ justifyContent: "space-between" }}>
                  <span className="muted">{f.label}</span>
                  <input
                    value={draft[f.key] ?? ""}
                    onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))}
                  />
                </div>
              ))}
            </div>
            {TEXT_FIELDS.map((f) => (
              <div key={f.key} className="card stack">
                <strong>{f.label}</strong>
                <span className="muted">{f.help}</span>
                <MentionTextarea
                  value={draft[f.key] ?? ""}
                  onChange={(v) => setDraft((d) => ({ ...d, [f.key]: v }))}
                  rows={4}
                  defaultSettingId={arc.setting_id}
                />
              </div>
            ))}
            <div className="row">
              <button className="primary" onClick={save}>
                Сохранить
              </button>
              <button onClick={() => setEditMode(false)}>Отмена</button>
            </div>
          </>
        )}
      </div>
    </details>
  );
}
