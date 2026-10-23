import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { useAction, useResource, write } from "../data/hooks";
import { dataKeys } from "../data/entities";
import { campaignPaths, sceneStatusAffects } from "../data/campaigns";
import { labelled } from "../data/notices";
import { MentionText } from "./mentions/MentionText";
import { EmptyState } from "./EmptyState";
import { SCENE_STATUSES, clueNeed, nodeLabel, plural, sceneWord } from "../sceneKinds";
import type { ArcClueNode, ArcClues, CampaignAdventureTree, CampaignTreeScene, SceneStatus, StoryScene } from "../types";
import { NavIcon } from "./NavIcons";
import { arcCluesPath } from "../data/canvas";
import { rasterAsset } from "../rasterAssets";
import "./campaign-chapters.css";
import { CampaignAdventureOverview } from "./CampaignAdventuresCard";

// Раздел «Главы и сцены» кампании: приключение → главы → сцены. Базово
// свёрнуто всё, включая сами приключения: у книжной кампании тут сотни строк,
// и раскрывать их сразу — значит сделать раздел нечитаемым.
//
// Сцена раскрывается своей сводкой и ссылкой на полную страницу: разворачивать
// весь текст сцены прямо здесь — снова бесконечный свиток, а строка без сводки
// заставляет открывать страницу только чтобы вспомнить, о чём сцена.
export interface ChaptersNavStats {
  adventures: {
    id: number;
    name: string;
    /** Служебная корзина «Сцены вне приключений». */
    is_default: boolean;
    /** Текущее приключение (Q7): см. currentAdventureId. */
    current: boolean;
    chapters: { id: number; name: string; scenes: number }[];
    scenes: number;
    done: number;
    pending: number;
    skipped: number;
  }[];
}

const EMPTY: CampaignAdventureTree[] = [];

export function CampaignChaptersScenes({
  campaignId,
  settingId,
  adventureId,
  chapterId,
  onStats,
}: {
  campaignId: number;
  settingId: number | null;
  // Master–Detail: показать одно приключение (и внутри — одну главу).
  // Не задано — всё дерево, как раньше.
  adventureId?: number | null;
  chapterId?: number | null;
  onStats?: (s: ChaptersNavStats) => void;
}) {
  const path = campaignPaths.tree(campaignId);
  const tree = useResource<CampaignAdventureTree[]>(path).data ?? EMPTY;
  const client = useQueryClient();

  // Счётчики для левой навигации Master–Detail.
  useEffect(() => {
    if (!onStats) return;
    const current = currentAdventureId(tree);
    onStats({
      adventures: tree.map((adv) => {
        const all = [...adv.scenes, ...adv.chapters.flatMap((c) => c.scenes)];
        const { done, skipped, pending } = countByStatus(all);
        return {
          id: adv.id,
          name: adv.name,
          is_default: !!adv.is_default,
          current: adv.id === current,
          chapters: adv.chapters.map((c) => ({ id: c.id, name: c.name, scenes: c.scenes.length })),
          scenes: all.length,
          done,
          pending,
          skipped,
        };
      }),
    });
  }, [tree, onStats]);

  // Нетронутые сцены сохраняют ссылочное равенство: вместе с memo на строке
  // это оставляет коммит React в пределах одной сцены, а не всего дерева.
  const applyStatus = useCallback((sceneId: number, status: string) => {
    // Приключения и главы, которых правка не касается, сохраняют ссылку —
    // иначе смена статуса одной сцены перерисовывала бы всё дерево.
    const patchList = <T extends StoryScene>(list: T[]): T[] => {
      const i = list.findIndex((s) => s.id === sceneId);
      if (i === -1) return list;
      const next = list.slice();
      next[i] = { ...list[i], state: { status: status as SceneStatus, note: list[i].state?.note ?? "" } };
      return next;
    };
    client.setQueryData<CampaignAdventureTree[]>(dataKeys.resource(path), (prev) =>
      prev?.map((adv) => {
        const scenes = patchList(adv.scenes);
        const chapters = adv.chapters.map((c) => {
          const chScenes = patchList(c.scenes);
          return chScenes === c.scenes ? c : { ...c, scenes: chScenes };
        });
        const chaptersChanged = chapters.some((c, i) => c !== adv.chapters[i]);
        if (scenes === adv.scenes && !chaptersChanged) return adv;
        return { ...adv, scenes, chapters };
      })
    );
  }, [client, path]);

  if (settingId == null) {
    return (
      <div className="card" style={{ borderStyle: "dashed" }}>
        <p style={{ maxWidth: "62ch" }}>
          Приключения живут в сеттинге — выберите сеттинг кампании в разделе «Обзор → Основное», и здесь появится дерево глав и сцен.
        </p>
        <Link to={`/campaigns/${campaignId}`}><button>К обзору →</button></Link>
      </div>
    );
  }

  if (tree.length === 0) {
    return (
      <EmptyState
        title="Главы ещё не привязаны"
        hint="Привяжите приключение в разделе «Обзор → Приключения» — его главы и сцены станут планом кампании."
        action={<Link to={`/campaigns/${campaignId}`}><button className="primary">К приключениям →</button></Link>}
      />
    );
  }

  const visibleTree = adventureId != null ? tree.filter((a) => a.id === adventureId) : tree;

  return (
    <div className="stack campaign-chapters">
      {adventureId != null && visibleTree.length === 0 && (
        <p className="muted">Приключение не найдено — возможно, его открепили.</p>
      )}
      {visibleTree.map((adv) => (
        <AdventureSection
          key={adv.id}
          adv={adv}
          campaignId={campaignId}
          settingId={settingId}
          selected={adventureId === adv.id}
          chapterId={chapterId ?? null}
          onStatus={applyStatus}
        />
      ))}
    </div>
  );
}

/** Узел недостижим: меньше трёх улик и ничто его не освобождает (холст, Q11/Q31). */
function isHole(n: ArcClueNode | undefined) {
  return !!n && clueNeed(n.role, n.clue_in, n.passage_in) === "missing";
}

/** Ближайшая ещё не сыгранная сессия, куда положена сцена (сегодня и позже). */
function plannedSession(s: CampaignTreeScene) {
  const today = new Date().toLocaleDateString("sv");
  return s.sessions.find((x) => !x.played && x.date >= today) ?? null;
}

const isPending = (s: StoryScene) => (s.state?.status ?? "pending") === "pending";

/**
 * Приключение во вкладке «Сюжет» (гриллинг 2026-10-23, Q11/Q13): шапка с
 * фактами словами, дырами правила трёх и входом на холст; главы открыты, пока
 * в них есть не начатые сцены. Дыры считаются только у не начатых сцен —
 * у сыгранной улики уже ничего не решают.
 */
function AdventureSection({
  adv,
  campaignId,
  settingId,
  selected,
  chapterId,
  onStatus,
}: {
  adv: CampaignAdventureTree;
  campaignId: number;
  settingId: number | null;
  selected: boolean;
  chapterId: number | null;
  onStatus: (sceneId: number, status: string) => void;
}) {
  const navigate = useNavigate();
  const clues = useResource<ArcClues>(adv.is_default ? null : arcCluesPath(adv.id, campaignId)).data;
  const nodeBy = useMemo(() => new Map((clues?.nodes ?? []).map((n) => [n.shown_id, n])), [clues]);
  const holesIn = (list: CampaignTreeScene[]) => list.filter((s) => isPending(s) && isHole(nodeBy.get(s.id))).length;

  const [openCh, setOpenCh] = useState(() => new Set(adv.chapters.filter((c) => c.scenes.some(isPending)).map((c) => c.id)));
  const toggleCh = (id: number, open: boolean) =>
    setOpenCh((prev) => {
      if (prev.has(id) === open) return prev;
      const next = new Set(prev);
      if (open) next.add(id);
      else next.delete(id);
      return next;
    });

  const all = [...adv.scenes, ...adv.chapters.flatMap((c) => c.scenes)];
  const { done, skipped } = countByStatus(all);
  const planned = all.filter((s) => isPending(s) && plannedSession(s)).length;
  const holes = holesIn(all);
  const facts = [
    `${all.length} ${sceneWord(all.length)}`,
    `${done} сыграно`,
    planned > 0 && `${planned} в сессиях`,
    skipped > 0 && `${skipped} ${plural(skipped, "пропущена", "пропущены", "пропущено")}`,
  ].filter(Boolean);
  const advChapters = chapterId == null ? adv.chapters : adv.chapters.filter((c) => c.id === chapterId);
  const logline = adv.description?.split("\n")[0].trim();
  const holesLabel = (n: number) => `⚠ ${n} ${plural(n, "узел", "узла", "узлов")} без трёх улик`;

  return (
    <section className="card res-group campaign-chapters__adventure">
      <header className="res-group__band campaign-adv__head">
        <div className="campaign-adv__title">
          <span className="res-group__title">{adv.name}</span>
          {logline && <span className="campaign-adv__logline">{logline}</span>}
          <span className="campaign-adv__facts">
            {facts.join(" · ")}
            {adv.is_override && <span className="campaign-scene__note">правка кампании</span>}
          </span>
        </div>
        <div className="campaign-adv__actions">
          {holes > 0 && (
            <button
              type="button"
              className="campaign-adv__holes"
              title="Раскрыть главы с такими узлами"
              onClick={() => setOpenCh(new Set(adv.chapters.filter((c) => holesIn(c.scenes) > 0).map((c) => c.id)))}
            >
              {holesLabel(holes)}
            </button>
          )}
          {!adv.is_default && settingId != null && (
            <>
              <button
                type="button"
                className="primary campaign-adv__canvas"
                onClick={() => navigate(`/canvas?setting=${settingId}&arc=${adv.id}&campaign=${campaignId}`)}
              >
                <NavIcon name="canvas" /> Холст
              </button>
              <button type="button" onClick={() => navigate(`/adventures/${adv.id}?campaign=${campaignId}`)}>
                Редактировать
              </button>
            </>
          )}
        </div>
      </header>
      <div className="res-group__body campaign-chapters__body">
        {selected && !adv.is_default && <CampaignAdventureOverview campaignId={campaignId} adventureId={adv.id} />}
        {/* Сцены, лежащие прямо на приключении: у книжного импорта их
            почти не бывает, у самодельного — наоборот, все. */}
        {adv.scenes.length > 0 && chapterId == null && (
          <SceneList
            scenes={adv.scenes}
            campaignId={campaignId}
            onStatus={onStatus}
            title={adv.chapters.length > 0 ? "Без главы" : null}
          />
        )}
        {advChapters.map((c) => {
          const chDone = c.scenes.filter((s) => s.state?.status === "done").length;
          const chHoles = holesIn(c.scenes);
          return (
            <details
              key={c.id}
              className="card res-group campaign-chapters__chapter"
              open={openCh.has(c.id)}
              onToggle={(e) => toggleCh(c.id, e.currentTarget.open)}
            >
              <summary className="res-group__band">
                <span className="res-group__title">{c.name}</span>
                <span className="res-group__count">
                  {c.scenes.length > 0 ? `сыграно ${chDone} из ${c.scenes.length}` : "сцен нет"}
                  {chHoles > 0 && <span className="campaign-adv__holes-note"> · {holesLabel(chHoles)}</span>}
                </span>
                {c.is_override && <span className="campaign-scene__note">правка кампании</span>}
              </summary>
              <div className="res-group__body campaign-chapters__scenes">
                <SceneList scenes={c.scenes} campaignId={campaignId} onStatus={onStatus} title={null} />
              </div>
            </details>
          );
        })}
        {all.length === 0 && (
          <div className="card" style={{ borderStyle: "dashed" }}>
            <p className="muted" style={{ maxWidth: "62ch" }}>Сцен пока нет — добавьте первую в сеттинге или создайте «только в кампании».</p>
          </div>
        )}
      </div>
    </section>
  );
}

function countByStatus(scenes: StoryScene[]) {
  let done = 0, skipped = 0, pending = 0;
  for (const s of scenes) {
    if (s.state?.status === "done") done++;
    else if (s.state?.status === "skipped") skipped++;
    else pending++;
  }
  return { done, skipped, pending };
}

/**
 * Текущее приключение кампании (гриллинг «Сюжета» 2026-10-23, Q7): где лежит
 * сцена ближайшей ещё не сыгранной сессии, иначе — сцена последней сыгранной.
 * Прошедшие даты плана не в счёт: несыгранное само переезжает в новую сессию,
 * а в старой остаётся след.
 */
function currentAdventureId(tree: CampaignAdventureTree[]): number | null {
  const today = new Date().toLocaleDateString("sv");
  let next: { date: string; adv: number } | null = null;
  let last: { date: string; adv: number } | null = null;
  for (const adv of tree) {
    for (const s of [...adv.scenes, ...adv.chapters.flatMap((c) => c.scenes)]) {
      for (const x of s.sessions) {
        if (!x.played && x.date >= today && (!next || x.date < next.date)) next = { date: x.date, adv: adv.id };
        if (x.played && (!last || x.date > last.date)) last = { date: x.date, adv: adv.id };
      }
    }
  }
  return (next ?? last)?.adv ?? null;
}

const SceneList = memo(function SceneList({
  scenes,
  campaignId,
  onStatus,
  title,
}: {
  scenes: StoryScene[];
  campaignId: number;
  onStatus: (sceneId: number, status: string) => void;
  title: string | null;
}) {
  // Смена статуса сцены правит одну строку: перечитывать всё дерево
  // приключений (у книжной кампании это сотни строк) из-за неё нельзя.
  // Статус меняется сразу; при отказе возвращается прежний и появляется плашка.
  const run = useAction();
  const setStatus = useCallback(
    async (scene: StoryScene, status: string) => {
      const previous = scene.state?.status ?? "pending";
      onStatus(scene.id, status);
      const saved = await run(
        labelled("Статус сцены", () => write.put(`/story/scenes/${scene.id}/state`, { campaign_id: campaignId, status }).then(() => true)),
        { affects: sceneStatusAffects(campaignId, scene.id) }
      );
      if (!saved) onStatus(scene.id, previous);
    },
    [campaignId, onStatus, run]
  );

  return (
    <div className="campaign-scene-list">
      {title && <span className="campaign-scene-list__title muted">{title}</span>}
      {scenes.map((s) => (
        <SceneRow key={s.id} scene={s} campaignId={campaignId} onStatus={setStatus} />
      ))}
      {scenes.length === 0 && <span className="muted" style={{ fontSize: "var(--fs-meta)" }}>Сцен пока нет.</span>}
    </div>
  );
});

const SceneRow = memo(function SceneRow({
  scene: s,
  campaignId,
  onStatus,
}: {
  scene: StoryScene;
  campaignId: number;
  onStatus: (scene: StoryScene, status: string) => void;
}) {
  const status = s.state?.status ?? "pending";
  const stamp = status === "pending" ? null : rasterAsset("ui/plot-restyle/v1", `stamp-${status}`);
  const kind = nodeLabel(s);
  const kindFrame = rasterAsset("ui/plot-restyle/v1", "kind-window");
  return (
    <details className="campaign-scene">
      <summary className="campaign-scene__summary">
        <span
          className={`campaign-scene__kind${kind.length > 10 ? " campaign-scene__kind--long" : ""}`}
          style={{ backgroundImage: kindFrame ? `url("${kindFrame}")` : undefined }}
        >{kind}</span>
        <span className="campaign-scene__name">{s.name}</span>
        {(status !== "pending" || s.is_override || s.campaign_only) && (
          <span className="campaign-scene__tags">
            {s.is_override && <span className="campaign-scene__note">правка</span>}
            {s.campaign_only && <span className="campaign-scene__note">только в кампании</span>}
            {stamp ? (
              <img className="campaign-scene__stamp" src={stamp} alt={status === "done" ? "ПРОЙДЕНО" : "ПРОПУЩЕНО"} width={104} height={32} />
            ) : status !== "pending" ? (
              <span className="campaign-scene__note">{SCENE_STATUSES.find((st) => st.key === status)?.label}</span>
            ) : null}
          </span>
        )}
      </summary>
      <div className="campaign-scene__expanded">
        {s.summary ? (
          <div className="reading-text" style={{ whiteSpace: "pre-wrap" }}>
            <MentionText text={s.summary} />
          </div>
        ) : (
          <span className="muted" style={{ fontSize: "var(--fs-meta)" }}>Сводки нет — откройте сцену, чтобы добавить.</span>
        )}
        <div className="row campaign-scene__actions">
          <select aria-label={`Статус сцены «${s.name}»`} value={status} onChange={(e) => onStatus(s, e.target.value)}>
            {SCENE_STATUSES.map((st) => (
              <option key={st.key} value={st.key}>
                {st.label}
              </option>
            ))}
          </select>
          <Link to={`/scenes/${s.id}?campaign=${campaignId}`}>Открыть сцену →</Link>
        </div>
      </div>
    </details>
  );
});
