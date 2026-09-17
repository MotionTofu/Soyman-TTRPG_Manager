import { Link } from "react-router-dom";
import { useResource } from "../data/hooks";
import { chapterWord, sceneWord } from "../sceneKinds";
import { MentionText } from "./mentions/MentionText";
import { BEING_CATEGORIES } from "../beingCategories";
import type { StoryArc, StoryArcDetail } from "../types";

// Превью приключения в правой колонке списка сеттинга: всё со страницы
// «Обзор» плюс то, что отвечает на вопросы планирования — в каких кампаниях
// участвует, сколько глав/сцен/вех/тайн, ключевые НПЦ и магические предметы.
// Только чтение: правится всё в самом приключении.
const NO_CAMPAIGNS: { id: number; name: string }[] = [];

export function AdventurePreview({
  arc,
  editable,
  onOpen,
  onRename,
  onArchive,
  onExport,
}: {
  arc: StoryArc;
  editable: boolean;
  onOpen: () => void;
  onRename: () => void;
  onArchive: () => void;
  onExport: () => void;
}) {
  // Превью — под ключами слоя: правка приключения (`{ kind: "adventure", id }`)
  // задевает и карточку, и список его кампаний.
  const detailState = useResource<StoryArcDetail>(`/story/arcs/${arc.id}`);
  const campaignsState = useResource<{ id: number; name: string }[]>(`/story/arcs/${arc.id}/campaigns`);
  const detail = detailState.data ?? null;
  const campaigns = campaignsState.data ?? NO_CAMPAIGNS;
  const loadError = detailState.error ?? campaignsState.error;
  function load() {
    if (detailState.error) detailState.reload();
    if (campaignsState.error) campaignsState.reload();
  }

  if (loadError) {
    return (
      <div className="stack">
        <span>Не удалось загрузить превью: {loadError}</span>
        <button onClick={load} style={{ alignSelf: "flex-start" }}>
          Повторить
        </button>
      </div>
    );
  }
  if (!detail) return <p className="muted">Загружаю превью…</p>;

  const summary: { label: string; value: string }[] = [
    { label: "Уровень персонажей", value: detail.recommended_level },
    { label: "Число игроков", value: detail.player_count },
    { label: "Длительность", value: detail.duration },
    { label: "Источник", value: detail.source },
    { label: "Теги", value: detail.tags },
  ].filter((f) => f.value?.trim());

  const secretsByKind = (key: string) => detail.secrets.filter((s) => s.kind === key).length;
  const magicItems = detail.rewards.filter((r) => r.artifact_id != null && r.artifact_name);

  return (
    <div className="stack">
      <div className="row" style={{ justifyContent: "space-between", alignItems: "baseline" }}>
        <strong className="entry-title">{detail.name}</strong>
        <span
          className="muted"
          style={{ fontFamily: "var(--font-mono)", fontSize: "var(--fs-meta)", whiteSpace: "nowrap" }}
        >
          {detail.chapters.length} {chapterWord(detail.chapters.length)} · {detail.scenes.length}{" "}
          {sceneWord(detail.scenes.length)} · {detail.milestones.length} вех · {secretsByKind("secret")}{" "}
          тайн · {secretsByKind("clue")} улик · {secretsByKind("thread")} нитей
        </span>
      </div>

      {summary.length > 0 && (
        <table className="detail-table">
          <tbody>
            {summary.map((f) => (
              <tr key={f.label}>
                <td className="detail-label">{f.label}</td>
                <td>
                  <span className="detail-value-mono">{f.value}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {detail.description?.trim() && (
        <div className="stack" style={{ gap: 4 }}>
          <span className="campaign-field-label" style={{ color: "var(--ink)" }}>
            Логлайн
          </span>
          <div style={{ whiteSpace: "pre-wrap" }}>
            <MentionText text={detail.description} />
          </div>
        </div>
      )}
      {detail.hook?.trim() && (
        <div className="stack" style={{ gap: 4 }}>
          <span className="campaign-field-label" style={{ color: "var(--ink)" }}>
            Завязка
          </span>
          <div style={{ whiteSpace: "pre-wrap" }}>
            <MentionText text={detail.hook} />
          </div>
        </div>
      )}

      <div className="stack" style={{ gap: 4 }}>
        <span className="campaign-field-label" style={{ color: "var(--ink)" }}>
          Кампании
        </span>
        {campaigns.length > 0 ? (
          <span className="row" style={{ gap: 6, flexWrap: "wrap" }}>
            {campaigns.map((c) => (
              <Link key={c.id} to={`/campaigns/${c.id}`}>
                {c.name}
              </Link>
            ))}
          </span>
        ) : (
          <span className="muted">Ни в одной кампании</span>
        )}
      </div>

      <div className="stack" style={{ gap: 4 }}>
        <span className="campaign-field-label" style={{ color: "var(--ink)" }}>
          Ключевые лица
        </span>
        {detail.key_npcs.length > 0 ? (
          <span className="row" style={{ gap: 6, flexWrap: "wrap" }}>
            {detail.key_npcs.map((n) => (
              <Link key={n.id} to={`/beings/${n.id}`} title={BEING_CATEGORIES.find((c) => c.key === n.category)?.label ?? n.category}>
                {n.name}
              </Link>
            ))}
          </span>
        ) : (
          <span className="muted">Нет</span>
        )}
      </div>

      <div className="stack" style={{ gap: 4 }}>
        <span className="campaign-field-label" style={{ color: "var(--ink)" }}>
          Магические предметы
        </span>
        {magicItems.length > 0 ? (
          <div className="entity-row-list">
            {magicItems.map((r) => (
              <div key={r.id} className="entity-row">
                <Link to={`/artifacts/${r.artifact_id}`} className="entity-row-name">
                  {r.artifact_name}
                </Link>
                {r.scene_name && <span className="muted">· {r.scene_name}</span>}
              </div>
            ))}
          </div>
        ) : (
          <span className="muted">Нет</span>
        )}
      </div>

      <div className="row" style={{ flexWrap: "wrap" }}>
        <button className="primary" onClick={onOpen}>
          Открыть
        </button>
        <button onClick={onExport}>Выгрузить в файл</button>
        {editable && (
          <>
            <button onClick={onRename}>Переименовать</button>
            <button className="danger" onClick={onArchive}>
              Архивировать
            </button>
          </>
        )}
      </div>
    </div>
  );
}
