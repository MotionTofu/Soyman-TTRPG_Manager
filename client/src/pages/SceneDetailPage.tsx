import { useEffect, useState } from "react";
import { SCENE_SEARCH_LABELS } from "@shared/searchText";
import { settingAdventuresPath } from "../layout/useSettingCrumbs";
import { Link, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useAction, useResource, write } from "../data/hooks";
import type { Affect } from "../data/entities";
import { MentionText } from "../components/mentions/MentionText";
import { EntityPage } from "../components/EntityPage";
import { SectionDropZone } from "../components/SectionDropZone";
import { NODE_ROLES, NODE_TYPES, SCENE_STATUSES, nodeLabel } from "../sceneKinds";
import type { Setting, StoryArc, StoryScene, StorySceneDetail } from "../types";
import { ContextMenu } from "../components/ContextMenu";
import { NavIcon } from "../components/NavIcons";
import { ProfileHero, ProfileText, ProfileBlock, ProfileEntityLink } from "../components/profiles/ProfileParts";
import { SceneTable, SceneLinks, SceneMaterials, SceneClueSummary, SCENE_TABS, SCENE_TAB_ALIASES, sceneCanvasHref, useSceneProfileCounts, type SceneProfileClues } from "../components/profiles/SceneProfile";
import { sceneSession, originalSceneHref } from "../components/profiles/sceneProgress";
import { campaignPaths, sceneStatusAffects } from "../data/campaigns";
import { arcCluesPath } from "../data/canvas";
import { TYPE_GRAPH_VIEW } from "../graphTypes";
import type { ArcClues, CampaignAdventureTree, ScenePresentation } from "../types";
import { LoadErrorCard } from "../components/Loadable";
import { useTabState } from "../hooks/useTabState";
import "../session.css";
import "../components/profiles/scene-adventure.css";
import { useConfirm } from "../hooks/useConfirm";
import { findSearchRange, searchJump, showSearchRange } from "../searchHighlight";

// Лист — всё, что нужно за столом; фон, карты и звук готовятся отдельно.
// «Связи» — откуда сюда приходят (гриллинг 2026-10-02, Q13, доска 35).


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
  const location = useLocation();
  const [params] = useSearchParams();
  const campaignId = params.get("campaign") ? Number(params.get("campaign")) : null;

  const sceneState = useResource<StorySceneDetail>(`/story/scenes/${sceneId}${campaignId ? `?campaign_id=${campaignId}` : ""}`);
  const scene = sceneState.data ?? null;
  const originalScene = useResource<Pick<StoryScene, "created_at">>(scene?.source_scene_id ? `/story/scenes/${scene.source_scene_id}` : null).data;
  const adventure = useResource<StoryArc>(scene?.arc_id ? `/story/arcs/${scene.arc_id}` : null).data;
  const setting = useResource<Setting>(scene ? `/settings/${scene.setting_id}` : null).data ?? null;
  // Нужна только ради имени в «хлебных крошках», когда сцену открыли из кампании.
  const campaignName = useResource<{ name: string }>(campaignId ? `/campaigns/${campaignId}` : null).data?.name ?? "";
  const siblingsQuery = scene
    ? new URLSearchParams({ setting_id: String(scene.setting_id), ...(campaignId ? { campaign_id: String(campaignId) } : {}) }).toString()
    : null;
  const siblings = useResource<StoryScene[]>(siblingsQuery ? `/story/scenes?${siblingsQuery}` : null).data ?? [];
  const run = useAction();

  const [check, setCheck] = useState({ what: "", difficulty: "", on_success: "", on_failure: "" });
  const [reward, setReward] = useState({ what: "", where_found: "", notes: "" });
  const [transitionTarget, setTransitionTarget] = useState("");
  const [transitionLabel, setTransitionLabel] = useState("");
  const [addingTransition, setAddingTransition] = useState(false);
  // каркас в обход намеренно — «Лист» первым сохранён по Scene-Sheet v74; каркас профиля общий.
  const [tab, selectTab] = useTabState(SCENE_TABS, "Лист", SCENE_TAB_ALIASES);
  const parentAdventure = useResource<StoryArc>(adventure?.parent_id ? `/story/arcs/${adventure.parent_id}` : null).data;
  const presentation = useResource<ScenePresentation>(scene ? `/story/scenes/${scene.id}/presentation${campaignId ? `?campaign_id=${campaignId}` : ""}` : null).data;
  const clueState = useResource<SceneProfileClues>(scene ? `/story/scenes/${scene.id}/profile-clues${campaignId ? `?campaign_id=${campaignId}` : ""}` : null);
  const counts = useSceneProfileCounts(scene, campaignId, presentation, clueState.data);
  const graph = useResource<ArcClues>(scene?.arc_id ? arcCluesPath(scene.arc_id, campaignId) : null).data;
  const tree = useResource<CampaignAdventureTree[]>(campaignId ? campaignPaths.tree(campaignId) : null).data;
  const [statusMenu, setStatusMenu] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const field = new URLSearchParams(location.search).get("field");
    const jump = searchJump(location.search);
    if (!scene || tab !== "Лист" || !field || !Object.hasOwn(SCENE_SEARCH_LABELS, field) || !jump) return;
    let cleanup: (() => void) | undefined;
    const frame = requestAnimationFrame(() => {
      const target = document.querySelector<HTMLElement>(`[data-scene-search="${field}"]`);
      const range = target && findSearchRange(target, jump, true);
      if (range) cleanup = showSearchRange(range);
      else target?.scrollIntoView({ block: "center" });
    });
    return () => { cancelAnimationFrame(frame); cleanup?.(); };
  }, [location.search, location.key, scene, tab]);

  if (sceneState.error && !scene) {
    return <LoadErrorCard message={<>Не удалось загрузить сцену: {sceneState.error}</>} onRetry={sceneState.reload} />;
  }
  if (!scene) return <p className="muted">Загрузка…</p>;

  // Сцена видна в своём приключении, на полотне, в дереве сцен и на пульте
  // сессии. Копия кампании появляется при первой правке — поэтому задеты
  // сцены целиком, а не одна эта.
  const affects: Affect[] = [{ kind: "scene" }, { kind: "adventure" }, { path: "/sessions" }, { path: "/canvas" }];

  // Every write carries campaign_id so the server can decide whether it lands
  // on the original or on this campaign's copy. The response may be a
  // different row than the one we opened — hence the navigate() below.
  // Карточки полей держат правку открытой, пока сохранение не удалось: для
  // этого им нужна ошибка, а плашку показывает слой.
  async function save(patch: Record<string, unknown>) {
    const body = { ...patch, campaign_id: campaignId };
    const updated = await run(() => write.put<StoryScene>(`/story/scenes/${sceneId}`, body), { affects });
    if (!updated) throw new Error("Не сохранилось");
    if (updated.id !== sceneId) navigate(`/scenes/${updated.id}?campaign=${campaignId}${tab !== "Лист" ? `&tab=${encodeURIComponent(tab)}` : ""}`, { replace: true });
  }

  function saveQuietly(patch: Record<string, unknown>) {
    save(patch).catch(() => {
      // Плашку уже показал слой.
    });
  }

  async function addCheck() {
    if (!check.what.trim()) return;
    // Без «Повторить»: повтор после потерянного ответа завёл бы проверку дважды.
    // Набранное остаётся в полях.
    const body = { ...check, campaign_id: campaignId };
    const done = await run(() => write.post(`/story/scenes/${sceneId}/checks`, body).then(() => true), { affects, retry: false });
    if (done) setCheck({ what: "", difficulty: "", on_success: "", on_failure: "" });
  }

  async function addReward() {
    if (!reward.what.trim()) return;
    const body = { ...reward, campaign_id: campaignId };
    const done = await run(() => write.post(`/story/scenes/${sceneId}/rewards`, body).then(() => true), { affects, retry: false });
    if (done) setReward({ what: "", where_found: "", notes: "" });
  }

  async function addTransition() {
    if (!transitionTarget) return;
    const body = { to_scene_id: Number(transitionTarget), label: transitionLabel, campaign_id: campaignId };
    const done = await run(() => write.post(`/story/scenes/${sceneId}/transitions`, body).then(() => true), {
      affects,
      retry: false,
    });
    if (!done) return;
    setTransitionTarget("");
    setTransitionLabel("");
    setAddingTransition(false);
  }

  async function revert() {
    if (!(await confirm({ message: "Вернуть сцену к оригиналу из сеттинга? Правки этой кампании пропадут.", confirmLabel: "Вернуть", danger: true })))
      return;
    const done = await run(() => write.post(`/story/scenes/${sceneId}/revert`, { campaign_id: campaignId }).then(() => true), { affects });
    if (!done) return;
    navigate(`/scenes/${scene?.source_scene_id ?? sceneId}?campaign=${campaignId}`, {
      replace: true,
    });
  }

  async function setStatus(status: string) {
    if (!campaignId) return;
    const shownId = scene?.id ?? sceneId;
    await run(() => write.put(`/story/scenes/${shownId}/state`, { campaign_id: campaignId, status }), {
      affects: [...sceneStatusAffects(campaignId, shownId), { path: `/story/scenes/${sceneId}` }],
    });
  }

  async function archiveScene() {
    if (!(await confirm({ message: "Отправить сцену в архив?", confirmLabel: "Архивировать", danger: true })))
      return;
    const done = await run(() => write.del(`/story/scenes/${sceneId}`).then(() => true), { affects });
    if (!done) return;
    if (campaignId) navigate(`/campaigns/${campaignId}?tab=${encodeURIComponent("Главы и сцены")}`);
    else navigate(`/settings/${scene?.setting_id}?tab=${encodeURIComponent("Приключения")}`);
  }

  const peerScenes = siblings.filter((s) => s.arc_id === scene.arc_id);
  const peerIndex = peerScenes.findIndex((s) => s.id === scene.id || s.id === scene.source_scene_id);
  const neighbour = (offset: number) => { const row = peerIndex < 0 ? undefined : peerScenes[peerIndex + offset]; return row ? { name: row.name, href: `/scenes/${row.id}${campaignId ? `?campaign=${campaignId}` : ""}` } : undefined; };
  const treeScene = tree?.flatMap((a) => [...a.scenes, ...a.chapters.flatMap((c) => c.scenes)]).find((s) => s.id === scene.id);
  const session = treeScene ? sceneSession(treeScene) : null;
  const canvas = sceneCanvasHref(scene, campaignId);
  const fieldProps = { entityType: "scene", entityId: scene.id, defaultSettingId: scene.setting_id ?? undefined };
  return (
    <EntityPage
      crumbs={
        // Из кампании крошки ведут обратно в её раздел «Главы и сцены», а не
        // в сеттинг: мастер пришёл сюда оттуда и туда же возвращается.
        campaignId
          ? [
              { label: "Кампании", to: "/campaigns" },
              { label: campaignName || "Кампания", to: `/campaigns/${campaignId}` },
              {
                label: "Главы и сцены",
                to: `/campaigns/${campaignId}?tab=${encodeURIComponent("Главы и сцены")}`,
              },
              ...(scene.arc_id ? [{ label: adventure?.name ?? "Приключение", to: `/adventures/${scene.arc_id}?campaign=${campaignId}&tab=${encodeURIComponent("Главы и сцены")}` }] : []),
              { label: scene.name },
            ]
          : [
              { label: "Сеттинги", to: "/settings" },
              ...(scene.setting_id ? [{ label: setting?.name ?? "Сеттинг", to: `/settings/${scene.setting_id}` },
              {
                label: "Приключения",
                to: settingAdventuresPath(scene.setting_id, adventure?.parent_id ?? scene.arc_id ?? undefined),
              }] : []),
              ...(scene.arc_id ? [{ label: adventure?.name ?? "Приключение", to: `/adventures/${scene.arc_id}?tab=${encodeURIComponent("Главы и сцены")}` }] : []),
              { label: scene.name },
            ]
      }
      entityType="scene"
      title={scene.name}
      profile={{ id: scene.id, previous: neighbour(-1), next: neighbour(1) }}
      actions={[
        { label: "На холсте", onClick: () => navigate(canvas) },
        { label: "Показать в графе", onClick: () => navigate(`/graph/${TYPE_GRAPH_VIEW.scene ?? "world"}?focus=scene:${scene.id}&depth=2`) },
        ...(campaignId && scene.is_override ? [{ label: "Вернуть к оригиналу", onClick: revert }] : []),
        { label: "Архивировать", danger: true, onClick: archiveScene },
      ]}
      tabs={SCENE_TABS.map((id) => ({ id, count: id === "Материалы" ? counts.materials : id === "Связи" ? counts.links : undefined }))}
      tab={tab}
      onTab={(t) => selectTab(t as (typeof SCENE_TABS)[number])}
      overlays={<>{confirmDialog}{statusMenu && <ContextMenu x={statusMenu.x} y={statusMenu.y} title="Статус сцены" items={SCENE_STATUSES.map((s) => ({ label: s.label, onClick: () => void setStatus(s.key) }))} onClose={() => setStatusMenu(null)} />}</>}
    >
      {tab === "Лист" && <>
        <ProfileHero type="scene" name={scene.name} subtype={nodeLabel(scene)} createdAt={scene.source_scene_id ? originalScene?.created_at : scene.created_at}
          image={presentation?.background_url ?? presentation?.layers[0]?.image_url}
          coverLabel={presentation?.background_url || presentation?.layers.length ? "Картинка показа · щелчок — Материалы" : "+ картинка показа"}
          onGallery={() => selectTab("Материалы")}
          labels={<>
            {parentAdventure && <><ProfileEntityLink type="adventure" id={parentAdventure.id} name={parentAdventure.name} to={`/adventures/${parentAdventure.id}${campaignId ? `?campaign=${campaignId}` : ""}`} /><span>›</span></>}
            {adventure && <ProfileEntityLink type="adventure" id={adventure.id} name={adventure.name} to={`/adventures/${adventure.id}${campaignId ? `?campaign=${campaignId}` : ""}`} />}
            {campaignId && <button className={`gch scene-profile-status is-${scene.state?.status ?? "pending"}`} onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setStatusMenu({ x: r.left, y: r.bottom }); }}>{SCENE_STATUSES.find((s) => s.key === (scene.state?.status ?? "pending"))?.label} ▾</button>}
            {session?.label && <span className="gch">{session.label}</span>}
            {scene.is_override && <Link className="gch" to={originalSceneHref(scene)}>правка кампании ›</Link>}
            {scene.campaign_only && <span className="gch">только в кампании</span>}
          </>}>
          <ProfileText {...fieldProps} title="В двух словах" value={scene.summary} searchField="summary" onSave={(v) => save({ summary: v })} focal
            fields={[
              { key: "name", label: "Имя сцены", value: scene.name, required: true },
              { key: "node_type", label: "Тип узла", value: scene.node_type ?? "", options: [{ value: "", label: "—" }, ...NODE_TYPES.map((t) => ({ value: t.key, label: t.label }))] },
              { key: "node_role", label: "Роль", value: scene.node_role, options: NODE_ROLES.map((r) => ({ value: r.key, label: r.label })) },
            ]} onSaveFields={(v) => save({ name: v.name.trim(), node_type: v.node_type || null, node_role: v.node_role })} />
        </ProfileHero>
        <div className="profile-visibility scene-profile-visibility"><NavIcon name="eye" /><span className="profile-visibility__label">Игрокам</span><span className="scene-profile-visibility__note">{scene.hidden_from_players ? "сцена не видна в журнале игроков" : "сцена видна в журнале игроков"}</span><button className="profile-text-link" onClick={() => saveQuietly({ hidden_from_players: !scene.hidden_from_players })}>{scene.hidden_from_players ? "скрыто" : "открыто"} ›</button></div>
        <div className="scene-profile-read"><ProfileText {...fieldProps} title="Зачитать игрокам" value={scene.read_aloud} searchField="read_aloud" onSave={(v) => save({ read_aloud: v })} emptyLabel="Текст для чтения вслух при входе в сцену." /></div>
        <SceneTable scene={scene} onSave={save} />
        <ProfileBlock title="Состав"><div className="scene-profile-cast">
          <section><h3>Сюжетные персонажи</h3><SectionDropZone entityType="scene" entityId={scene.id} profile section="scene_plot_characters" participation acceptTypes={PLOT_TYPES} placeholder="Перетащите существо или персонажа" /></section>
          <section><h3>Локации</h3><SectionDropZone entityType="scene" entityId={scene.id} profile section="scene_location" acceptTypes={LOCATION_TYPES} placeholder="Перетащите локацию" /></section>
          <section><h3>Препятствия</h3><SectionDropZone entityType="scene" entityId={scene.id} profile section="scene_obstacles" participation acceptTypes={OBSTACLE_TYPES} placeholder="Перетащите препятствие" /></section>
          <section><h3>Потенциальный лут</h3><SectionDropZone entityType="scene" entityId={scene.id} profile section="scene_loot" acceptTypes={LOOT_TYPES} placeholder="Перетащите находку" /></section>
        </div></ProfileBlock>
        <div className="scene-profile-entry"><ProfileBlock title="Вход и выход">
          <div className="profile-columns"><ProfileText {...fieldProps} title="Условие входа" value={scene.entry_condition} searchField="entry_condition" onSave={(v) => save({ entry_condition: v })} /><ProfileText {...fieldProps} title="Возможные исходы" value={scene.outcomes} searchField="outcomes" onSave={(v) => save({ outcomes: v })} /></div>
          <SceneClueSummary scene={scene} clues={graph} onLinks={() => selectTab("Связи")} />
                <details className="scene-profile-transitions" open>
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
                          onClick={() => void run(() => write.del(`/story/transitions/${t.id}`), { affects })}
                          aria-label="Удалить"
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                    {!addingTransition && <div className="profile-invitation">{scene.transitions.length === 0 && <><NavIcon name="canvas" /><span>Куда ведёт сцена дальше и на каком условии.</span></>}<button className="d-btn d-btn--sm" onClick={() => setAddingTransition(true)}>+ Переход</button></div>}
                    {addingTransition && (
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
                      <button className="d-btn d-btn--ghost" onClick={() => setAddingTransition(false)}>Отмена</button>
                    </div>
                    )}
                  </div>
                </details>

        </ProfileBlock></div>
        <details className="paper-fold"><summary>Справка <span className="profile-fold-note">проверки {scene.checks.length} · награды {scene.rewards.length}</span></summary><div className="paper-fold__body stack">
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
                            холсте. Здесь список только показывается — иначе
                            страница сцены и холст разошлись бы текстами. */}
                        {c.outcomes.map((o) => (
                          <div key={o.id} style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 2 }}>
                            <span className="campaign-field-label" style={{ margin: 0 }}>{o.label}</span>
                            {o.consequence ? <span className="reading-text" style={{ maxWidth: "56ch" }}><MentionText text={o.consequence} /></span> : null}
                            {o.target_name && <span className="muted">→ {o.target_name}</span>}
                          </div>
                        ))}
                      </span>
                      <button
                        className="danger comp-mini"
                        onClick={() => void run(() => write.del(`/story/checks/${c.id}`), { affects })}
                        aria-label="Удалить"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                  {scene.checks.length === 0 && (
                    <div className="card" style={{ borderStyle: "dashed" }}>
                      <p className="muted" style={{ maxWidth: "62ch" }}>Проверок нет — добавьте «что проверяем» и сложность. Исходы с последствиями правятся на холсте.</p>
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
                  <span className="muted" style={{ fontSize: "var(--fs-meta)", maxWidth: "62ch" }}>Два поля «При успехе/при провале» создадут исходы «Успех/Провал» — остальные (3–4) добавляются на холсте.</span>
                </div>
              </details>

              <details className="card" open>
                <summary className="campaign-overview-header">Награды · {scene.rewards.length}</summary>
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
                          <div className="muted reading-text" style={{ maxWidth: "62ch" }}>
                            <MentionText text={r.notes} />
                          </div>
                        )}
                      </span>
                      <button
                        className="danger comp-mini"
                        onClick={() => void run(() => write.del(`/story/rewards/${r.id}`), { affects })}
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

        </div></details>
      </>}
      {tab === "Материалы" && <SceneMaterials scene={scene} campaignId={campaignId} />}
      {tab === "Связи" && <SceneLinks scene={scene} campaignId={campaignId} clues={clueState.data} clueError={clueState.error} />}
    </EntityPage>
  );
}
