import { useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAction, useResource, write } from "../../data/hooks";
import { clueAffects } from "../../data/canvas";
import { useIsMobile } from "../../hooks/useIsMobile";
import { clueNeed } from "../../sceneKinds";
import type { ArcClues, ScenePresentation, StoryArc, StoryClue, StorySceneDetail } from "../../types";
import { MentionText } from "../mentions/MentionText";
import { Modal } from "../Modal";
import { NavIcon } from "../NavIcons";
import { PresentationEditor } from "../presentation/PresentationEditor";
import { SceneMaps } from "../presentation/SceneMaps";
import { AddSceneMap, AddScenePicture } from "../presentation/AddSceneMaterial";
import { ProfileBlock, ProfileEntityLink, ProfileTypeGlyph } from "./ProfileParts";

export const SCENE_TABS = ["Лист", "Материалы", "Связи"] as const;
export const SCENE_TAB_ALIASES = { Досье: "Лист", Наполнение: "Лист", "Входы и выходы": "Лист", Представление: "Материалы", Карта: "Материалы", Аудионабор: "Материалы" } as const;
export const sceneCanvasHref = (scene: StorySceneDetail, campaignId: number | null) => `/canvas?setting=${scene.setting_id}&arc=${scene.arc_id ?? ""}${campaignId ? `&campaign=${campaignId}` : ""}&focus=scene:${scene.id}`;

const FRAME = [{ key: "frame_where", label: "Где" }, { key: "frame_when", label: "Когда" }, { key: "frame_who", label: "Кто" }, { key: "frame_why_now", label: "Почему сейчас" }] as const;
const FLOW = [{ key: "whats_happening", label: "Что происходит" }, { key: "twists", label: "Повороты" }, { key: "pressure", label: "Давление" }, { key: "cut_when", label: "Когда резать" }] as const;
const TABLE_FIELDS = [...FRAME, ...FLOW];
type TableKey = typeof TABLE_FIELDS[number]["key"];

export function SceneTable({ scene, onSave }: { scene: StorySceneDetail; onSave: (patch: Record<string, unknown>) => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Partial<Record<TableKey, string>>>({});
  const [saving, setSaving] = useState(false);
  const start = () => { setDraft(Object.fromEntries(TABLE_FIELDS.map((f) => [f.key, scene[f.key] ?? ""]))); setEditing(true); };
  const submit = async () => { setSaving(true); try { await onSave(draft); setEditing(false); } catch { /* Слой показал ошибку; набранное остаётся. */ } finally { setSaving(false); } };
  return <ProfileBlock title="За столом" actions={!editing && <button className="d-btn d-btn--sm" onClick={start}>Править</button>}>
    {editing ? <div className="stack"><div className="profile-columns">{TABLE_FIELDS.map((f) => <label className="stack" key={f.key}><span className="d-mono">{f.label}</span><textarea rows={2} value={draft[f.key] ?? ""} onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })} /></label>)}</div><div className="row"><button className="d-btn" disabled={saving} onClick={submit}>Сохранить</button><button className="d-btn d-btn--ghost" disabled={saving} onClick={() => setEditing(false)}>Отмена</button></div></div> : <>
      <div className="scene-profile-frame">{FRAME.map((f) => <div key={f.key}>{scene[f.key]?.trim() ? <><b>{f.label}</b> <MentionText text={scene[f.key]} /></> : <button className="profile-tag-add" onClick={start}>+ {f.label.toLocaleLowerCase()}</button>}</div>)}</div>
      <dl className="profile-columns scene-profile-flow">{[FLOW[0], FLOW[2], FLOW[1], FLOW[3]].map((f) => <div key={f.key}><dt>{f.label}</dt><dd>{scene[f.key]?.trim() ? <MentionText text={scene[f.key]} /> : <button className="profile-tag-add" onClick={start}>+ {f.label.toLocaleLowerCase()}</button>}</dd></div>)}</dl>
    </>}
  </ProfileBlock>;
}

export function SceneClueSummary({ scene, clues, onLinks }: { scene: StorySceneDetail; clues?: ArcClues; onLinks: () => void }) {
  const n = clues?.nodes.find((n) => n.shown_id === scene.id || n.id === (scene.source_scene_id ?? scene.id));
  const need = clueNeed(scene.node_role, n?.clue_in ?? 0, n?.passage_in ?? false);
  return <button className="profile-text-link scene-profile-clue-summary" onClick={onLinks}>{need === "start" ? "Старт — улики сюда не нужны" : need === "proactive" ? "Приходит сам — улики сюда не нужны" : `улик сюда ${n?.clue_in ?? 0}/3`}{` · ведёт отсюда ${n?.clue_out ?? 0}`} · Связи ›</button>;
}

export function SceneMaterials({ scene, campaignId }: { scene: StorySceneDetail; campaignId: number | null }) {
  const navigate = useNavigate();
  const suffix = campaignId ? `?campaign_id=${campaignId}` : "";
  const pres = useResource<ScenePresentation>(`/story/scenes/${scene.id}/presentation${suffix}`);
  const maps = useResource<{ maps: { id: number; name: string }[] }>(`/story/scenes/${scene.id}/maps${suffix}`);
  const [adding, setAdding] = useState<"picture" | "map" | null>(null);
  const [editingPicture, setEditingPicture] = useState(false);
  const hasPicture = !!(pres.data?.background_url || pres.data?.layers.length);
  const added = (id: number) => { if (id !== scene.id) navigate(`/scenes/${id}?campaign=${campaignId}&tab=${encodeURIComponent("Материалы")}`, { replace: true }); };
  return <div className="stack scene-profile-materials">
    <ProfileBlock title="Картинка показа">
      {pres.error ? <p role="alert">{pres.error}</p> : !pres.data ? <p className="muted">Загрузка…</p> : hasPicture ? <div className="scene-material-layout"><div className="scene-material-preview"><img src={pres.data.background_url ?? pres.data.layers[0]?.image_url} alt="Картинка показа" /></div><div><dl className="scene-profile-flow"><div><dt>Переход</dt><dd>{({ cut: "Склейка", fade: "Плавный", black: "Через чёрный" } as Record<string, string>)[pres.data.transition] ?? pres.data.transition} · {pres.data.transition_ms} мс</dd></div><div><dt>Заглавие · затухание</dt><dd>{pres.data.title || "Без заглавия"} · {pres.data.title_secs} с · {pres.data.fade_ms} мс</dd></div><div><dt>Слои</dt><dd>{pres.data.layers.length || "Нет"}</dd></div></dl><button className="d-btn d-btn--sm" onClick={() => setEditingPicture(true)}>Настроить показ</button></div></div> : <Invitation text="Фон и слои показа сцены игрокам." label="+ Картинка показа" onClick={() => setAdding("picture")} />}
    </ProfileBlock>
    <ProfileBlock title="Карта">
      {maps.error ? <p role="alert">{maps.error}</p> : !maps.data ? <p className="muted">Загрузка…</p> : maps.data.maps.length ? <SceneMaps sceneId={scene.id} campaignId={campaignId} /> : <Invitation text="Карты сцены доступны на Пульте." label="+ Карта" onClick={() => setAdding("map")} />}
    </ProfileBlock>
    <ProfileBlock title="Аудионабор"><SceneAudio sceneId={scene.id} /></ProfileBlock>
    {adding === "picture" && <AddScenePicture sceneId={scene.id} sceneName={scene.name} campaignId={campaignId} onAdded={(p) => added(p.scene_id)} onClose={() => setAdding(null)} />}
    {adding === "map" && <AddSceneMap sceneId={scene.id} sceneName={scene.name} campaignId={campaignId} onAdded={added} onClose={() => setAdding(null)} />}
    {editingPicture && <Modal wide ariaLabel="Настройки показа сцены" onClose={() => setEditingPicture(false)}><PresentationEditor owner={{ kind: "scene", sceneId: scene.id, sceneName: scene.name, campaignId }} /></Modal>}
  </div>;
}

function Invitation({ text, label, onClick }: { text: string; label: string; onClick: () => void }) {
  return <div className="scene-material-layout"><div className="scene-material-preview scene-material-preview--empty"><ProfileTypeGlyph type={label === "+ Карта" ? "location" : "scene"} /></div><div className="stack"><p>{text}</p><button className="d-btn" onClick={onClick}>{label}</button></div></div>;
}

function SceneAudio({ sceneId }: { sceneId: number }) {
  const sets = useResource<{ id: number; name: string }[]>("/sound-sets").data ?? [];
  const current = useResource<{ id: number; name: string } | null>(`/story/scenes/${sceneId}/sound-set`);
  const [choosing, setChoosing] = useState(false);
  const run = useAction();
  return current.error ? <p role="alert">{current.error}</p> : current.data || choosing ? <label className="stack"><span className="d-mono">Набор включается вместе со сценой</span><select aria-label="Аудионабор сцены" value={current.data?.id ?? ""} onChange={async (e) => { const done = await run(() => write.put(`/story/scenes/${sceneId}/sound-set`, { sound_set_id: e.target.value ? Number(e.target.value) : null }).then(() => true), { affects: [{ path: `/story/scenes/${sceneId}/sound-set` }, { path: "/sessions" }, { path: "/canvas" }] }); if (done) setChoosing(false); }}><option value="">— без звука —</option>{sets.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label> : <Invitation text="Выберите набор из Аудиотеки." label="+ Набор" onClick={() => setChoosing(true)} />;
}

type ProfileClue = StoryClue & { target_title?: string; from_scene_id?: number | null; from_scene_name?: string };
export interface SceneProfileClues { outgoing: ProfileClue[]; incoming: ProfileClue[] }
interface Incoming { transitions: { id: number; from_scene_id: number; from_scene_name: string; label: string }[]; outcomes: { check_id: number; from_scene_id: number; from_scene_name: string; label: string; check_what: string }[] }
interface Cast { link_id: number; section: string; to_type: string; to_id: number; name: string; qty: string }

/** Три карточки материалов: показ целиком, карты целиком, аудионабор. */
export function sceneMaterialCount(presentation: { background_url: string | null; layers: readonly unknown[] }, maps: { maps: readonly unknown[] }, soundSet: { id: number } | null) {
  return Number(!!(presentation.background_url || presentation.layers.length)) + Number(maps.maps.length > 0) + Number(soundSet != null);
}

/** Считаем те же строки, что видны в трёх группах вкладки «Связи». */
export function sceneLinkCount(scene: { transitions: readonly unknown[] }, clues: { incoming: readonly unknown[]; outgoing: readonly unknown[] }, incoming: { transitions: readonly unknown[]; outcomes: readonly unknown[] }, cast: readonly unknown[]) {
  return incoming.transitions.length + incoming.outcomes.length + clues.incoming.length + clues.outgoing.length + scene.transitions.length + cast.length;
}

export function useSceneProfileCounts(scene: StorySceneDetail | null, campaignId: number | null, presentation: ScenePresentation | undefined, clues: SceneProfileClues | undefined) {
  const path = scene ? `/story/scenes/${scene.id}` : null;
  const maps = useResource<{ maps: { id: number }[] }>(path ? `${path}/maps${campaignId ? `?campaign_id=${campaignId}` : ""}` : null).data;
  const soundSet = useResource<{ id: number } | null>(path ? `${path}/sound-set` : null).data;
  const incoming = useResource<Incoming>(path ? `${path}/incoming` : null).data;
  const cast = useResource<Cast[]>(path ? `${path}/cast` : null).data;
  return {
    materials: presentation && maps && soundSet !== undefined ? sceneMaterialCount(presentation, maps, soundSet) : undefined,
    links: scene && clues && incoming && cast ? sceneLinkCount(scene, clues, incoming, cast) : undefined,
  };
}

export function SceneLinks({ scene, campaignId, clues, clueError }: { scene: StorySceneDetail; campaignId: number | null; clues?: SceneProfileClues; clueError?: string | null }) {
  const incoming = useResource<Incoming>(`/story/scenes/${scene.id}/incoming`);
  const cast = useResource<Cast[]>(`/story/scenes/${scene.id}/cast`);
  const mobile = useIsMobile();
  const [adding, setAdding] = useState(false);
  const href = (id: number) => `/scenes/${id}${campaignId ? `?campaign=${campaignId}` : ""}`;
  const ins = (incoming.data?.transitions.length ?? 0) + (incoming.data?.outcomes.length ?? 0) + (clues?.incoming.length ?? 0);
  const total = incoming.data && cast.data && clues ? sceneLinkCount(scene, clues, incoming.data, cast.data) : undefined;
  const group = (title: string, count: number, body: ReactNode, first = false, actions?: ReactNode) => <details key={`${title}:${mobile}`} className="profile-link-group" open={!mobile || first}><summary><span className="d-plate">{title}</span><span className="d-note">{count}</span>{actions}</summary>{body}</details>;
  const row = (key: string, type: string, id: number, name: string, note: ReactNode, to?: string) => <div className="profile-link-row" key={key}><ProfileTypeGlyph type={type} /><ProfileEntityLink type={type} id={id} name={name} to={to} /><span className="profile-link-row__note">{note}</span></div>;
  return <div className="profile-links scene-profile-links"><div className="profile-links__head"><h2 className="d-plate">Связи</h2>{total != null && <span className="d-note">{total}</span>}<Link className="d-btn" to={sceneCanvasHref(scene, campaignId)}><NavIcon name="canvas" /> Показать на холсте</Link></div>
    {(incoming.error || clueError || cast.error) && <p role="alert">Не удалось прочитать связи: {incoming.error || clueError || cast.error}</p>}
    {(ins > 0 || scene.node_role === "start") && group("Ведут сюда", ins, <>
      {ins === 0 && scene.node_role === "start" && <p className="muted">Стартовая сцена — улики сюда не нужны</p>}
      {incoming.data?.transitions.map((t) => row(`t:${t.id}`, "scene", t.from_scene_id, t.from_scene_name, `Переход${t.label ? ` · ${t.label}` : ""}`, href(t.from_scene_id)))}
      {incoming.data?.outcomes.map((o, i) => row(`o:${i}`, "scene", o.from_scene_id, o.from_scene_name, `Исход «${o.label}» · ${o.check_what}`, href(o.from_scene_id)))}
      {clues?.incoming.map((c) => c.from_scene_id ? row(`c:${c.from_scene_id}:${c.id}`, "scene", c.from_scene_id, c.from_scene_name ?? "Сцена", <>Улика · <MentionText text={c.text} />{c.how && ` · ${c.how}`}</>, href(c.from_scene_id)) : <p key={c.id}>Улика из лотка: <MentionText text={c.text} />{c.how && ` · ${c.how}`}</p>)}
    </>, true)}
    {group("Ведёт отсюда", (clues?.outgoing.length ?? 0) + scene.transitions.length, <>
      {clues?.outgoing.map((c) => <div className="scene-profile-clue" key={c.id}><NavIcon name="search" /><span><MentionText text={c.text} />{c.how && <small>{c.how}</small>}</span><span aria-hidden="true">→</span>{c.target_type && c.target_id ? <ProfileEntityLink type={c.target_type} id={c.target_id} name={c.target_title ?? "Цель улики"} to={c.target_type === "scene" ? href(c.target_id) : c.target_type === "secret" ? `/adventures/${scene.arc_id}?${campaignId ? `campaign=${campaignId}&` : ""}tab=${encodeURIComponent("Тайны и вехи")}` : undefined} /> : <span className="muted">Цель не задана</span>}</div>)}
      {scene.transitions.map((t) => row(`t:${t.id}`, "scene", t.to_scene_id, t.to_scene_name, <>Переход {t.label && <MentionText text={t.label} />}</>, href(t.to_scene_id)))}
      {!clues?.outgoing.length && !scene.transitions.length && <p className="muted">Запишите улику, ведущую к следующему узлу.</p>}
    </>, ins === 0 && scene.node_role !== "start", <button className="d-btn d-btn--sm" onClick={(e) => { e.preventDefault(); setAdding(true); }}>+ Улика</button>)}
    {!!cast.data?.length && group("Сущности сцены", cast.data.length, cast.data.map((c) => row(`cast:${c.link_id}`, c.to_type, c.to_id, c.name, c.qty ? `× ${c.qty}` : "Состав сцены")))}
    {adding && <ClueForm scene={scene} campaignId={campaignId} onClose={() => setAdding(false)} />}
  </div>;
}

type ClueTargetScene = { id: number; name: string; arc_id: number | null };

/** Цели улики: сначала сцены своего приключения, потом остальные — группой на приключение (порядок сеттинга). */
export function groupClueTargets(rows: ClueTargetScene[], arcs: Pick<StoryArc, "id" | "name" | "parent_id">[], scene: { id: number; arc_id: number | null }) {
  const byId = new Map(arcs.map((a) => [a.id, a]));
  const root = (arcId: number | null) => {
    let a = arcId == null ? undefined : byId.get(arcId);
    while (a?.parent_id != null && byId.has(a.parent_id)) a = byId.get(a.parent_id);
    return a;
  };
  const own = root(scene.arc_id)?.id;
  const groups = new Map<number | null, { label: string; scenes: ClueTargetScene[] }>();
  for (const s of rows) {
    if (s.id === scene.id) continue;
    const r = root(s.arc_id);
    const key = r?.id ?? null;
    if (!groups.has(key)) groups.set(key, { label: r ? (r.id === own ? `${r.name} · это приключение` : r.name) : "Вне приключений", scenes: [] });
    groups.get(key)!.scenes.push(s);
  }
  const order = (k: number | null) => (k === own && k != null ? -1 : k == null ? Number.MAX_SAFE_INTEGER : arcs.findIndex((a) => a.id === k));
  return [...groups.entries()].sort(([a], [b]) => order(a) - order(b)).map(([, g]) => g);
}

function ClueForm({ scene, campaignId, onClose }: { scene: StorySceneDetail; campaignId: number | null; onClose: () => void }) {
  const [text, setText] = useState("");
  const [how, setHow] = useState("");
  const [target, setTarget] = useState("");
  const rows = useResource<ClueTargetScene[]>(`/story/scenes?setting_id=${scene.setting_id}${campaignId ? `&campaign_id=${campaignId}` : ""}`).data ?? [];
  const arcs = useResource<StoryArc[]>(`/story/arcs?setting_id=${scene.setting_id}`).data ?? [];
  const groups = groupClueTargets(rows, arcs, scene);
  const run = useAction();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  async function save() {
    if (!text.trim() || busy) return;
    setBusy(true);
    const done = await run(() => write.post<{ scene_id: number }>(`/story/scenes/${scene.id}/clues`, { text, how, target_type: target ? "scene" : null, target_id: target ? Number(target) : null, campaign_id: campaignId }), { affects: clueAffects(), retry: false });
    setBusy(false);
    if (done) { onClose(); if (done.scene_id !== scene.id) navigate(`/scenes/${done.scene_id}?campaign=${campaignId}&tab=${encodeURIComponent("Связи")}`, { replace: true }); }
  }
  return <Modal ariaLabel="Улика сцены" onClose={onClose}><div className="stack"><h2>Улика</h2><label className="stack">Что находят<textarea value={text} onChange={(e) => setText(e.target.value)} /></label><label className="stack">Как находят<input value={how} onChange={(e) => setHow(e.target.value)} /></label><label className="stack">Ведёт к сцене<select value={target} onChange={(e) => setTarget(e.target.value)}><option value="">Цель пока не задана</option>{groups.map((g) => <optgroup key={g.label} label={g.label}>{g.scenes.map((s) => <option key={s.id} value={s.id}>{s.name || "Без названия"}</option>)}</optgroup>)}</select></label><button className="d-btn" disabled={!text.trim() || busy} onClick={save}>Добавить улику</button></div></Modal>;
}
