import { useEffect, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api } from "../api/client";
import { MentionText } from "../components/mentions/MentionText";
import { Breadcrumbs } from "../components/Breadcrumbs";
import { EntityTypeChip } from "../components/EntityTypeChip";
import { EditableTextCard } from "../components/EditableTextCard";
import { SectionDropZone } from "../components/SectionDropZone";
import { SCENE_KINDS, SCENE_STATUSES } from "../sceneKinds";
import type { Setting, StoryScene, StorySceneDetail } from "../types";

// Stable references — SectionDropZone is memoized and would re-render on
// every parent render if these were inline literals.
const LOCATION_TYPES = ["location"];
const PARTICIPANT_TYPES = ["being", "character", "community"];
const ITEM_TYPES = ["artifact", "resource", "compendium_entry"];

// A single prepared scene. Opened either from a setting (the original) or
// from a campaign (?campaign=<id>) — in the latter case every edit is routed
// through the copy-on-write layer, so the first change swaps the page over to
// this campaign's own copy and leaves the setting's version alone.
export function SceneDetailPage() {
  const { id } = useParams();
  const sceneId = Number(id);
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const campaignId = params.get("campaign") ? Number(params.get("campaign")) : null;

  const [scene, setScene] = useState<StorySceneDetail | null>(null);
  const [setting, setSetting] = useState<Setting | null>(null);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [kindDraft, setKindDraft] = useState("scene");

  const [check, setCheck] = useState({ what: "", difficulty: "", on_success: "", on_failure: "" });
  const [reward, setReward] = useState({ what: "", where_found: "", notes: "" });
  const [transitionTarget, setTransitionTarget] = useState("");
  const [transitionLabel, setTransitionLabel] = useState("");
  const [siblings, setSiblings] = useState<StoryScene[]>([]);

  function refresh() {
    const q = campaignId ? `?campaign_id=${campaignId}` : "";
    api.get<StorySceneDetail>(`/story/scenes/${sceneId}${q}`).then((s) => {
      setScene(s);
      setNameDraft(s.name);
      setKindDraft(s.kind);
    });
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(refresh, [sceneId, campaignId]);

  useEffect(() => {
    if (!scene) return;
    api.get<Setting>(`/settings/${scene.setting_id}`).then(setSetting);
    const q = new URLSearchParams({ setting_id: String(scene.setting_id) });
    if (campaignId) q.set("campaign_id", String(campaignId));
    api.get<StoryScene[]>(`/story/scenes?${q.toString()}`).then(setSiblings);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene?.setting_id, campaignId]);

  if (!scene) return <p className="muted">Загрузка…</p>;

  // Every write carries campaign_id so the server can decide whether it lands
  // on the original or on this campaign's copy. The response may be a
  // different row than the one we opened — hence the navigate() below.
  async function save(patch: Record<string, unknown>) {
    const updated = await api.put<StoryScene>(`/story/scenes/${sceneId}`, {
      ...patch,
      campaign_id: campaignId,
    });
    if (updated.id !== sceneId) {
      navigate(`/scenes/${updated.id}?campaign=${campaignId}`, { replace: true });
      return;
    }
    refresh();
  }

  async function saveName() {
    if (!nameDraft.trim()) return;
    await save({ name: nameDraft.trim(), kind: kindDraft });
    setEditingName(false);
  }

  async function addCheck() {
    if (!check.what.trim()) return;
    await api.post(`/story/scenes/${sceneId}/checks`, { ...check, campaign_id: campaignId });
    setCheck({ what: "", difficulty: "", on_success: "", on_failure: "" });
    refresh();
  }

  async function addReward() {
    if (!reward.what.trim()) return;
    await api.post(`/story/scenes/${sceneId}/rewards`, { ...reward, campaign_id: campaignId });
    setReward({ what: "", where_found: "", notes: "" });
    refresh();
  }

  async function addTransition() {
    if (!transitionTarget) return;
    await api.post(`/story/scenes/${sceneId}/transitions`, {
      to_scene_id: Number(transitionTarget),
      label: transitionLabel,
      campaign_id: campaignId,
    });
    setTransitionTarget("");
    setTransitionLabel("");
    refresh();
  }

  async function revert() {
    if (!confirm("Вернуть сцену к оригиналу из сеттинга? Правки этой кампании пропадут.")) return;
    await api.post(`/story/scenes/${sceneId}/revert`, { campaign_id: campaignId });
    navigate(`/scenes/${scene?.source_scene_id ?? sceneId}?campaign=${campaignId}`, {
      replace: true,
    });
  }

  async function setStatus(status: string) {
    if (!campaignId) return;
    await api.put(`/story/scenes/${sceneId}/state`, { campaign_id: campaignId, status });
    refresh();
  }

  async function archiveScene() {
    if (!confirm("Отправить сцену в архив?")) return;
    await api.del(`/story/scenes/${sceneId}`);
    navigate(`/settings/${scene?.setting_id}?tab=${encodeURIComponent("Приключения")}`);
  }

  return (
    <div className="stack">
      <Breadcrumbs
        items={[
          { label: setting?.name ?? "Сеттинг", to: `/settings/${scene.setting_id}` },
          {
            label: "Приключения",
            to: `/settings/${scene.setting_id}?tab=${encodeURIComponent("Приключения")}`,
          },
          { label: scene.name },
        ]}
      />

      <div className="entity-header">
        <div className="stack">
          {editingName ? (
            <div className="row">
              <input value={nameDraft} onChange={(e) => setNameDraft(e.target.value)} />
              <select value={kindDraft} onChange={(e) => setKindDraft(e.target.value)}>
                {SCENE_KINDS.map((k) => (
                  <option key={k.key} value={k.key}>
                    {k.label}
                  </option>
                ))}
              </select>
              <button className="primary" onClick={saveName}>
                Сохранить
              </button>
              <button onClick={() => setEditingName(false)}>Отмена</button>
            </div>
          ) : (
            <div className="stack">
              <h2>{scene.name}</h2>
              <div className="row">
                <EntityTypeChip type="scene" />
                {/* The chip already reads "Сцена" — only a non-default kind
                    adds information worth a second badge. */}
                {scene.kind !== "scene" && (
                  <span className="badge tag">
                    {SCENE_KINDS.find((k) => k.key === scene.kind)?.label}
                  </span>
                )}
                {scene.is_override && <span className="badge tag">изменено в этой кампании</span>}
                {scene.campaign_only && <span className="badge tag">только в этой кампании</span>}
                {scene.hidden_from_players === 1 && (
                  <span className="muted">скрыта от игроков</span>
                )}
              </div>
              {campaignId && (
                <div className="row">
                  <span className="muted">Статус прохождения:</span>
                  <select value={scene.state?.status ?? "pending"} onChange={(e) => setStatus(e.target.value)}>
                    {SCENE_STATUSES.map((s) => (
                      <option key={s.key} value={s.key}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          )}
        </div>
        <div className="entity-header-actions">
          <button onClick={() => setEditingName(true)}>Редактировать</button>
          <label className="row">
            <input
              type="checkbox"
              checked={scene.hidden_from_players === 1}
              onChange={(e) => save({ hidden_from_players: e.target.checked })}
            />
            Скрыта от игроков
          </label>
          {scene.is_override && (
            <button onClick={revert}>Вернуть к оригиналу</button>
          )}
          <button className="danger" onClick={archiveScene}>
            Архивировать
          </button>
        </div>
      </div>

      <EditableTextCard
        title="Описание для мастера"
        value={scene.summary}
        onSave={(v) => save({ summary: v })}
        rows={4}
        entityType="scene"
        entityId={sceneId}
        defaultSettingId={scene.setting_id}
        collapsible
        defaultOpen
      />
      <EditableTextCard
        title="Зачитать игрокам"
        help="Текст, который мастер читает вслух при входе в сцену."
        value={scene.read_aloud}
        onSave={(v) => save({ read_aloud: v })}
        rows={5}
        entityType="scene"
        entityId={sceneId}
        defaultSettingId={scene.setting_id}
        collapsible
        defaultOpen
      />
      <EditableTextCard
        title="Что происходит"
        value={scene.whats_happening}
        onSave={(v) => save({ whats_happening: v })}
        rows={5}
        entityType="scene"
        entityId={sceneId}
        defaultSettingId={scene.setting_id}
        collapsible
        defaultOpen
      />
      <EditableTextCard
        title="Условие входа"
        help="Что должно произойти, чтобы сцена началась."
        value={scene.entry_condition}
        onSave={(v) => save({ entry_condition: v })}
        rows={3}
        entityType="scene"
        entityId={sceneId}
        defaultSettingId={scene.setting_id}
        collapsible
      />
      <EditableTextCard
        title="Возможные исходы"
        value={scene.outcomes}
        onSave={(v) => save({ outcomes: v })}
        rows={4}
        entityType="scene"
        entityId={sceneId}
        defaultSettingId={scene.setting_id}
        collapsible
      />

      <details className="card" open>
        <summary className="sb-section" style={{ margin: 0 }}>
          Проверки ({scene.checks.length})
        </summary>
        <div className="stack" style={{ marginTop: 8 }}>
          {scene.checks.map((c) => (
            <div key={c.id} className="row" style={{ justifyContent: "space-between" }}>
              <span>
                <strong>
                  <MentionText text={c.what} />
                </strong>
                {c.difficulty && <span className="muted"> · {c.difficulty}</span>}
                {c.on_success && (
                  <div className="muted">
                    Успех: <MentionText text={c.on_success} />
                  </div>
                )}
                {c.on_failure && (
                  <div className="muted">
                    Провал: <MentionText text={c.on_failure} />
                  </div>
                )}
              </span>
              <button
                className="danger"
                onClick={async () => {
                  await api.del(`/story/checks/${c.id}`);
                  refresh();
                }}
              >
                ✕
              </button>
            </div>
          ))}
          {scene.checks.length === 0 && <p className="muted">Проверок нет.</p>}
          <div className="row">
            <input
              placeholder="Что проверяем"
              value={check.what}
              onChange={(e) => setCheck({ ...check, what: e.target.value })}
            />
            <input
              placeholder="Сложность"
              style={{ width: 120 }}
              value={check.difficulty}
              onChange={(e) => setCheck({ ...check, difficulty: e.target.value })}
            />
            <input
              placeholder="При успехе"
              value={check.on_success}
              onChange={(e) => setCheck({ ...check, on_success: e.target.value })}
            />
            <input
              placeholder="При провале"
              value={check.on_failure}
              onChange={(e) => setCheck({ ...check, on_failure: e.target.value })}
            />
            <button className="primary" onClick={addCheck}>
              Добавить
            </button>
          </div>
        </div>
      </details>

      <details className="card" open>
        <summary className="sb-section" style={{ margin: 0 }}>
          Награды и лут ({scene.rewards.length})
        </summary>
        <div className="stack" style={{ marginTop: 8 }}>
          {scene.rewards.map((r) => (
            <div key={r.id} className="row" style={{ justifyContent: "space-between" }}>
              <span>
                <strong>
                  <MentionText text={r.what} />
                </strong>
                {r.where_found && (
                  <span className="muted">
                    {" · "}
                    <MentionText text={r.where_found} />
                  </span>
                )}
                {r.notes && (
                  <div className="muted">
                    <MentionText text={r.notes} />
                  </div>
                )}
              </span>
              <button
                className="danger"
                onClick={async () => {
                  await api.del(`/story/rewards/${r.id}`);
                  refresh();
                }}
              >
                ✕
              </button>
            </div>
          ))}
          {scene.rewards.length === 0 && <p className="muted">Наград нет.</p>}
          <div className="row">
            <input
              placeholder="Что"
              value={reward.what}
              onChange={(e) => setReward({ ...reward, what: e.target.value })}
            />
            <input
              placeholder="Где / у кого"
              value={reward.where_found}
              onChange={(e) => setReward({ ...reward, where_found: e.target.value })}
            />
            <input
              placeholder="Заметка"
              value={reward.notes}
              onChange={(e) => setReward({ ...reward, notes: e.target.value })}
            />
            <button className="primary" onClick={addReward}>
              Добавить
            </button>
          </div>
        </div>
      </details>

      <div className="card stack">
        <strong className="entry-title">Участники, места и предметы</strong>
        <SectionDropZone
          entityType="scene"
          entityId={sceneId}
          section="scene_location"
          acceptTypes={LOCATION_TYPES}
          placeholder="Перетащите локации сцены"
        />
        <SectionDropZone
          entityType="scene"
          entityId={sceneId}
          section="scene_participants"
          acceptTypes={PARTICIPANT_TYPES}
          placeholder="Перетащите участников: личностей, сообщества, персонажей"
        />
        <SectionDropZone
          entityType="scene"
          entityId={sceneId}
          section="scene_items"
          acceptTypes={ITEM_TYPES}
          placeholder="Перетащите предметы и материалы сцены"
        />
      </div>

      <details className="card" open>
        <summary className="sb-section" style={{ margin: 0 }}>
          Переходы ({scene.transitions.length})
        </summary>
        <div className="stack" style={{ marginTop: 8 }}>
          {scene.transitions.map((t) => (
            <div key={t.id} className="row" style={{ justifyContent: "space-between" }}>
              <span>
                Дальше:{" "}
                <a href={`/scenes/${t.to_scene_id}${campaignId ? `?campaign=${campaignId}` : ""}`}>
                  {t.to_scene_name}
                </a>
                {t.label && <span className="muted"> — {t.label}</span>}
              </span>
              <button
                className="danger"
                onClick={async () => {
                  await api.del(`/story/transitions/${t.id}`);
                  refresh();
                }}
              >
                ✕
              </button>
            </div>
          ))}
          {scene.transitions.length === 0 && <p className="muted">Переходов нет.</p>}
          <div className="row">
            <select value={transitionTarget} onChange={(e) => setTransitionTarget(e.target.value)}>
              <option value="">Следующая сцена…</option>
              {siblings
                .filter((s) => s.id !== sceneId)
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
            </select>
            <input
              placeholder="Условие перехода"
              value={transitionLabel}
              onChange={(e) => setTransitionLabel(e.target.value)}
            />
            <button className="primary" onClick={addTransition}>
              Добавить
            </button>
          </div>
        </div>
      </details>
    </div>
  );
}
