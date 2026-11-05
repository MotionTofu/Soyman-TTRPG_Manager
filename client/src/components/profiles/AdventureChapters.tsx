import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAction, useAfterWrite, useResource, write } from "../../data/hooks";
import { arcCluesPath } from "../../data/canvas";
import { campaignPaths } from "../../data/campaigns";
import { addToBag } from "../../bag";
import { useConfirm, usePrompt } from "../../hooks/useConfirm";
import { useUndoDelete } from "../../hooks/useUndoDelete";
import { sceneWord } from "../../sceneKinds";
import type { ArcClues, CampaignAdventureTree, CampaignTreeScene, SceneMakeup, StoryArcDetail, StoryScene } from "../../types";
import { SceneList } from "../CampaignChaptersScenes";
import { ContextMenu, type ContextMenuItem } from "../ContextMenu";
import { Modal } from "../Modal";
import { countHoles, holesLabel } from "./sceneProgress";

const AFFECTS = [{ path: "/story" }, { path: "/sessions" }, { path: "/canvas" }];
const EMPTY_MAKEUP: SceneMakeup = { characters: [], locations: [], obstacles: [], loot: [] };

/** Управление главами вокруг единственного списка/строки «Сюжета». */
export function AdventureChapters({ arc, campaignId }: { arc: StoryArcDetail; campaignId: number | null }) {
  const run = useAction();
  const afterWrite = useAfterWrite();
  const navigate = useNavigate();
  const [confirmDialog, confirm] = useConfirm();
  const [promptDialog, promptText] = usePrompt();
  const { deleteWithUndo } = useUndoDelete();
  const tree = useResource<CampaignAdventureTree[]>(campaignId ? campaignPaths.tree(campaignId) : null).data;
  const makeup = useResource<Record<number, SceneMakeup>>(campaignId == null ? `/story/arcs/${arc.id}/profile-makeup` : null).data;
  const graph = useResource<ArcClues>(arcCluesPath(arc.id, campaignId)).data;
  const unmarked = !graph || graph.nodes.every((n) => n.clue_in === 0 && n.clue_out === 0);
  const nodeBy = new Map((unmarked ? [] : graph.nodes).map((n) => [n.shown_id, n]));
  const treeScenes = tree?.flatMap((a) => [...a.scenes, ...a.chapters.flatMap((c) => c.scenes)]) ?? [];
  const enrich = (s: StoryScene): CampaignTreeScene => treeScenes.find((r) => r.id === s.id) ?? { ...s, sessions: [], makeup: makeup?.[s.id] ?? EMPTY_MAKEUP };
  const storageKey = `adventure-collapsed-${arc.id}`;
  const [collapsed, setCollapsed] = useState<number[]>(() => { try { return JSON.parse(localStorage.getItem(storageKey) ?? "[]"); } catch { return []; } });
  const [chapterMenu, setChapterMenu] = useState<{ id: number; x: number; y: number } | null>(null);
  const [moving, setMoving] = useState<StoryScene | null>(null);
  const [targetArc, setTargetArc] = useState("");
  const [movingBusy, setMovingBusy] = useState(false);
  function collapse(ids: number[]) { setCollapsed(ids); try { localStorage.setItem(storageKey, JSON.stringify(ids)); } catch { /* В текущем окне свёртка сохраняется и без хранилища. */ } }
  const toggle = (id: number) => collapse(collapsed.includes(id) ? collapsed.filter((x) => x !== id) : [...collapsed, id]);

  async function createScene(arcId: number) {
    const name = await promptText({ title: "Новая сцена", message: "Название сцены" });
    if (!name?.trim()) return;
    await run(() => write.post("/story/scenes", { setting_id: arc.setting_id, arc_id: arcId, campaign_id: campaignId, name: name.trim() }), { affects: AFFECTS, retry: false });
  }
  async function createChapter() {
    const name = await promptText({ title: "Новая глава", message: "Название главы" });
    if (!name?.trim()) return;
    await run(() => write.post("/story/arcs", { setting_id: arc.setting_id, parent_id: arc.id, kind: "chapter", name: name.trim() }), { affects: AFFECTS, retry: false });
  }
  async function reorderScenes(scenes: StoryScene[], dragged: number, target: number) {
    const order = scenes.map((s) => s.id), from = order.indexOf(dragged), to = order.indexOf(target);
    if (from < 0 || to < 0 || from === to) return;
    order.splice(to, 0, ...order.splice(from, 1));
    await run(() => write.put("/story/scenes/reorder", { order }), { affects: AFFECTS });
  }
  async function moveChapter(chapterId: number, delta: number) {
    const order = arc.chapters.map((c) => c.id), from = order.indexOf(chapterId), to = from + delta;
    if (from < 0 || to < 0 || to >= order.length) return;
    [order[from], order[to]] = [order[to], order[from]];
    await run(() => write.put("/story/arcs/reorder", { order }), { affects: AFFECTS });
  }
  async function renameScene(s: StoryScene) {
    const name = await promptText({ title: "Переименовать сцену", message: "Название сцены", defaultValue: s.name });
    if (name?.trim() && name.trim() !== s.name) await run(() => write.put(`/story/scenes/${s.id}`, { name: name.trim(), campaign_id: campaignId }), { affects: AFFECTS });
  }
  async function archiveScene(s: StoryScene) {
    if (!(await confirm({ message: `Отправить сцену «${s.name}» в архив?`, confirmLabel: "Архивировать", danger: true }))) return;
    await run(() => deleteWithUndo({ entityName: s.name, deleteFn: async () => { await write.del(`/story/scenes/${s.id}`); }, restoreFn: async () => { await write.put(`/story/scenes/${s.id}/restore`, {}); afterWrite(AFFECTS); } }), { affects: AFFECTS, retry: false });
  }
  function sceneActions(s: StoryScene): ContextMenuItem[] {
    return [
      { label: "Открыть", onClick: () => navigate(`/scenes/${s.id}${campaignId ? `?campaign=${campaignId}` : ""}`) },
      { label: "Переименовать", onClick: () => renameScene(s) },
      { label: "Перенести в главу…", onClick: () => { setTargetArc(String(s.arc_id ?? arc.id)); setMoving(s); } },
      { label: "В мешок", onClick: () => addToBag({ type: "scene", id: s.id, title: s.name }) },
      ...(!campaignId || s.campaign_only ? [{ label: "Архивировать", danger: true, onClick: () => archiveScene(s) }] : []),
    ];
  }
  async function moveScene() {
    if (!moving || !targetArc || movingBusy) return;
    setMovingBusy(true);
    const done = await run(() => write.put(`/story/scenes/${moving.id}`, { arc_id: Number(targetArc), campaign_id: campaignId }).then(() => true), { affects: AFFECTS });
    setMovingBusy(false);
    if (done) setMoving(null);
  }
  const chosenChapter = arc.chapters.find((c) => c.id === chapterMenu?.id);
  const chapterActions: ContextMenuItem[] = chosenChapter ? [
    { label: "Выше", onClick: () => moveChapter(chosenChapter.id, -1) },
    { label: "Ниже", onClick: () => moveChapter(chosenChapter.id, 1) },
    ...(!campaignId ? [
      { label: "Переименовать", onClick: async () => { const name = await promptText({ title: "Переименовать главу", message: "Название главы", defaultValue: chosenChapter.name }); if (name?.trim()) await run(() => write.put(`/story/arcs/${chosenChapter.id}`, { name: name.trim() }), { affects: AFFECTS }); } },
      { label: "Архивировать", danger: true, onClick: async () => { if (await confirm({ message: `Отправить главу «${chosenChapter.name}» в архив вместе со сценами?`, confirmLabel: "Архивировать", danger: true })) await run(() => write.del(`/story/arcs/${chosenChapter.id}`), { affects: AFFECTS }); } },
    ] : []),
  ] : [];
  function group(title: string, id: number, scenes: StoryScene[], chapter = false) {
    const enriched = scenes.map(enrich), holes = countHoles(enriched, nodeBy);
    return <details className="campaign-chapters__chapter" key={id} open={!collapsed.includes(id)} onToggle={(e) => { const open = e.currentTarget.open; if (open === collapsed.includes(id)) toggle(id); }}>
      <summary className="campaign-chapter__head"><span className="campaign-chapter__title">{title}</span><span className="campaign-chapter__count">{campaignId ? `сыграно ${enriched.filter((s) => s.state?.status === "done").length} из ${scenes.length}` : `${scenes.length} ${sceneWord(scenes.length)}`}{campaignId && holes > 0 && ` · ${holesLabel(holes)}`}</span>{chapter && <button className="d-dots" aria-label={`Действия главы «${title}»`} onClick={(e) => { e.preventDefault(); const r = e.currentTarget.getBoundingClientRect(); setChapterMenu({ id, x: r.left, y: r.bottom }); }}>⋯</button>}</summary>
      <SceneList scenes={enriched} campaignId={campaignId} settingId={arc.setting_id} title={null} clues={unmarked ? undefined : graph} nodeBy={nodeBy} actions={sceneActions} reorder={(from, to) => reorderScenes(scenes, from, to)} footer={<button className="d-btn d-btn--sm" onClick={() => createScene(id)}>+ Сцена</button>} />
    </details>;
  }
  const direct = arc.scenes.filter((s) => s.arc_id === arc.id);
  return <div className="campaign-chapters adventure-chapter-list stack">
    {confirmDialog}{promptDialog}
    <div className="adventure-profile-actions"><button className="d-btn d-btn--sm d-btn--ghost" onClick={() => collapse([arc.id, ...arc.chapters.map((c) => c.id)])}>Свернуть все</button><button className="d-btn d-btn--sm d-btn--ghost" onClick={() => collapse([])}>Развернуть все</button>{!!arc.chapters.length && <button className="d-btn d-btn--sm" onClick={() => createScene(arc.id)}>+ Сцена без главы</button>}{!campaignId && <button className="d-btn d-btn--primary d-btn--sm" onClick={createChapter}>+ Глава</button>}</div>
    {(direct.length > 0 || !arc.chapters.length) && group(arc.chapters.length ? "Без главы" : "Сцены", arc.id, direct)}
    {arc.chapters.map((c) => group(c.name, c.id, arc.scenes.filter((s) => s.arc_id === c.id), true))}
    {chapterMenu && <ContextMenu x={chapterMenu.x} y={chapterMenu.y} title={chosenChapter?.name} items={chapterActions} onClose={() => setChapterMenu(null)} />}
    {moving && <Modal ariaLabel="Перенести сцену" onClose={() => setMoving(null)}><div className="stack"><h2>Перенести «{moving.name}»</h2><label className="stack">Глава<select value={targetArc} onChange={(e) => setTargetArc(e.target.value)}><option value={arc.id}>Без главы</option>{arc.chapters.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label><button className="d-btn" disabled={movingBusy || Number(targetArc) === moving.arc_id} onClick={moveScene}>Перенести</button></div></Modal>}
  </div>;
}
