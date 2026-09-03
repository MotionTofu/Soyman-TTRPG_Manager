import { useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api } from "../api/client";
import { MentionText } from "../components/mentions/MentionText";
import { Breadcrumbs } from "../components/Breadcrumbs";
import { EntityTypeChip } from "../components/EntityTypeChip";
import { EditableTextCard } from "../components/EditableTextCard";
import { SectionDropZone } from "../components/SectionDropZone";
import { LazyDetails } from "../components/LazyDetails";
import { SCENE_KINDS, SCENE_STATUSES } from "../sceneKinds";
import type { Setting, StoryScene, StorySceneDetail } from "../types";
import { NavIcon } from "../components/NavIcons";
import "../session.css";
import { useConfirm } from "../hooks/useConfirm";

// Stable references — SectionDropZone is memoized and would re-render on
// every parent render if these were inline literals.
const LOCATION_TYPES = ["location"];
const PLOT_TYPES = ["being", "character", "community"];
const OBSTACLE_TYPES = ["being", "character", "community", "location", "artifact"];
const LOOT_TYPES = ["artifact", "resource", "compendium_entry"];

// A single prepared scene. Opened either from a setting (the original) or
// from a campaign (?campaign=<id>) — in the latter case every edit is routed
// through the copy-on-write layer, so the first change swaps the page over to
// this campaign's own copy and leaves the setting's version alone.
export function SceneDetailPage() {
  const [confirmDialog, confirm] = useConfirm();
  const { id } = useParams();
  const sceneId = Number(id);
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const campaignId = params.get("campaign") ? Number(params.get("campaign")) : null;

  const [scene, setScene] = useState<StorySceneDetail | null>(null);
  const [setting, setSetting] = useState<Setting | null>(null);
  // Нужна только ради имени в «хлебных крошках», когда сцену открыли из кампании.
  const [campaignName, setCampaignName] = useState("");

  const [check, setCheck] = useState({ what: "", difficulty: "", on_success: "", on_failure: "" });
  const [reward, setReward] = useState({ what: "", where_found: "", notes: "" });
  const [transitionTarget, setTransitionTarget] = useState("");
  const [transitionLabel, setTransitionLabel] = useState("");
  const [siblings, setSiblings] = useState<StoryScene[]>([]);

  function refresh() {
    const q = campaignId ? `?campaign_id=${campaignId}` : "";
    api.get<StorySceneDetail>(`/story/scenes/${sceneId}${q}`).then(setScene);
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(refresh, [sceneId, campaignId]);

  useEffect(() => {
    if (!campaignId) return;
    api.get<{ name: string }>(`/campaigns/${campaignId}`).then((c) => setCampaignName(c.name));
  }, [campaignId]);

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

  async function saveNameKind(name: string, kind: string) {
    await save({ name: name.trim(), kind });
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
    if (!(await confirm({ message: "Вернуть сцену к оригиналу из сеттинга? Правки этой кампании пропадут.", confirmLabel: "Вернуть", danger: true })))
      return;
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
    if (!(await confirm({ message: "Отправить сцену в архив?", confirmLabel: "Архивировать", danger: true })))
      return;
    await api.del(`/story/scenes/${sceneId}`);
    if (campaignId) navigate(`/campaigns/${campaignId}?tab=${encodeURIComponent("Главы и сцены")}`);
    else navigate(`/settings/${scene?.setting_id}?tab=${encodeURIComponent("Приключения")}`);
  }

  return (
    <div className="stack scene-detail">
      {confirmDialog}
      {/* Из кампании крошки ведут обратно в её раздел «Главы и сцены», а не
           в сеттинг: мастер пришёл сюда оттуда и туда же возвращается. */}
      <Breadcrumbs
        items={
          campaignId
            ? [
                { label: campaignName || "Кампания", to: `/campaigns/${campaignId}` },
                {
                  label: "Главы и сцены",
                  to: `/campaigns/${campaignId}?tab=${encodeURIComponent("Главы и сцены")}`,
                },
                { label: scene.name },
              ]
            : [
                { label: setting?.name ?? "Сеттинг", to: `/settings/${scene.setting_id}` },
                {
                  label: "Приключения",
                  to: `/settings/${scene.setting_id}?tab=${encodeURIComponent("Приключения")}`,
                },
                { label: scene.name },
              ]
        }
      />

      <div className="entity-header">
        <div className="stack" style={{ flex: 1, minWidth: 0 }}>
          <div className="row" style={{ alignItems: "center", flexWrap: "wrap", gap: 8 }}>
            <h1 style={{ margin: 0, flex: "1 1 auto", minWidth: 0 }}>{scene.name}</h1>
            <EntityTypeChip type="scene" />
            <Link
              to={`/canvas?setting=${scene.setting_id}&arc=${scene.arc_id ?? ""}&focus=scene:${scene.id}`}
              className="graph-neighbourhood-link"
              title="Показать на полотне"
            >
              <NavIcon name="canvas" /> На полотне
            </Link>
            <button className="danger" onClick={archiveScene} style={{ marginLeft: "auto" }}>
              <NavIcon name="archive" /> Архивировать
            </button>
          </div>
          {(scene.kind !== "scene" || scene.is_override || scene.campaign_only) && (
            <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
              {scene.kind !== "scene" && (
                <span className="badge tag">
                  {SCENE_KINDS.find((k) => k.key === scene.kind)?.label}
                </span>
              )}
              {scene.is_override && <span className="badge tag">правка кампании</span>}
              {scene.campaign_only && <span className="badge tag">только в кампании</span>}
            </div>
          )}
          <div className="row" style={{ gap: 12, flexWrap: "wrap", alignItems: "center" }}>
            {campaignId && (
              <>
                <span className="campaign-field-label" style={{ margin: 0 }}>Статус:</span>
                <select value={scene.state?.status ?? "pending"} onChange={(e) => setStatus(e.target.value)}>
                  {SCENE_STATUSES.map((s) => (
                    <option key={s.key} value={s.key}>
                      {s.label}
                    </option>
                  ))}
                </select>
                <span style={{ width: 1, height: 18, background: "var(--line)", display: "inline-block" }} aria-hidden="true" />
              </>
            )}
            <label className="row" style={{ gap: 6, cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={scene.hidden_from_players === 1}
                onChange={(e) => save({ hidden_from_players: e.target.checked })}
              />
              <span className="campaign-field-label" style={{ margin: 0, textTransform: "none", letterSpacing: 0, color: "var(--ink)" }}>Скрыта от игроков</span>
            </label>
          </div>
        </div>
        {scene.is_override && (
          <div className="entity-header-actions" style={{ borderTop: "1px solid var(--line)", paddingTop: 8, marginTop: 4, justifyContent: "flex-end" }}>
            <button onClick={revert}>Вернуть к оригиналу</button>
          </div>
        )}
      </div>

      <EditableTextCard
        title="Описание для мастера"
        value={scene.summary}
        onSave={(v) => save({ summary: v })}
        rows={4}
        entityType="scene"
        entityId={sceneId}
        defaultSettingId={scene.setting_id ?? undefined}
        collapsible
        defaultOpen
        fields={[
          { key: "name", label: "Имя сцены", value: scene.name, required: true },
          {
            key: "kind",
            label: "Вид",
            value: scene.kind,
            options: SCENE_KINDS.map((k) => ({ value: k.key, label: k.label })),
          },
        ]}
        onSaveFields={(v) => saveNameKind(v.name, v.kind)}
      />
      <EditableTextCard
        title="Зачитать игрокам"
        help="Текст, который мастер читает вслух при входе в сцену."
        value={scene.read_aloud}
        onSave={(v) => save({ read_aloud: v })}
        rows={5}
        entityType="scene"
        entityId={sceneId}
        defaultSettingId={scene.setting_id ?? undefined}
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
        defaultSettingId={scene.setting_id ?? undefined}
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
        defaultSettingId={scene.setting_id ?? undefined}
        collapsible
      />
      <EditableTextCard
        title="Возможные исходы"
        value={scene.outcomes}
        onSave={(v) => save({ outcomes: v })}
        rows={4}
        entityType="scene"
        entityId={sceneId}
        defaultSettingId={scene.setting_id ?? undefined}
        collapsible
      />

      <details className="card" open>
        <summary className="campaign-overview-header">Проверки · {scene.checks.length}</summary>
        <div className="stack" style={{ marginTop: 8 }}>
          {scene.checks.map((c) => (
            <div key={c.id} className="row" style={{ justifyContent: "space-between", alignItems: "flex-start", borderBottom: "1px solid var(--line)", paddingBottom: 6 }}>
              <span style={{ maxWidth: "62ch" }}>
                <strong>
                  <MentionText text={c.what} />
                </strong>
                {c.difficulty && <span className="detail-value-mono" style={{ marginLeft: 6 }}>{c.difficulty}</span>}
                {/* Исходы, а не пара «успех/провал»: последствий у проверки
                    столько, сколько назвала система, и правятся они на
                    «Полотне». Здесь список только показывается — иначе
                    страница сцены и холст разошлись бы текстами. */}
                {c.outcomes.map((o) => (
                  <div key={o.id} style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 2 }}>
                    <span className="campaign-field-label" style={{ margin: 0 }}>{o.label}</span>
                    {o.consequence ? <span style={{ maxWidth: "56ch" }}><MentionText text={o.consequence} /></span> : null}
                    {o.target_name && <span className="muted">→ {o.target_name}</span>}
                  </div>
                ))}
              </span>
              <button
                className="danger comp-mini"
                onClick={async () => {
                  await api.del(`/story/checks/${c.id}`);
                  refresh();
                }}
                aria-label="Удалить"
              >
                ✕
              </button>
            </div>
          ))}
          {scene.checks.length === 0 && (
            <div className="card" style={{ borderStyle: "dashed" }}>
              <p className="muted" style={{ maxWidth: "62ch" }}>Проверок нет — добавьте «что проверяем» и сложность. Исходы с последствиями правятся на Полотне.</p>
            </div>
          )}
          <div className="row" style={{ flexWrap: "wrap", gap: 6 }}>
            <input
              placeholder="Что проверяем"
              value={check.what}
              onChange={(e) => setCheck({ ...check, what: e.target.value })}
              style={{ flex: "1 1 160px" }}
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
              style={{ flex: "1 1 140px" }}
            />
            <input
              placeholder="При провале"
              value={check.on_failure}
              onChange={(e) => setCheck({ ...check, on_failure: e.target.value })}
              style={{ flex: "1 1 140px" }}
            />
            <button className="primary" onClick={addCheck} disabled={!check.what.trim()}>
              Добавить
            </button>
          </div>
          <span className="muted" style={{ fontSize: "var(--fs-meta)", maxWidth: "62ch" }}>Два поля «При успехе/при провале» создадут исходы «Успех/Провал» — остальные (3–4) добавляются на Полотне.</span>
        </div>
      </details>

      <details className="card" open>
        <summary className="campaign-overview-header">Награды и лут · {scene.rewards.length}</summary>
        <div className="stack" style={{ marginTop: 8 }}>
          {scene.rewards.map((r) => (
            <div key={r.id} className="row" style={{ justifyContent: "space-between", alignItems: "flex-start", borderBottom: "1px solid var(--line)", paddingBottom: 6 }}>
              <span style={{ maxWidth: "62ch" }}>
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
                  <div className="muted" style={{ maxWidth: "62ch" }}>
                    <MentionText text={r.notes} />
                  </div>
                )}
              </span>
              <button
                className="danger comp-mini"
                onClick={async () => {
                  await api.del(`/story/rewards/${r.id}`);
                  refresh();
                }}
                aria-label="Удалить"
              >
                ✕
              </button>
            </div>
          ))}
          {scene.rewards.length === 0 && (
            <div className="card" style={{ borderStyle: "dashed" }}>
              <p className="muted" style={{ maxWidth: "62ch" }}>Наград нет — что находят и где, с заметкой.</p>
            </div>
          )}
          <div className="row" style={{ flexWrap: "wrap", gap: 6 }}>
            <input
              placeholder="Что"
              value={reward.what}
              onChange={(e) => setReward({ ...reward, what: e.target.value })}
              style={{ flex: "1 1 140px" }}
            />
            <input
              placeholder="Где / у кого"
              value={reward.where_found}
              onChange={(e) => setReward({ ...reward, where_found: e.target.value })}
              style={{ flex: "1 1 140px" }}
            />
            <input
              placeholder="Заметка"
              value={reward.notes}
              onChange={(e) => setReward({ ...reward, notes: e.target.value })}
              style={{ flex: "1 1 140px" }}
            />
            <button className="primary" onClick={addReward} disabled={!reward.what.trim()}>
              Добавить
            </button>
          </div>
        </div>
      </details>

      <div className="sp-prep-row">
        <LazyDetails
          title="Сюжетные персонажи"
          className="card stack sp-card--plot"
          defaultOpen
          style={{ flex: "1 1 280px", minWidth: 260 }}
        >
          <SectionDropZone
            entityType="scene"
            entityId={sceneId}
            section="scene_plot_characters"
            acceptTypes={PLOT_TYPES}
            placeholder="Перетащите сюда существо или персонажа из поиска"
          />
        </LazyDetails>
        <LazyDetails
          title="Локации"
          className="card stack sp-card--location"
          style={{ flex: "1 1 280px", minWidth: 260 }}
          defaultOpen
        >
          <SectionDropZone
            entityType="scene"
            entityId={sceneId}
            section="scene_location"
            acceptTypes={LOCATION_TYPES}
            placeholder="Перетащите сюда локацию из поиска"
          />
        </LazyDetails>
      </div>
      <div className="sp-prep-row">
        <LazyDetails title="Препятствия" className="card stack sp-card--enemies" style={{ flex: "1 1 280px", minWidth: 260 }} defaultOpen>
          <SectionDropZone
            entityType="scene"
            entityId={sceneId}
            section="scene_obstacles"
            acceptTypes={OBSTACLE_TYPES}
            placeholder="Перетащите сюда препятствие — существо, локацию, артефакт…"
          />
        </LazyDetails>
        <LazyDetails
          title="Потенциальный лут"
          className="card stack sp-card--loot"
          style={{ flex: "1 1 280px", minWidth: 260 }}
          defaultOpen
        >
          <SectionDropZone
            entityType="scene"
            entityId={sceneId}
            section="scene_loot"
            acceptTypes={LOOT_TYPES}
            placeholder="Перетащите сюда ресурс, артефакт или предмет из компендиума"
          />
        </LazyDetails>
      </div>
      <SceneAudioCard sceneId={sceneId} />

      <details className="card" open>
        <summary className="campaign-overview-header">Переходы · {scene.transitions.length}</summary>
        <div className="stack" style={{ marginTop: 8 }}>
          {scene.transitions.map((t) => (
            <div key={t.id} className="row" style={{ justifyContent: "space-between", alignItems: "flex-start", borderBottom: "1px solid var(--line)", paddingBottom: 6 }}>
              <span style={{ maxWidth: "62ch" }}>
                Дальше:{" "}
                <a href={`/scenes/${t.to_scene_id}${campaignId ? `?campaign=${campaignId}` : ""}`}>
                  {t.to_scene_name}
                </a>
                {t.label && <span className="muted"> — {t.label}</span>}
              </span>
              <button
                className="danger comp-mini"
                onClick={async () => {
                  await api.del(`/story/transitions/${t.id}`);
                  refresh();
                }}
                aria-label="Удалить"
              >
                ✕
              </button>
            </div>
          ))}
          {scene.transitions.length === 0 && (
            <div className="card" style={{ borderStyle: "dashed" }}>
              <p className="muted" style={{ maxWidth: "62ch" }}>Переходов нет — куда ведёт эта сцена дальше, и на каком условии.</p>
            </div>
          )}
          <div className="row" style={{ flexWrap: "wrap", gap: 6 }}>
            <select value={transitionTarget} onChange={(e) => setTransitionTarget(e.target.value)} style={{ flex: "1 1 160px" }}>
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
              style={{ flex: "1 1 140px" }}
            />
            <button className="primary" onClick={addTransition} disabled={!transitionTarget}>
              Добавить
            </button>
          </div>
        </div>
      </details>
    </div>
  );
}

function SceneAudioCard({ sceneId }: { sceneId: number }) {
  const [sets, setSets] = useState<{ id: number; name: string }[]>([]);
  const [current, setCurrent] = useState<{ id: number; name: string } | null>(null);
  useEffect(() => {
    api.get<{ id: number; name: string }[]>("/sound-sets").then(setSets).catch(() => setSets([]));
    api.get<{ id: number; name: string } | null>(`/story/scenes/${sceneId}/sound-set`).then(setCurrent).catch(() => setCurrent(null));
  }, [sceneId]);
  async function setSound(id: number | null) {
    await api.put(`/story/scenes/${sceneId}/sound-set`, { sound_set_id: id });
    const updated = await api.get<{ id: number; name: string } | null>(`/story/scenes/${sceneId}/sound-set`).catch(() => null);
    setCurrent(updated);
  }
  return (
    <details className="card" open>
      <summary className="campaign-overview-header">Аудионабор</summary>
      <div className="stack" style={{ marginTop: 8 }}>
        <div className="row" style={{ alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <select value={current?.id ?? ""} onChange={(e) => setSound(e.target.value ? Number(e.target.value) : null)} style={{ flex: "1 1 160px" }}>
            <option value="">— без звука —</option>
            {sets.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
          {current && <span className="muted" style={{ fontSize: "var(--fs-meta)" }}>{current.name}</span>}
        </div>
        <p className="muted" style={{ fontSize: "var(--fs-meta)", maxWidth: "62ch" }}>На полотне — тёмно-зелёный ○· вход «Аудио», боевой — бардовый ○· «Бой». Перетащи аудионабор/плейлист на сцену.</p>
      </div>
    </details>
  );
}
