import { memo, useCallback, useEffect, useMemo, useState, type MouseEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Link, useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { useAction, useResource, write } from "../data/hooks";
import { dataKeys } from "../data/entities";
import { campaignPaths, sceneStatusAffects } from "../data/campaigns";
import { labelled } from "../data/notices";
import { MentionText } from "./mentions/MentionText";
import { EmptyState } from "./EmptyState";
import { SCENE_STATUSES, clueNeed, nodeLabel, plural, sceneWord } from "../sceneKinds";
import type { ArcClueNode, ArcClues, CampaignAdventureTree, CampaignReveals, CampaignTreeScene, SceneMakeup, SceneStatus, StoryScene } from "../types";
import { NavIcon, type NavIconName } from "./NavIcons";
import { ContextMenu } from "./ContextMenu";
import { arcCluesPath } from "../data/canvas";
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
  onPickAdventure,
}: {
  campaignId: number;
  settingId: number | null;
  // Master–Detail: показать одно приключение (и внутри — одну главу).
  // Не задано — всё дерево, как раньше.
  adventureId?: number | null;
  chapterId?: number | null;
  onStats?: (s: ChaptersNavStats) => void;
  /** Щелчок по карточке в «Все приключения». */
  onPickAdventure?: (adventureId: number) => void;
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
  const current = currentAdventureId(tree);

  return (
    <div className="stack campaign-chapters">
      {adventureId != null && visibleTree.length === 0 && (
        <p className="muted">Приключение не найдено — возможно, его открепили.</p>
      )}
      {adventureId == null && <AdventuresOverview tree={tree} campaignId={campaignId} onPick={onPickAdventure} />}
      {adventureId != null && visibleTree.map((adv) => (
        <AdventureSection
          key={adv.id}
          adv={adv}
          campaignId={campaignId}
          settingId={settingId}
          selected={adventureId === adv.id}
          chapterId={chapterId ?? null}
          current={adv.id === current}
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
 * Сцена ещё впереди: не отмечена и ни разу не запускалась. Запуск без отметки —
 * партия до сцены дошла, как и «посещён» в «Выводах».
 */
const isAhead = (s: CampaignTreeScene) => isPending(s) && !s.sessions.some((x) => x.played);

/** Дыры правила трёх — только у сцен впереди: у пройденной улики уже ничего не решают. */
function countHoles(list: CampaignTreeScene[], nodeBy: Map<number, ArcClueNode>) {
  return list.filter((s) => isAhead(s) && isHole(nodeBy.get(s.id))).length;
}

/**
 * Граф улик приключения для «Сюжета». Приключение, где улик нет вовсе, ещё не
 * размечено по узлам — его узлы не дыры, а «ещё не начато»: счётчиков нет,
 * в шапке серая подсказка (решение владельца 2026-10-23).
 */
function useClueNodes(adv: CampaignAdventureTree, campaignId: number) {
  const clues = useResource<ArcClues>(adv.is_default ? null : arcCluesPath(adv.id, campaignId)).data;
  const unmarked = !!clues && clues.nodes.every((n) => n.clue_in === 0 && n.clue_out === 0);
  const nodeBy = useMemo(
    () => new Map(unmarked ? [] : (clues?.nodes ?? []).map((n) => [n.shown_id, n])),
    [clues, unmarked]
  );
  return { clues: unmarked ? undefined : clues, nodeBy, unmarked };
}

const allScenes = (adv: CampaignAdventureTree) => [...adv.scenes, ...adv.chapters.flatMap((c) => c.scenes)];
/**
 * Состав (гриллинг 2026-10-23): NPC, локации, препятствия, сокровища.
 * В шапке приключения — значок и слово, с нулями. В строке сцены — значок
 * и число в своих столбцах справа, как в концепте; над столбцами — подписи.
 */
const MAKEUP_WORDS: [keyof SceneMakeup, NavIconName, string, [string, string, string]][] = [
  ["characters", "players", "NPC", ["NPC", "NPC", "NPC"]],
  ["locations", "pin", "Лок.", ["локация", "локации", "локаций"]],
  ["obstacles", "skull", "Преп.", ["препятствие", "препятствия", "препятствий"]],
  ["loot", "bag", "Сокр.", ["сокровище", "сокровища", "сокровищ"]],
];
const makeupCount = (m: SceneMakeup, k: keyof SceneMakeup) => m[k].length;

function Makeup({ m, words }: { m: SceneMakeup; words?: boolean }) {
  // Нули показываются везде (решение владельца), только бледнее.
  const cells = MAKEUP_WORDS.map(([k, icon, , forms]) => {
    const n = makeupCount(m, k);
    const label = `${n} ${plural(n, ...forms)}`;
    return (
      <span key={k} className={`campaign-makeup__cell${n === 0 ? " is-zero" : ""}`} title={label}>
        <NavIcon name={icon} />
        {words ? label : n}
      </span>
    );
  });
  return <span className={`campaign-makeup${words ? " campaign-makeup--words" : ""}`}>{cells}</span>;
}
/** Подписи над столбцами состава — строкой той же сетки, что у сцен. */
function MakeupHeads() {
  return (
    <div className="campaign-scene__summary campaign-scene__heads" aria-hidden="true">
      <span />
      <span />
      <span className="campaign-makeup">
        {MAKEUP_WORDS.map(([k, , head]) => (
          <span key={k} className="campaign-makeup__cell">{head}</span>
        ))}
      </span>
      <span className="campaign-scene__clues" />
      <span className="campaign-scene__session" />
      <span className="campaign-scene__more" />
    </div>
  );
}

/** Состав приключения: каждая сущность один раз. */
function adventureMakeup(scenes: CampaignTreeScene[]): SceneMakeup {
  const uniq = (k: keyof SceneMakeup) => [...new Set(scenes.flatMap((s) => s.makeup[k]))];
  return { characters: uniq("characters"), locations: uniq("locations"), obstacles: uniq("obstacles"), loot: uniq("loot") };
}

const holesLabel = (n: number) => `⚠ ${n} ${plural(n, "узел", "узла", "узлов")} без трёх улик`;
const ADV_ROLE: Record<string, string> = { start: "старт", finale: "финал", proactive: "приходит само" };

/**
 * «Все приключения» (гриллинг «Сюжета» 2026-10-23, Q15): обзор кампании без
 * сцен — карточки приключений с ролью на карте кампании, прогрессом и дырами.
 */
function AdventuresOverview({
  tree,
  campaignId,
  onPick,
}: {
  tree: CampaignAdventureTree[];
  campaignId: number;
  onPick?: (adventureId: number) => void;
}) {
  const navigate = useNavigate();
  const reveals = useResource<CampaignReveals>(`/story/campaigns/${campaignId}/reveals`).data;
  const roleOf = new Map((reveals?.adventures ?? []).map((a) => [a.id, a.node_role]));
  const current = currentAdventureId(tree);
  const shown = tree.filter((a) => !a.is_default || allScenes(a).length > 0);
  const scenes = shown.flatMap(allScenes);
  const { done } = countByStatus(scenes);
  const planned = scenes.filter((s) => isPending(s) && plannedSession(s)).length;
  const advCount = shown.filter((a) => !a.is_default).length;
  const facts = [
    `${advCount} ${plural(advCount, "приключение", "приключения", "приключений")}`,
    `${scenes.length} ${sceneWord(scenes.length)}`,
    `${done} сыграно`,
    planned > 0 && `${planned} в сессиях`,
  ].filter(Boolean);

  return (
    <section className="campaign-adv-overview">
      <div className="d-gh campaign-adv-overview__head">
        <h2 className="d-plate">Все приключения</h2>
        <span className="d-note">{facts.join(" · ")}</span>
        <span className="d-end">
          <button type="button" className="d-btn" onClick={() => navigate(`/canvas?campaign=${campaignId}&view=map`)}>
            <NavIcon name="canvas" /> Карта кампании
          </button>
        </span>
      </div>
      <div className="campaign-adv-cards">
        {shown.map((adv) => (
          <AdventureCard
            key={adv.id}
            adv={adv}
            campaignId={campaignId}
            role={roleOf.get(adv.id)}
            current={adv.id === current}
            onPick={onPick}
          />
        ))}
      </div>
    </section>
  );
}

function AdventureCard({
  adv,
  campaignId,
  role,
  current,
  onPick,
}: {
  adv: CampaignAdventureTree;
  campaignId: number;
  role: string | undefined;
  current: boolean;
  onPick?: (adventureId: number) => void;
}) {
  const { nodeBy, unmarked } = useClueNodes(adv, campaignId);
  const all = allScenes(adv);
  const { done } = countByStatus(all);
  const holes = countHoles(all, nodeBy);
  // Плитка (макет Camp-Story-All): над названием — роль на карте кампании,
  // под ним полоса сыгранного; текущее — кромкой и кислотным квадратиком.
  const kicker = adv.is_default ? "вне приключений" : [current && "текущее", role && ADV_ROLE[role]].filter(Boolean).join(" · ");
  return (
    <button
      type="button"
      className={`campaign-adv-card${adv.is_default ? " is-dim" : ""}${current ? " is-current" : ""}`}
      onClick={() => onPick?.(adv.id)}
    >
      {kicker && <span className="d-mono campaign-adv-card__kicker">{kicker}</span>}
      {current && <span className="campaign-adv-card__now" aria-label="текущее" />}
      <span className="campaign-adv-card__name">{adv.name}</span>
      {!adv.is_default && (
        <span className="campaign-adv-card__bar" aria-hidden="true">
          <i style={{ width: `${all.length ? Math.round((done / all.length) * 100) : 0}%` }} />
        </span>
      )}
      <span className="campaign-adv-card__facts">
        {adv.is_default
          ? `${all.length} ${sceneWord(all.length)}`
          : all.length > 0 ? `сыграно ${done} из ${all.length}` : "сцен нет"}
        {holes > 0 && <span className="campaign-adv__holes-note">{holesLabel(holes)}</span>}
        {unmarked && <span>улик ещё нет</span>}
      </span>
    </button>
  );
}

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
  current,
  onStatus,
}: {
  adv: CampaignAdventureTree;
  campaignId: number;
  settingId: number | null;
  selected: boolean;
  chapterId: number | null;
  /** Текущее приключение кампании — главный блок вкладки, в тушь-рамке (Q4). */
  current: boolean;
  onStatus: (sceneId: number, status: string) => void;
}) {
  const navigate = useNavigate();
  const { clues, nodeBy, unmarked } = useClueNodes(adv, campaignId);
  const holesIn = (list: CampaignTreeScene[]) => countHoles(list, nodeBy);

  const [openCh, setOpenCh] = useState(() => new Set(adv.chapters.filter((c) => c.scenes.some(isPending)).map((c) => c.id)));
  const toggleCh = (id: number, open: boolean) =>
    setOpenCh((prev) => {
      if (prev.has(id) === open) return prev;
      const next = new Set(prev);
      if (open) next.add(id);
      else next.delete(id);
      return next;
    });

  const all = allScenes(adv);
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

  return (
    <section className="campaign-chapters__adventure">
      <header className={`${current ? "d-focal" : "d-block"} campaign-adv__head`}>
        <div className="campaign-adv__title">
          {current && <span className="d-mono">Текущее приключение</span>}
          <h2>{adv.name}</h2>
          {logline && (
            <span className="campaign-adv__logline">
              <MentionText text={logline} />
            </span>
          )}
          <span className="campaign-adv__facts">
            {facts.join(" · ")}
            {adv.is_override && <span className="campaign-scene__note">правка кампании</span>}
            <Makeup m={adventureMakeup(all)} words />
          </span>
          {unmarked && settingId != null && (
            <button
              type="button"
              className="campaign-adv__unmarked"
              onClick={() => navigate(`/canvas?setting=${settingId}&arc=${adv.id}&campaign=${campaignId}`)}
            >
              Улик ещё нет — разметить на холсте
            </button>
          )}
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
            <span className="campaign-adv__buttons">
              <button
                type="button"
                className="d-btn"
                onClick={() => navigate(`/canvas?setting=${settingId}&arc=${adv.id}&campaign=${campaignId}`)}
              >
                <NavIcon name="canvas" /> Холст
              </button>
              <button type="button" className="d-btn d-btn--quiet" onClick={() => navigate(`/adventures/${adv.id}?campaign=${campaignId}`)}>
                Редактировать
              </button>
            </span>
          )}
        </div>
      </header>
      <div className="campaign-chapters__body">
        {selected && !adv.is_default && <CampaignAdventureOverview campaignId={campaignId} adventureId={adv.id} />}
        {/* Сцены, лежащие прямо на приключении: у книжного импорта их
            почти не бывает, у самодельного — наоборот, все. */}
        {adv.scenes.length > 0 && chapterId == null && (
          <SceneList
            scenes={adv.scenes}
            campaignId={campaignId}
            settingId={settingId}
            onStatus={onStatus}
            title={adv.chapters.length > 0 ? "Без главы" : null}
            clues={clues}
            nodeBy={nodeBy}
          />
        )}
        {advChapters.map((c) => {
          const chDone = c.scenes.filter((s) => s.state?.status === "done").length;
          const chHoles = holesIn(c.scenes);
          return (
            <details
              key={c.id}
              className="campaign-chapters__chapter"
              open={openCh.has(c.id)}
              onToggle={(e) => toggleCh(c.id, e.currentTarget.open)}
            >
              <summary className="campaign-chapter__head">
                <span className="campaign-chapter__title">{c.name}</span>
                <span className="campaign-chapter__count">
                  {c.scenes.length > 0 ? `сыграно ${chDone} из ${c.scenes.length}` : "сцен нет"}
                  {chHoles > 0 && <span className="campaign-adv__holes-note"> · {holesLabel(chHoles)}</span>}
                </span>
                {c.is_override && <span className="campaign-scene__note">правка кампании</span>}
              </summary>
              <div className="campaign-chapters__scenes">
                <SceneList
                  scenes={c.scenes}
                  campaignId={campaignId}
                  settingId={settingId}
                  onStatus={onStatus}
                  title={null}
                  clues={clues}
                  nodeBy={nodeBy}
                />
              </div>
            </details>
          );
        })}
        {all.length === 0 && (
          <p className="muted">Сцен пока нет — добавьте первую в сеттинге или создайте «только в кампании».</p>
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
  settingId,
  onStatus,
  title,
  clues,
  nodeBy,
}: {
  scenes: CampaignTreeScene[];
  campaignId: number;
  settingId: number | null;
  onStatus: (sceneId: number, status: string) => void;
  title: string | null;
  clues: ArcClues | undefined;
  nodeBy: Map<number, ArcClueNode>;
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
      {scenes.length > 0 && <MakeupHeads />}
      {scenes.map((s) => (
        <SceneRow
          key={s.id}
          scene={s}
          campaignId={campaignId}
          settingId={settingId}
          onStatus={setStatus}
          node={nodeBy.get(s.id)}
          clues={clues}
        />
      ))}
      {scenes.length === 0 && <span className="muted" style={{ fontSize: "var(--fs-meta)" }}>Сцен пока нет.</span>}
    </div>
  );
});

const STATUS_LABEL: Record<string, string> = Object.fromEntries(SCENE_STATUSES.map((st) => [st.key, st.label]));

/**
 * Строка сцены (гриллинг «Сюжета» 2026-10-23, Q8/Q9/Q10): кружок статуса
 * (щелчок — пройдена ↔ не начата, «пропущена» — в «⋯»), «тип · роль»,
 * сессия, счётчик улик по правилу трёх. Раскрытие — что ведёт сюда и отсюда.
 */
const SceneRow = memo(function SceneRow({
  scene: s,
  campaignId,
  settingId,
  onStatus,
  node,
  clues,
}: {
  scene: CampaignTreeScene;
  campaignId: number;
  settingId: number | null;
  onStatus: (scene: StoryScene, status: string) => void;
  node: ArcClueNode | undefined;
  clues: ArcClues | undefined;
}) {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const status = s.state?.status ?? "pending";
  const kind = s.node_type || s.node_role !== "normal" ? nodeLabel(s) : null;
  const navigate = useNavigate();
  const played = s.sessions.filter((x) => x.played);
  const lastPlayed = played[played.length - 1] ?? null;
  const planned = lastPlayed ? null : plannedSession(s);

  // Улики: красным — только у сцены впереди (isAhead), которой не хватает до трёх.
  const need = node ? clueNeed(node.role, node.clue_in, node.passage_in) : null;
  let clueChip: ReactNode = null;
  if (node && need !== "start" && need !== "proactive") {
    const bad = need === "missing" && isAhead(s);
    clueChip = (
      <span
        className={`campaign-scene__clues${bad ? " is-bad" : ""}`}
        title={need === "passage" ? "За проходом — улики не обязательны" : need === "bonus" ? "Тупик — улики бонусные" : "Улик ведёт сюда"}
      >
        {need === "passage" ? "за проходом" : bad ? `улик ${node.clue_in}/3` : `улик ${node.clue_in}`}
      </span>
    );
  }

  const stop = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };
  const canvasUrl =
    settingId != null ? `/canvas?setting=${settingId}&arc=${s.arc_id ?? ""}&campaign=${campaignId}&focus=scene:${s.id}` : null;

  return (
    <details className={`campaign-scene is-${status}`}>
      <summary className="campaign-scene__summary">
        <button
          type="button"
          className="campaign-scene__mark"
          aria-label={status === "done" ? `Снять отметку «пройдена» со сцены «${s.name}»` : `Отметить сцену «${s.name}» пройденной`}
          title={STATUS_LABEL[status]}
          onClick={(e) => {
            stop(e);
            onStatus(s, status === "done" ? "pending" : "done");
          }}
        />
        <span className="campaign-scene__name">
          {s.name}
          {kind && <span className="campaign-scene__kind"> · {kind}</span>}
          {s.is_override && <span className="campaign-scene__note">правка</span>}
          {s.campaign_only && <span className="campaign-scene__note">только в кампании</span>}
        </span>
        <Makeup m={s.makeup} />
        {clueChip ?? <span className="campaign-scene__clues is-none" />}
        <span className="campaign-scene__session">
          {lastPlayed ? `Сессия №${lastPlayed.number}` : planned ? <span className="muted">в сессии №{planned.number}</span> : null}
        </span>
        <button
          type="button"
          className="d-dots campaign-scene__more"
          aria-label={`Статус сцены «${s.name}»`}
          aria-haspopup="menu"
          onClick={(e) => {
            stop(e);
            const r = e.currentTarget.getBoundingClientRect();
            setMenu({ x: r.right, y: r.bottom });
          }}
        >
          ⋯
        </button>
      </summary>
      {/* Порталом: содержимое свёрнутого <details>, кроме summary, не рисуется. */}
      {menu && createPortal(
        <ContextMenu
          x={menu.x}
          y={menu.y}
          title={s.name}
          ariaLabel={`Статус сцены «${s.name}»`}
          items={SCENE_STATUSES.filter((st) => st.key !== status).map((st) => ({
            label: st.label,
            onClick: () => onStatus(s, st.key),
          }))}
          onClose={() => setMenu(null)}
        />,
        document.body
      )}
      <div className="campaign-scene__expanded">
        {/* Переходы — кнопками справа от сводки: текст и так ограничен по ширине. */}
        <div className="campaign-scene__lead">
          {s.summary ? (
            <div className="reading-text" style={{ whiteSpace: "pre-wrap" }}>
              <MentionText text={s.summary} />
            </div>
          ) : (
            <span className="muted" style={{ fontSize: "var(--fs-meta)" }}>Сводки нет — откройте сцену, чтобы добавить.</span>
          )}
          {/* На телефоне состав уезжает из строки сюда, над кнопками (Q7). */}
          <span className="campaign-scene__makeup-inline">
            <Makeup m={s.makeup} words />
          </span>
          <div className="campaign-scene__actions">
            <button type="button" className="d-btn d-btn--sm" onClick={() => navigate(`/scenes/${s.id}?campaign=${campaignId}`)}>Открыть сцену</button>
            {canvasUrl && (
              <button type="button" className="d-btn d-btn--sm d-btn--quiet" onClick={() => navigate(canvasUrl)}>
                На холсте
              </button>
            )}
          </div>
        </div>
        {node && clues && <SceneClues node={node} clues={clues} />}
        {s.sessions.length > 0 && (
          <span className="campaign-scene__sessions">
            {s.sessions.map((x) => `${x.played ? "Запускалась" : "Запланирована"} в №${x.number}`).join(" · ")}
          </span>
        )}
      </div>
    </details>
  );
});

/** «Ведут сюда» и «Ведёт отсюда» узла (Q10) — те же улики, что в карточке узла. */
function SceneClues({ node, clues }: { node: ArcClueNode; clues: ArcClues }) {
  const nameOf = (id: number | null) => clues.nodes.find((n) => n.id === id)?.name ?? "лоток";
  const incoming = clues.clues.filter((c) => c.target_type === "scene" && c.target_id === node.id && !c.proposed);
  const outgoing = clues.clues.filter((c) => c.node_id === node.id && !c.proposed);
  return (
    <div className="campaign-scene__clue-lists">
      {node.role === "proactive" && node.trigger && (
        <p className="campaign-scene__trigger">
          <strong>Приходит сам:</strong> {node.trigger}
        </p>
      )}
      <div>
        <span className="campaign-field-label">Ведут сюда</span>
        {incoming.length === 0 ? (
          <span className="muted"> — ни одной улики</span>
        ) : (
          <ul className="campaign-scene__clue-list">
            {incoming.map((c) => (
              <li key={c.id} className={c.found ? "is-found" : undefined}>
                {c.text} · <span className="muted">{nameOf(c.node_id)}</span>
                {c.found && <span className="campaign-scene__found"> · найдена</span>}
              </li>
            ))}
          </ul>
        )}
      </div>
      {outgoing.length > 0 && (
        <div className="muted">
          <span className="campaign-field-label">Ведёт отсюда</span>
          <ul className="campaign-scene__clue-list">
            {outgoing.map((c) => (
              <li key={c.id}>
                {c.text} → {c.target_title ?? "никуда"}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
