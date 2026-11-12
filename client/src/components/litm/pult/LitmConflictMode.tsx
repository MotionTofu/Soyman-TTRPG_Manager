import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  challengeStateFromProfile,
  giveToLimit,
  journeyArrived,
  limitReached,
  passStep,
  overcomeBy,
  startCamp,
  passSpotlight,
  reduceLimit,
  turnedLimits,
  type LitmChallengeState,
  type LitmSceneState,
  type LitmStepOutcome,
} from "@shared/litm/conflict";
import { giveStatus, heroCondition, parseStatusTag, reduceStatus, sameStatus, statusTier, type LitmStatus } from "@shared/litm/status";
import { useResource } from "../../../data/hooks";
import { readResource } from "../../../data/imperative";
import { sessionPaths } from "../../../data/sessions";
import { statblockListPath } from "../../../data/statblocks";
import { useConfirm, usePrompt } from "../../../hooks/useConfirm";
import { Ribbon } from "../../../combat/CombatMode";
import { ContextMenu, type ContextMenuItem } from "../../ContextMenu";
import type { Character, InitiativeEntry, LitMCharacterData, SessionStage, SessionUnionRow, Statblock } from "../../../types";
import { normalizeCharacter } from "../LitMCharacterForm";
import { LitmStatusCards } from "../LitmStatusCards";
import { LitmChallengeProfile } from "../LitmChallengeProfile";
import { LitmRich, MightMark, Rating, Status } from "../LitmBook";
import { challengeProfile, mightOf, type LitmChallengeProfileData } from "../litmChallenge";
import { patchLitmSheet, toggleScratch, useLitmSheet } from "./litmSheetWrite";
import { noteLitm, useLitmBattle } from "./litmLog";
import { lastLiveTurn, undoableIds, type BattleLogLine } from "../../../combat/battleLog";
import { limitFor, type ConsequenceAction } from "./consequence";
import { LitmThreats } from "./LitmThreats";
import { LitmGiveStatus, type GiveInitial, type GiveRequest, type GiveTarget } from "./LitmGiveStatus";
import { useLitmBook, type LitmBookEntry } from "./useLitmBook";
import { LITM_RIBBON_TARGET, useLitmRibbon, type LitmRibbon, type LitmSource } from "./useLitmRibbon";
import { useUnloadTarget } from "../../../unloadTargets";
import { LitmAddPanel } from "./LitmAddPanel";
import { LitmGrimoireDrawer } from "./LitmGrimoireDrawer";
import { LitmJourneyBar, LitmVignetteNest } from "./LitmJourney";
import { LitmCampBar } from "./LitmCamp";
import { LitmRewardsDrawer } from "./LitmRewardsDrawer";
import "../litm-book.css";
import "./litm-pult.css";

const NO_STATBLOCKS: Statblock[] = [];
const BOXES = [1, 2, 3, 4, 5, 6];

/** Фокус в поле ввода или открыто окно — пробел печатает, а не передаёт спотлайт. */
function keysBlocked(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  const tag = el?.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el?.isContentEditable) return true;
  return !!document.querySelector(".modal-backdrop, .cm-layer, .context-menu");
}

/** «вечерня 4», «ливень-2», «закат 6» → имя и число; без числа — null. */
function nameAndNumber(text: string): { name: string; n: number } | null {
  const m = /^(.+?)[\s-]+(\d)$/.exec(text.trim());
  return m ? { name: m[1].trim(), n: Number(m[2]) } : null;
}

/**
 * «На ленту» (Q16) для строк панелей пульта и «Мешка»: вызов книги или
 * существо сеттинга встаёт на ленту, даже когда режим закрыт. Ставится
 * страницей пульта в кампании LitM вместо трекера инициативы.
 */
export function LitmRibbonTarget({ sessionId }: { sessionId: number }) {
  const ribbon = useLitmRibbon(sessionId);
  useUnloadTarget({
    label: LITM_RIBBON_TARGET,
    accepts: (item) => item.type === "being" || (item.type === "compendium_entry" && (!item.kind || item.kind === "monster")),
    drop: (item) => ribbon.add({ type: item.type as "being" | "compendium_entry", id: item.id, name: item.title }, 1),
  });
  return null;
}

/** Статус, только что полученный героем: «Смягчить» уменьшает входящий
 *  уровень до сложения (Q14); плашка гаснет с передачей спотлайта. */
interface Incoming {
  id: number;
  heroId: number;
  heroName: string;
  name: string;
  into?: string;
  tier: number;
  /** Отметки статуса до получения; null — статуса не было. */
  prev: number[] | null;
}

/** Что гнездо берёт у режима: запись, меню, окно статуса, последствия, надстройки. */
interface NestCtx {
  ribbon: LitmRibbon;
  onMenu: OpenMenu;
  confirm: Confirm;
  openGive: (initial: GiveInitial) => void;
  runAction: (row: InitiativeEntry, action: ConsequenceAction, e: { clientX: number; clientY: number }, threat: number, edit: boolean) => void;
  addonMenu: (row: InitiativeEntry) => ContextMenuItem[];
  book: Map<number, LitmBookEntry>;
}

let incomingSeq = 0;

/**
 * Режим «Вызовы» пульта Legend in the Mist (Backlog Д33, доска Litm-Pult):
 * сверху полоса «Сцена», под ней герои со статусами и спотлайтом, ниже лента
 * вызовов с полным профилем. Инициативы, хитов и раундов нет — спотлайт
 * передаётся пробелом следующему, кто в круге не ходил (Q4).
 */
export function LitmConflictMode({
  sessionId,
  systemId,
  settingId,
  characters,
  union,
}: {
  sessionId: number;
  systemId: number | null;
  settingId: number | null;
  characters: Character[];
  union: SessionUnionRow[];
}) {
  const ribbon = useLitmRibbon(sessionId);
  const fight = useLitmBattle(sessionId);
  const { scene } = ribbon;
  const stage = useResource<SessionStage>(sessionPaths.stage(sessionId)).data ?? null;
  const current = stage?.current ?? null;
  const [adding, setAdding] = useState(false);
  const [grimOpen, setGrimOpen] = useState(false);
  const closeGrim = useCallback(() => setGrimOpen(false), []);
  const [rewardsOpen, setRewardsOpen] = useState(false);
  const closeRewards = useCallback(() => setRewardsOpen(false), []);
  const [confirmDialog, confirm] = useConfirm();
  const [promptDialog, prompt] = usePrompt();
  const [menu, setMenu] = useState<{ x: number; y: number; items: ContextMenuItem[]; title?: string } | null>(null);
  const [give, setGive] = useState<GiveInitial | null>(null);
  const [incoming, setIncoming] = useState<Incoming[]>([]);
  const bookList = useLitmBook(systemId);
  const book = useMemo(() => new Map(bookList.map((b) => [b.entry.id, b])), [bookList]);
  const addonBook = useMemo(() => bookList.filter((b) => b.profile.addon), [bookList]);
  // Кто из героев повержен (статус 5+) — спотлайт его пропускает. Карточки
  // читают свои листы сами и сообщают сюда.
  const [down, setDown] = useState<Record<number, boolean>>({});
  const order = useMemo(() => characters.map((c) => c.id), [characters]);
  const out = useMemo(() => order.filter((id) => down[id]), [order, down]);

  const sp = scene.spotlight;
  const next = useMemo(() => passSpotlight(sp, order, out).current, [sp, order, out]);

  function spotlight(to?: number) {
    const name = characters.find((c) => c.id === (to ?? next))?.character_name ?? "";
    setIncoming([]);
    void ribbon.setScene(`Спотлайт · ${name}`, { ...scene, spotlight: passSpotlight(sp, order, out, to) }, true);
  }

  /** «Назад» (Q15): отменить последнюю передачу спотлайта и всё, что склеилось с ней. */
  function back() {
    const turn = lastLiveTurn(fight.log);
    if (!turn || !undoableIds(fight.log).has(turn.id)) return;
    setIncoming([]);
    void fight.undo(turn);
  }

  const heroName = (id: number) => characters.find((c) => c.id === id)?.character_name ?? "Герой";
  /** Правка листа героя с пульта — с записью в лог конфликта. */
  const sheet = (id: number, label: string, fields: Parameters<typeof patchLitmSheet>[2]) =>
    patchLitmSheet(id, label, fields, { sessionId, name: heroName(id) });

  async function giveHero(id: number, req: Pick<GiveRequest, "name" | "tier" | "mode" | "into">) {
    const seen: { prev?: number[] | null } = {};
    const target = req.into ?? req.name;
    await sheet(id, `${heroName(id)}: ${req.name}-${req.tier}`, (d) => {
      const list = d.statuses ?? [];
      seen.prev = list.find((s) => sameStatus(s.name, target))?.marks ?? null;
      return { statuses: req.mode === "give" ? giveStatus(list, req.name, req.tier, req.into) : reduceStatus(list, target, req.tier) };
    });
    if (req.mode === "give" && seen.prev !== undefined) {
      const inc: Incoming = { id: ++incomingSeq, heroId: id, heroName: heroName(id), name: req.name, into: req.into, tier: req.tier, prev: seen.prev };
      setIncoming((list) => [...list, inc]);
    }
  }

  /** «Смягчить» (Q14): вернуть статус к прежним отметкам и дать заново на `by` слабее. */
  async function mitigate(inc: Incoming, by: number) {
    const tier = inc.tier - by;
    const target = inc.into ?? inc.name;
    await sheet(inc.heroId, `${inc.heroName}: смягчить ${inc.name}`, (d) => {
      const restored = (d.statuses ?? []).flatMap((s) => (!sameStatus(s.name, target) ? [s] : inc.prev?.length ? [{ ...s, marks: inc.prev }] : []));
      return { statuses: tier > 0 ? giveStatus(restored, inc.name, tier, inc.into) : restored };
    });
    setIncoming((list) => (tier > 0 ? list.map((x) => (x.id === inc.id ? { ...x, tier } : x)) : list.filter((x) => x.id !== inc.id)));
  }

  function challengeNext(st: LitmChallengeState, req: Pick<GiveRequest, "name" | "tier" | "mode" | "limit">): LitmChallengeState {
    if (req.limit != null) return req.mode === "give" ? giveToLimit(st, req.limit, req.name, req.tier) : reduceLimit(st, req.limit, req.tier);
    return { ...st, statuses: req.mode === "give" ? giveStatus(st.statuses, req.name, req.tier) : reduceStatus(st.statuses, req.name, req.tier) };
  }

  async function applyGive(req: GiveRequest) {
    const label = `${req.name}-${req.tier}`;
    for (const key of req.keys) {
      const [kind, raw] = key.split(":");
      if (kind === "hero") await giveHero(Number(raw), req);
      else if (kind === "row") {
        const row = ribbon.challenges.find((r) => r.id === Number(raw));
        if (row) await ribbon.setChallenge(row, `${row.name}: ${label}`, challengeNext(ribbon.stateOf(row), req));
      } else {
        const statuses = req.mode === "give" ? giveStatus(scene.statuses, req.name, req.tier, req.into) : reduceStatus(scene.statuses, req.into ?? req.name, req.tier);
        await ribbon.setScene(`Сцена: ${label}`, { ...scene, statuses });
      }
    }
  }

  const giveTargets: GiveTarget[] = [
    ...characters.map((c) => ({ key: `hero:${c.id}`, label: c.character_name, kind: "hero" as const, heroId: c.id })),
    ...ribbon.challenges.map((r) => {
      const st = ribbon.stateOf(r);
      return { key: `row:${r.id}`, label: r.name, kind: "challenge" as const, limits: st.limits.map((l) => ({ name: l.name, status: l.status, max: l.max })), statuses: st.statuses };
    }),
    { key: "scene", label: "Сцена", kind: "scene" as const, statuses: scene.statuses },
  ];

  /** «вычеркнуть тег» (Q12): теги силы героя в спотлайте — меню по темам. */
  async function scratchMenu(x: number, y: number) {
    const id = sp.current;
    if (id == null) return setMenu({ x, y, title: "Вычеркнуть тег", items: [{ label: "Сначала дайте спотлайт герою" }] });
    const rows = await readResource<Statblock[]>(statblockListPath("character", id), { fresh: true });
    const sb = rows.find((s) => s.format === "litm_character");
    let d: LitMCharacterData;
    try {
      d = normalizeCharacter(JSON.parse(sb?.content || "{}"));
    } catch {
      d = normalizeCharacter({});
    }
    const groups = [...d.themes.map((t, i) => ({ t, kind: "themes" as const, i })), ...d.storyThemes.map((t, i) => ({ t, kind: "storyThemes" as const, i }))]
      .map(({ t, kind, i }) => ({
        label: t.name || "Без названия",
        children: [t.name, ...t.powerTags]
          .filter((tag) => tag && !(t.scratchedTags ?? []).includes(tag))
          .map((tag) => ({ label: tag, onClick: () => void sheet(id, `${heroName(id)}: тег «${tag}»`, toggleScratch(kind, i, tag)) })),
      }))
      .filter((g) => g.children.length);
    setMenu({ x, y, title: `${heroName(id)}: вычеркнуть тег`, items: groups.length ? groups : [{ label: "Нечего вычёркивать" }] });
  }

  /** Последствие по разметке (Q12); `edit` — открыть «Дать статус» с подставленным. */
  function runAction(row: InitiativeEntry, a: ConsequenceAction, e: { clientX: number; clientY: number }, threat: number, edit: boolean) {
    const st = ribbon.stateOf(row);
    const settle = (next: LitmChallengeState) => (next.declaredThreat === threat ? { ...next, declaredThreat: null, declaredLead: "" } : next);
    if (a.kind === "named") {
      // «Заблокировано» на виньетке перекрывает путь: шаг дальше только «Одолели» (Q7, вариант «а» 2026-11-13).
      if (a.name === "Заблокировано" && st.vignette && !st.vignette.blocksPath) {
        void ribbon.setChallenge(row, `${row.name}: Заблокировано — путь перекрыт`, settle({ ...st, vignette: { ...st.vignette, blocksPath: true } }));
        return;
      }
      noteLitm(sessionId, `${row.name}: ${a.name}`);
      if (st.declaredThreat === threat) void ribbon.setChallenge(row, `${row.name}: угроза разрешена`, settle(st));
      return;
    }
    if (a.kind === "scratch") {
      void scratchMenu(e.clientX, e.clientY);
      if (st.declaredThreat === threat) void ribbon.setChallenge(row, `${row.name}: угроза разрешена`, settle(st));
      return;
    }
    if (a.kind === "reduce") {
      const limit = limitFor(st.limits, a.name);
      const has = st.statuses.some((s) => sameStatus(s.name, a.name));
      if (edit || (limit == null && !has)) return setGive({ keys: [`row:${row.id}`], name: a.name, tier: a.by, mode: "reduce" });
      void ribbon.setChallenge(row, `${row.name}: −${a.by} ${a.name}`, settle(challengeNext(st, { name: a.name, tier: a.by, mode: "reduce", limit })));
      return;
    }
    if (a.self) {
      if (edit) return setGive({ keys: [`row:${row.id}`], name: a.name, tier: a.tier });
      void ribbon.setChallenge(row, `${row.name}: ${a.name}-${a.tier}`, settle(challengeNext(st, { name: a.name, tier: a.tier, mode: "give", limit: null })));
      return;
    }
    const heroes = a.all ? characters.map((c) => c.id) : sp.current != null ? [sp.current] : [];
    if (edit || !heroes.length) return setGive({ keys: heroes.map((id) => `hero:${id}`), name: a.name, tier: a.tier });
    void (async () => {
      for (const id of heroes) await giveHero(id, { name: a.name, tier: a.tier, mode: "give" });
      if (st.declaredThreat === threat) await ribbon.setChallenge(row, `${row.name}: угроза разрешена`, settle(st));
    })();
  }

  /** «⋯ → Надстройка» (Q17): пределы и стартовые статусы надстройки — в строку гнезда. */
  function addonMenu(row: InitiativeEntry): ContextMenuItem[] {
    if (!addonBook.length) return [];
    const st = ribbon.stateOf(row);
    const on = addonBook.filter((b) => st.addons.includes(b.entry.id));
    const off = addonBook.filter((b) => !st.addons.includes(b.entry.id));
    const add = (b: LitmBookEntry) => {
      const extra = challengeStateFromProfile(b.profile);
      let statuses = st.statuses;
      for (const s of extra.statuses) statuses = giveStatus(statuses, s.name, statusTier(s.marks));
      const limits = [...st.limits, ...extra.limits.filter((l) => !st.limits.some((x) => sameStatus(x.name, l.name)))];
      void ribbon.setChallenge(row, `${row.name}: надстройка «${b.entry.name}»`, { ...st, limits, statuses, addons: [...st.addons, b.entry.id] });
    };
    const drop = (b: LitmBookEntry) => {
      const names = b.profile.limitList.map((l) => l.name);
      const limits = st.limits.filter((l) => !(names.some((n) => sameStatus(n, l.name)) && !l.marks.length));
      void ribbon.setChallenge(row, `${row.name}: снята надстройка «${b.entry.name}»`, { ...st, limits, addons: st.addons.filter((id) => id !== b.entry.id) });
    };
    return [
      {
        label: "Надстройка",
        children: [
          ...off.map((b) => ({ label: `${b.entry.name}${b.profile.rating ? ` · +${b.profile.rating}` : ""}`, onClick: () => add(b) })),
          ...on.map((b, i) => ({ label: `Снять «${b.entry.name}»`, danger: true, dividerBefore: i === 0 && off.length > 0, onClick: () => drop(b) })),
        ],
      },
    ];
  }

  const ctx: NestCtx = { ribbon, onMenu: setMenu, confirm, openGive: setGive, runAction, addonMenu, book };
  const declared = ribbon.challenges.filter((r) => ribbon.stateOf(r).declaredThreat != null);

  // Пробел — спотлайт следующему (Q4). Перехват на захвате, как в бою D&D:
  // плеер приложения тоже слушает пробел.
  const spotRef = useRef({ spotlight, back });
  spotRef.current = { spotlight, back };
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // G — шторка «Гримуар» (Q8)
      if (e.code === "KeyG" && !e.ctrlKey && !e.metaKey && !e.altKey && !e.repeat && !keysBlocked(e.target)) {
        e.preventDefault();
        setGrimOpen((o) => !o);
        return;
      }
      if (e.code !== "Space" || keysBlocked(e.target)) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.repeat) return;
      if (e.shiftKey) spotRef.current.back();
      else spotRef.current.spotlight();
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, []);

  const onRibbon = useMemo(() => new Set(ribbon.challenges.map((e) => `${e.entity_type}:${e.entity_id}`)), [ribbon.challenges]);
  // «В сцене: …» (Q2): вызовы из «Кого они приведут» текущей сцены — одним
  // нажатием на ленту, не сами.
  const suggested = union.filter((u) => u.inScene && (u.to_type === "compendium_entry" || u.to_type === "being"));

  // Сцена сменилась, а на полосе теги прежней (Q11) — спросить.
  const stale = current && scene.sceneId != null && scene.sceneId !== current.id && (scene.tags.length > 0 || scene.statuses.length > 0);

  /** «Привал» (Q8, Q13): открыть пошаговую полосу; сама не запускается. */
  function camp() {
    if (!scene.camp) void ribbon.setScene("Привал", { ...scene, camp: startCamp() });
  }

  async function endConflict() {
    const b = fight.battle;
    if (!b) return;
    const ok = await confirm({
      message: `Закончить «${b.name}»? Лог закроется, конфликт встанет в «Вызовы вечера» в «Итогах». Лента, статусы и теги остаются.`,
      confirmLabel: "Конец",
    });
    if (ok) await fight.end();
  }

  /** Правка полосы путешествия; последний шаг — строка «окончено» в лог (Q13). */
  async function setJourney(label: string, next: LitmSceneState["journey"]) {
    const ok = await ribbon.setScene(label, { ...scene, journey: next });
    if (ok && next && journeyArrived(next) && !(scene.journey && journeyArrived(scene.journey))) {
      noteLitm(sessionId, `Путешествие «${next.name}» окончено: ${next.passed.map((p) => p.name).join(", ")}`);
    }
  }

  /** «Одолели» / «Пройдено с последствиями» (Q7): шаг идущего путешествия, гнездо уходит с ленты. */
  async function passVignette(row: InitiativeEntry, outcome: Exclude<LitmStepOutcome, "skip">) {
    const said = outcome === "overcome" ? "одолели" : "пройдено с последствиями";
    const j = scene.journey;
    if (j && !journeyArrived(j)) await setJourney(`«${j.name}», шаг ${j.passed.length + 1}: ${row.name} — ${said}`, passStep(j, row.name, outcome));
    await ribbon.remove(row, `Виньетка «${row.name}»: ${said}`);
  }
  const journey = scene.journey;
  const currentVignette = journey
    ? (ribbon.challenges.find((r) => {
        const v = ribbon.stateOf(r).vignette;
        return v && (v.journeyId === journey.entryId || v.journeyId == null);
      })?.name ?? null)
    : null;

  async function addOwn() {
    const name = (await prompt({ message: "Свой участник сцены: союзник, вещь, ворота…", defaultValue: "", confirmLabel: "На ленту" }))?.trim();
    if (name) await ribbon.add({ type: "quick", name });
  }

  return (
    <div className="litm-pult litm-book">
      {confirmDialog}
      {promptDialog}
      <div className="lp-bar">
        <span className="lp-title">
          Вызовы<small>{ribbon.challenges.length ? `на ленте ${ribbon.challenges.length}` : "лента пуста"}</small>
        </span>
        {suggested.length > 0 && (
          <span className="lp-sugg">
            <span className="lp-mono">В сцене:</span>
            {suggested.map((u) => {
              const there = onRibbon.has(`${u.to_type}:${u.to_id}`);
              return (
                <button
                  key={`${u.to_type}:${u.to_id}`}
                  type="button"
                  className={`lp-chip${there ? " is-there" : ""}`}
                  title={there ? "Уже на ленте — ещё одна копия" : "На ленту"}
                  onClick={() => void ribbon.add({ type: u.to_type as "compendium_entry" | "being", id: u.to_id, name: u.name })}
                >
                  {u.name} {there ? "✓" : "+"}
                </button>
              );
            })}
          </span>
        )}
        <span className="lp-end">
          {next != null && <span className="lp-mono">Пробел → {characters.find((c) => c.id === next)?.character_name}</span>}
          <button type="button" className="d-btn d-btn--sm d-btn--ghost" onClick={() => setGive({ keys: sp.current != null ? [`hero:${sp.current}`] : [] })}>
            Дать статус
          </button>
          <button type="button" className={`d-btn d-btn--sm${grimOpen ? " is-on" : ""}`} aria-pressed={grimOpen} title="Гримуар действий — клавиша G" onClick={() => setGrimOpen(!grimOpen)}>
            Гримуар · G
          </button>
          <button type="button" className="d-btn d-btn--sm" onClick={() => setAdding(true)}>
            + Вызов
          </button>
          <button type="button" className="d-btn d-btn--sm d-btn--ghost" onClick={() => void addOwn()}>
            + Свой
          </button>
          {fight.battle && (
            <button type="button" className="d-btn d-btn--sm" onClick={() => void endConflict()}>
              Конец
            </button>
          )}
        </span>
      </div>

      <LitmLogStrip fight={fight} onBack={back} />

      {stale && (
        <div className="lp-plk" role="status">
          Сцена сменилась: «{current.name}». Снять теги и статусы прежней?
          <button type="button" className="d-btn d-btn--sm" onClick={() => void ribbon.setScene("Теги прежней сцены сняты", { ...scene, tags: [], statuses: [], sceneId: current.id })}>
            Снять
          </button>
          <button type="button" className="d-btn d-btn--sm d-btn--ghost" onClick={() => void ribbon.setScene("Теги сцены оставлены", { ...scene, sceneId: current.id })}>
            Оставить
          </button>
        </div>
      )}

      {incoming.map((inc) => (
        <div key={inc.id} className="lp-plk lp-inc" role="status">
          <b>{inc.heroName}</b> получает <Status name={inc.into ?? inc.name} tier={inc.tier} />
          {inc.into && <small>сложено с «{inc.into}»</small>}
          <button type="button" className="d-btn d-btn--sm" disabled={inc.tier <= 1} onClick={() => void mitigate(inc, 1)}>
            Смягчить −1
          </button>
          <button type="button" className="d-btn d-btn--sm d-btn--ghost" onClick={() => void mitigate(inc, inc.tier)}>
            Смягчить полностью
          </button>
          <button type="button" className="lp-x" aria-label="Скрыть плашку" onClick={() => setIncoming((l) => l.filter((x) => x.id !== inc.id))}>
            ✕
          </button>
        </div>
      ))}

      <SceneStrip
        scene={scene}
        sceneName={current?.name ?? null}
        onChange={(label, s) => void ribbon.setScene(label, { ...s, sceneId: s.sceneId ?? current?.id ?? null })}
        onMenu={setMenu}
        onCamp={camp}
        onRewards={() => setRewardsOpen((o) => !o)}
        rewardsOpen={rewardsOpen}
      />

      {journey && (
        <LitmJourneyBar
          journey={journey}
          current={currentVignette}
          onChange={(label, next) => void setJourney(label, next)}
          onCamp={camp}
          onMenu={(e, items) => setMenu({ x: e.clientX, y: e.clientY, title: journey.name, items })}
        />
      )}

      <div className="lp-heroes">
        {characters.length === 0 && <span className="lb-empty">За столом никого — герои берутся из партии кампании.</span>}
        {characters.map((c) => (
          <HeroCard
            key={c.id}
            character={c}
            now={sp.current === c.id}
            acted={sp.acted.includes(c.id)}
            isNext={next === c.id && sp.current !== c.id}
            count={sp.counts[c.id] ?? 0}
            onSpotlight={() => spotlight(c.id)}
            patch={(label, fields) => sheet(c.id, label, fields)}
            onDown={(v) => setDown((d) => (d[c.id] === v ? d : { ...d, [c.id]: v }))}
          />
        ))}
      </div>

      {scene.camp && (
        <LitmCampBar
          camp={scene.camp}
          heroes={characters}
          sceneTags={scene.tags}
          onChange={(label, next, tags) => void ribbon.setScene(label, { ...scene, camp: next, tags: tags ?? scene.tags })}
          sheet={sheet}
          note={(text) => noteLitm(sessionId, text)}
        />
      )}

      {declared.length > 0 && (
        <div className="lp-threats" role="status">
          {declared.map((r) => {
            const st = ribbon.stateOf(r);
            return (
              <span key={r.id} className="lp-pill">
                ⚠ <b>{r.name}</b>
                {st.declaredLead && (
                  <>
                    : <LitmRich text={st.declaredLead} />
                  </>
                )}
                <button
                  type="button"
                  className="lp-x"
                  aria-label={`Развязка: ${r.name}`}
                  title="Угроза разрешена"
                  onClick={() => void ribbon.setChallenge(r, `${r.name}: угроза разрешена`, { ...st, declaredThreat: null, declaredLead: "" })}
                >
                  ✕
                </button>
              </span>
            );
          })}
        </div>
      )}

      <Ribbon
        currentId={null}
        hint="Пробел — спотлайт следующему · Shift+пробел — назад · колесо — масштаб · средняя кнопка — сдвиг · ПКМ по пустому — добавить вызов"
        onContext={(x, y, nestId) => {
          if (nestId == null) return setAdding(true);
          const row = ribbon.challenges.find((e) => e.id === nestId);
          if (row) setMenu({ x, y, title: row.name, items: nestItems(row, ctx) });
        }}
      >
        <div className="lp-track">
          {ribbon.challenges.map((row) => {
            const v = ribbon.stateOf(row).vignette;
            return v ? (
              <LitmVignetteNest
                key={row.id}
                row={row}
                v={v}
                journey={journey}
                onAction={(a, e, edit) => runAction(row, a, e, 0, edit)}
                onPass={(outcome) => void passVignette(row, outcome)}
                onMenu={(e) => setMenu({ x: e.clientX, y: e.clientY, title: row.name, items: nestItems(row, ctx) })}
              />
            ) : (
              <ChallengeNest key={row.id} row={row} ctx={ctx} />
            );
          })}
          <button type="button" className="lp-nest lp-nest--new" onClick={() => setAdding(true)}>
            + Вызов
            <small>или ПКМ по пустому</small>
          </button>
        </div>
      </Ribbon>

      {adding && (
        <LitmAddPanel
          systemId={systemId}
          settingId={settingId}
          inScene={suggested}
          onClose={() => setAdding(false)}
          onAdd={async (src: LitmSource, count: number) => {
            await ribbon.add(src, count);
          }}
        />
      )}
      {grimOpen && systemId != null && (
        <LitmGrimoireDrawer
          systemId={systemId}
          spotName={sp.current != null ? heroName(sp.current) : null}
          onGive={(name, tier, toSpot) => setGive({ keys: toSpot && sp.current != null ? [`hero:${sp.current}`] : [], name, tier })}
          onLog={(name) => noteLitm(sessionId, `${sp.current != null ? heroName(sp.current) : "Гримуар"}: ${name}`)}
          onScratch={(e) => void scratchMenu(e.clientX, e.clientY)}
          onPick={(e, items) => setMenu({ x: e.clientX, y: e.clientY, items })}
          onClose={closeGrim}
        />
      )}
      {rewardsOpen && systemId != null && (
        <LitmRewardsDrawer
          sessionId={sessionId}
          systemId={systemId}
          heroes={characters}
          union={union}
          sheet={sheet}
          onPay={(ids, tier) => void applyGive({ keys: ids.map((id) => `hero:${id}`), name: "при-деньгах", tier, mode: "give", limit: null })}
          onPick={(e, items) => setMenu({ x: e.clientX, y: e.clientY, title: "Дать герою", items })}
          onClose={closeRewards}
        />
      )}
      {give && <LitmGiveStatus targets={giveTargets} initial={give} onClose={() => setGive(null)} onApply={applyGive} />}
      {menu && <ContextMenu x={menu.x} y={menu.y} title={menu.title} items={menu.items} onClose={() => setMenu(null)} />}
    </div>
  );
}

/**
 * Лог конфликта (Q15) под полосой: свёрнут — последнее действие и «Отменить»,
 * раскрыт — всё, новое сверху; «Назад» — последняя передача спотлайта.
 */
function LitmLogStrip({ fight, onBack }: { fight: ReturnType<typeof useLitmBattle>; onBack: () => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<number | null>(null);
  const { battle, log } = fight;
  if (!battle) {
    return (
      <div className="lp-log">
        <span className="lp-mono">Лог</span>
        <span className="lp-log__last">{fight.live ? "конфликт начнётся с первого действия" : "лог и «Вызовы вечера» ведутся, когда сессия идёт"}</span>
      </div>
    );
  }
  const can = undoableIds(log);
  const turn = lastLiveTurn(log);
  const last = [...log].reverse().find((l) => l.kind !== "turn" && !l.undone) ?? null;
  async function undo(line: BattleLogLine) {
    setBusy(line.id);
    try {
      await fight.undo(line);
    } finally {
      setBusy(null);
    }
  }
  return (
    <div className="lp-log">
      <span className="lp-mono">
        {battle.name} · {log.length}
      </span>
      <span className="lp-log__last">{last ? last.text : "пока пусто"}</span>
      {last && can.has(last.id) && (
        <button type="button" className="d-btn d-btn--sm d-btn--ghost" disabled={busy === last.id} onClick={() => void undo(last)}>
          Отменить
        </button>
      )}
      <button type="button" className="d-btn d-btn--sm d-btn--ghost" disabled={!turn || !can.has(turn.id)} title="Shift+пробел" onClick={onBack}>
        Назад
      </button>
      <button type="button" className="d-btn d-btn--sm d-btn--ghost" aria-expanded={open} onClick={() => setOpen(!open)}>
        {open ? "Свернуть" : "Раскрыть"}
      </button>
      {open && (
        <ol className="lp-log__list" aria-label="Лог конфликта, новое сверху">
          {[...log].reverse().map((l) => (
            <li key={l.id} className={`lp-log__row is-${l.kind}${l.undone ? " is-undone" : ""}`}>
              <span>
                {l.text}
                {l.sub && <small> — {l.sub}</small>}
              </span>
              {can.has(l.id) && (
                <button type="button" className="d-btn d-btn--sm d-btn--ghost" disabled={busy === l.id} onClick={() => void undo(l)}>
                  Отменить
                </button>
              )}
              {l.undone && <small className="lp-mono">отменено</small>}
              {!l.undone && l.blocked && <small>{l.blocked}</small>}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

type Confirm = ReturnType<typeof useConfirm>[1];
type OpenMenu = (m: { x: number; y: number; items: ContextMenuItem[]; title?: string }) => void;

function nestItems(row: InitiativeEntry, { ribbon, confirm, openGive, addonMenu }: NestCtx): ContextMenuItem[] {
  const vignette = ribbon.stateOf(row).vignette != null;
  const items: ContextMenuItem[] = vignette ? [] : [{ label: "Дать статус…", onClick: () => openGive({ keys: [`row:${row.id}`] }) }, ...addonMenu(row)];
  if (row.entity_type === "compendium_entry" && row.entity_id != null) {
    items.push({ label: vignette ? "Открыть путешествие" : "Открыть профиль", onClick: () => window.open(`/compendium/${row.entity_id}`, "_blank") });
  }
  if (!vignette && (row.entity_type === "compendium_entry" || row.entity_type === "being") && row.entity_id != null) {
    const base = row.name.replace(/ \d+$/, "");
    items.push({ label: "Ещё копия", onClick: () => void ribbon.add({ type: row.entity_type as "compendium_entry" | "being", id: row.entity_id!, name: base }) });
  }
  items.push({
    label: "Убрать с ленты",
    danger: true,
    dividerBefore: items.length > 0,
    onClick: async () => {
      if (await confirm({ message: `Убрать «${row.name}» с ленты?`, confirmLabel: "Убрать", danger: true })) await ribbon.remove(row);
    },
  });
  return items;
}

/** Полоса «Сцена» (Q11): общие сюжетные теги, статусы сцены, пределы-счётчики, «Награда →», «Привал». */
function SceneStrip({
  scene,
  sceneName,
  onChange,
  onMenu,
  onCamp,
  onRewards,
  rewardsOpen,
}: {
  scene: LitmSceneState;
  sceneName: string | null;
  onChange: (label: string, s: LitmSceneState) => void;
  onMenu: OpenMenu;
  onCamp: () => void;
  onRewards: () => void;
  rewardsOpen: boolean;
}) {
  const [tag, setTag] = useState("");
  const [status, setStatus] = useState("");
  const [progress, setProgress] = useState("");

  function addTag() {
    const name = tag.trim();
    if (!name) return;
    onChange(`Сюжетный тег «${name}»`, { ...scene, tags: [...scene.tags, { name }] });
    setTag("");
  }
  function addStatus() {
    const s = parseStatusTag(status.trim().replace(/\s+(\d)$/, "-$1"));
    if (!s) return;
    onChange(`Статус сцены ${s.name}-${s.tier}`, { ...scene, statuses: giveStatus(scene.statuses, s.name, s.tier) });
    setStatus("");
  }
  function addProgress() {
    const p = nameAndNumber(progress);
    if (!p || p.n < 1) return;
    onChange(`Счётчик «${p.name}»`, { ...scene, progress: [...scene.progress, { name: p.name, max: Math.min(6, p.n), marks: [] }] });
    setProgress("");
  }

  return (
    <section className="lp-scene" aria-label="Сцена">
      <div className="lp-lbl">
        Сцена{sceneName && <small>{sceneName}</small>}
      </div>
      <div className="lp-grp">
        {scene.tags.map((t, i) => (
          <button
            key={`${t.name}-${i}`}
            type="button"
            className={`lb-ts lp-tag${t.hindering ? " is-neg" : ""}`}
            onClick={(e) =>
              onMenu({
                x: e.clientX,
                y: e.clientY,
                title: t.name,
                items: [
                  { label: t.hindering ? "Помогает" : "Мешает", onClick: () => onChange(`«${t.name}»`, { ...scene, tags: scene.tags.map((x, k) => (k === i ? { ...x, hindering: !x.hindering } : x)) }) },
                  { label: t.singleUse ? "Не одноразовый" : "Одноразовый", onClick: () => onChange(`«${t.name}»`, { ...scene, tags: scene.tags.map((x, k) => (k === i ? { ...x, singleUse: !x.singleUse } : x)) }) },
                  { label: "Снять", danger: true, dividerBefore: true, onClick: () => onChange(`Снят «${t.name}»`, { ...scene, tags: scene.tags.filter((_, k) => k !== i) }) },
                ],
              })
            }
          >
            {t.name}
            {t.hindering && <span className="lp-k">мешает</span>}
            {t.singleUse && <span className="lp-k">1×</span>}
          </button>
        ))}
        <input className="lp-in" value={tag} placeholder="+ сюжетный тег" aria-label="Новый сюжетный тег" onChange={(e) => setTag(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addTag()} />
      </div>
      <span className="lp-sp" />
      <div className="lp-grp">
        {scene.statuses.map((s) => (
          <StatusChip
            key={s.name}
            status={s}
            onMenu={onMenu}
            onReduce={() => onChange(`Сцена: ${s.name} слабее`, { ...scene, statuses: reduceStatus(scene.statuses, s.name, 1) })}
            onRemove={() => onChange(`Сцена: снят ${s.name}`, { ...scene, statuses: scene.statuses.filter((x) => x !== s) })}
          />
        ))}
        <input className="lp-in lp-in--sm" value={status} placeholder="+ статус-2" aria-label="Новый статус сцены" onChange={(e) => setStatus(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addStatus()} />
      </div>
      <span className="lp-sp" />
      <div className="lp-grp">
        {scene.progress.map((p, i) => (
          <div key={`${p.name}-${i}`} className={`lp-prog${statusTier(p.marks) >= p.max ? " is-hit" : ""}`}>
            <span className="lp-prog__nm">
              {p.name}
              <small>счётчик · {p.max}</small>
            </span>
            <Boxes
              n={p.max}
              marks={p.marks}
              label={p.name}
              onBox={(k) =>
                onChange(`Счётчик «${p.name}»`, { ...scene, progress: scene.progress.map((x, j) => (j === i ? { ...x, marks: giveStatus([{ name: x.name, marks: x.marks }], x.name, k)[0].marks } : x)) })
              }
            />
            <button
              type="button"
              className="lp-x"
              aria-label={`Убрать счётчик ${p.name}`}
              onClick={() => onChange(`Счётчик «${p.name}» убран`, { ...scene, progress: scene.progress.filter((_, j) => j !== i) })}
            >
              ✕
            </button>
          </div>
        ))}
        <input className="lp-in lp-in--sm" value={progress} placeholder="+ счётчик 4" aria-label="Новый предел-счётчик сцены" onChange={(e) => setProgress(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addProgress()} />
      </div>
      <button type="button" className={`d-btn d-btn--sm lp-camp${rewardsOpen ? " active" : ""}`} aria-expanded={rewardsOpen} onClick={onRewards}>
        Награда →
      </button>
      <button type="button" className="d-btn d-btn--sm" onClick={onCamp}>
        Привал
      </button>
    </section>
  );
}

/** Клетки карточки учёта; нажатие — отметить уровень по правилу сложения. */
function Boxes({ n, marks, label, onBox }: { n: number; marks: number[]; label: string; onBox?: (k: number) => void }) {
  return (
    <span className="lp-bx">
      {BOXES.slice(0, n).map((k) => (
        <button
          key={k}
          type="button"
          className={marks.includes(k) ? "is-on" : ""}
          aria-label={`${label}: отметить уровень ${k}`}
          title={`Уровень ${k}`}
          disabled={!onBox}
          onClick={() => onBox?.(k)}
        />
      ))}
    </span>
  );
}

function StatusChip({ status, onMenu, onReduce, onRemove }: { status: LitmStatus; onMenu: OpenMenu; onReduce: () => void; onRemove: () => void }) {
  return (
    <button
      type="button"
      className="lp-chipbtn"
      onClick={(e) =>
        onMenu({
          x: e.clientX,
          y: e.clientY,
          title: `${status.name}-${statusTier(status.marks)}`,
          items: [
            { label: "Ослабить на 1", onClick: onReduce },
            { label: "Снять", danger: true, onClick: onRemove },
          ],
        })
      }
    >
      <Status name={status.name} tier={statusTier(status.marks)} />
    </button>
  );
}

/** Карточка героя (Q10): статусы карточками учёта, сюжетные теги рюкзака,
 *  темы свёрнутыми строками — нажатие на тег силы вычёркивает его. */
function HeroCard({
  character,
  now,
  acted,
  isNext,
  count,
  onSpotlight,
  patch,
  onDown,
}: {
  character: Character;
  now: boolean;
  acted: boolean;
  isNext: boolean;
  count: number;
  onSpotlight: () => void;
  patch: (label: string, fields: Parameters<typeof patchLitmSheet>[2]) => Promise<void>;
  onDown: (down: boolean) => void;
}) {
  const sheet = useLitmSheet(character.id);
  const statuses = sheet?.statuses ?? [];
  const isDown = !!heroCondition(statuses).overcome;
  useEffect(() => onDown(isDown), [isDown, onDown]);
  const [open, setOpen] = useState<string | null>(null);
  const name = character.character_name;

  function toggle(kind: "themes" | "storyThemes", index: number, tag: string) {
    void patch(`${name}: тег «${tag}»`, toggleScratch(kind, index, tag));
  }

  const themes = sheet ? [...sheet.themes.map((t, i) => ({ t, kind: "themes" as const, i })), ...sheet.storyThemes.filter((t) => t.name).map((t, i) => ({ t, kind: "storyThemes" as const, i }))] : [];

  return (
    <article className={`lp-hero${now ? " is-now" : ""}${acted && !now ? " is-done" : ""}`}>
      <div className="lp-hh">
        <span className="lp-av" aria-hidden="true">
          {name.slice(0, 1).toUpperCase()}
        </span>
        <span className="lp-hh__nm">
          <Link to={`/characters/${character.id}`}>{name}</Link>
          <small>{now ? "в спотлайте" : isNext ? "следующий" : acted ? "сходил в круге" : " "}</small>
        </span>
        <span className="lp-spot">
          {now ? (
            <span className="lp-spot__tag">Спотлайт</span>
          ) : (
            <button type="button" className="d-btn d-btn--sm d-btn--ghost" onClick={onSpotlight} title="Дать спотлайт">
              ●
            </button>
          )}
          <small>×{count}</small>
        </span>
      </div>
      {!sheet ? (
        <span className="lb-empty">Нет листа LitM — «Создать» на странице героя.</span>
      ) : (
        <>
          <LitmStatusCards
            compact
            statuses={statuses}
            onChange={(update) => void patch(`${name}: статусы`, (d) => ({ statuses: update(d.statuses ?? []) }))}
          />
          {sheet!.backpack.length > 0 && (
            <div className="lp-sub">
              <span className="lp-mono">Сюжетные теги</span>
              <span className="lp-tags">
                {sheet!.backpack.map((t, i) => (
                  <span key={`${t}-${i}`} className="lb-ts">
                    {t}
                  </span>
                ))}
              </span>
            </div>
          )}
          <div className="lp-sub">
            <span className="lp-mono">Темы</span>
            {themes.map(({ t, kind, i }) => {
              const key = `${kind}-${i}`;
              const might = t.power && t.power !== "variable" ? mightOf({ name: "", level: t.power }) : null;
              const scratched = t.scratchedTags ?? [];
              return (
                <div key={key} className="lp-thm">
                  <button type="button" className="lp-thm__h" aria-expanded={open === key} onClick={() => setOpen(open === key ? null : key)}>
                    {might ? <MightMark might={might} label="" /> : <span className="lp-thm__dot" />}
                    <b>{t.name || "Без названия"}</b>
                    {scratched.length > 0 && <small>вычеркнуто {scratched.length}</small>}
                  </button>
                  {open === key && (
                    <span className="lp-tags">
                      {[t.name, ...t.powerTags].filter(Boolean).map((tag) => (
                        <button
                          key={tag}
                          type="button"
                          className={`lb-tg lp-tagbtn${scratched.includes(tag) ? " is-x" : ""}`}
                          aria-pressed={scratched.includes(tag)}
                          title={scratched.includes(tag) ? "Вернуть тег" : "Вычеркнуть тег"}
                          onClick={() => toggle(kind, i, tag)}
                        >
                          {tag}
                        </button>
                      ))}
                      {t.weaknessTags.map((tag) => (
                        <span key={tag} className="lb-tw">
                          {tag}
                        </span>
                      ))}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </article>
  );
}

/** Гнездо вызова: живые пределы и статусы сверху, под ними профиль книги. */
function ChallengeNest({ row, ctx }: { row: InitiativeEntry; ctx: NestCtx }) {
  const { ribbon, onMenu } = ctx;
  const state = ribbon.stateOf(row);
  const hasProfile = (row.entity_type === "compendium_entry" || row.entity_type === "being") && row.entity_id != null;
  const rows = useResource<Statblock[]>(hasProfile ? statblockListPath(row.entity_type!, row.entity_id!) : null).data ?? NO_STATBLOCKS;
  const sb = rows.find((s) => s.format === "litm_challenge");
  const profile = useMemo(() => (sb ? challengeProfile({ name: row.name, name_original: "", description: "", data: {} }, sb) : null), [sb, row.name]);
  const addons = state.addons.flatMap((id) => ctx.book.get(id) ?? []);
  const rating = Math.min(5, (profile?.rating ?? 0) + addons.reduce((n, a) => n + a.profile.rating, 0));
  const threats = (offset: number) => (list: LitmChallengeProfileData["threatList"]) => (
    <LitmThreats
      threats={list}
      offset={offset}
      declared={state.declaredThreat}
      onDeclare={(n, lead) => set(n == null ? "угроза снята" : "угроза объявлена", { ...state, declaredThreat: n, declaredLead: n == null ? "" : lead })}
      onAction={(a, e, n, edit) => ctx.runAction(row, a, e, n, edit)}
      onOwn={() => ctx.openGive({ keys: [] })}
    />
  );
  let offset = profile?.threatList.length ?? 0;
  const beaten = overcomeBy(state);
  const turned = turnedLimits(state);
  const [draft, setDraft] = useState("");

  const set = (label: string, next: LitmChallengeState) => void ribbon.setChallenge(row, `${row.name}: ${label}`, next);

  function addStatus() {
    const s = parseStatusTag(draft.trim().replace(/\s+(\d)$/, "-$1"));
    if (!s) return;
    set(`${s.name}-${s.tier}`, { ...state, statuses: giveStatus(state.statuses, s.name, s.tier) });
    setDraft("");
  }

  return (
    <article className={`lp-nest litm-book${beaten ? " is-out" : ""}`} data-nest={row.id}>
      {beaten && <div className="lp-stamp">Преодолён · {beaten.name}</div>}
      <div className="lp-nh">
        <h3 className="lb-name">
          {row.name}
          {profile?.titleEn && <small className="lb-orig">{profile.titleEn}</small>}
        </h3>
        <span className="lp-nh__end">
          <button
            type="button"
            className="lp-ib"
            aria-label={`Действия: ${row.name}`}
            onClick={(e) => onMenu({ x: e.clientX, y: e.clientY, title: row.name, items: nestItems(row, ctx) })}
          >
            ⋯
          </button>
        </span>
      </div>
      {profile && (
        <div className="lp-meta">
          <Rating value={rating} />
          {profile.mightList.map((m, i) => {
            const might = mightOf(m);
            return might ? <MightMark key={i} might={might} label={m.name} /> : null;
          })}
        </div>
      )}
      {turned.map((l) => (
        <div key={l.name} className="lp-turn">
          <b>↻ Предел достигнут · {l.name}</b>
          {l.note && <LitmRich text={l.note} />}
        </div>
      ))}
      {state.limits.length > 0 && (
        <div className="lp-block">
          <div className="lb-lbl">
            Пределы<small>клетки — статус против предела</small>
          </div>
          {state.limits.map((l, i) => (
            <div key={`${l.name}-${i}`} className={`lp-lim${limitReached(l) ? " is-hit" : ""}`}>
              <b className="lp-lim__nm">
                {l.name}
                {statusTier(l.marks) > 0 && <small>{l.status ? `${l.status}-${statusTier(l.marks)}` : `уровень ${statusTier(l.marks)}`}</small>}
              </b>
              {l.max == null ? (
                <span className="lp-mono">неуязвим</span>
              ) : (
                <Boxes n={l.max} marks={l.marks} label={l.name} onBox={(k) => set(`${l.name} ${k}`, giveToLimit(state, i, l.status, k))} />
              )}
              <span className="lp-lim__max">
                {l.max ?? "—"}
                {l.turns && <sup>↻</sup>}
              </span>
              <button type="button" className="lp-x" aria-label={`Ослабить: ${l.name}`} title="Ослабить на 1" disabled={!l.marks.length} onClick={() => set(`${l.name} слабее`, reduceLimit(state, i, 1))}>
                −
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="lp-block">
        <div className="lb-lbl">
          Статусы<small>вне пределов</small>
        </div>
        <span className="lp-tags">
          {state.statuses.map((s) => (
            <StatusChip
              key={s.name}
              status={s}
              onMenu={onMenu}
              onReduce={() => set(`${s.name} слабее`, { ...state, statuses: reduceStatus(state.statuses, s.name, 1) })}
              onRemove={() => set(`снят ${s.name}`, { ...state, statuses: state.statuses.filter((x) => x !== s) })}
            />
          ))}
          <input className="lp-in lp-in--sm" value={draft} placeholder="+ статус-2" aria-label={`Новый статус: ${row.name}`} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addStatus()} />
        </span>
      </div>
      {profile ? (
        <div className="lp-profile">
          <LitmChallengeProfile profile={profile} hideLimits renderThreats={threats(0)} />
        </div>
      ) : hasProfile ? (
        <p className="lb-empty">Профиль не найден.</p>
      ) : null}
      {addons.map((a) => {
        const from = offset;
        offset += a.profile.threatList.length;
        return (
          <div key={a.entry.id} className="lp-profile lp-addon">
            <div className="lb-lbl">
              Надстройка<small>{a.entry.name}</small>
            </div>
            <LitmChallengeProfile profile={a.profile} hideLimits renderThreats={threats(from)} />
          </div>
        );
      })}
    </article>
  );
}
