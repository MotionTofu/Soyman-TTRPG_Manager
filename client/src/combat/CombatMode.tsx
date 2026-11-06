import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { write } from "../data/hooks";
import { findDndSystemId, loadDndMechanicsGroup } from "../components/dnd/dndCompendium";
import { rollDiceFormula } from "../components/dnd/diceRoll";
import type { InitiativeEntry } from "../types";
import { FighterNest, NoteNest, StubNest, type NestActions } from "./CombatNest";
import { CombatPlayer } from "./CombatPlayer";
import { AddToCombatPanel, NestMenu } from "./CombatAddPanel";
import { nestFlag } from "./nestState";
import { isDead, patchRow, useCombat } from "./useCombat";
import { onNestFocus, setCombatModeOpen, setEndedEffects, useEndedEffects } from "./combatModeStore";
import { EffectWindow } from "./EffectWindow";
import { BattleClock, BattleLogPanel } from "./BattleLogPanel";
import { endCombatSummary } from "./effectOps";
import "./combat.css";

const ZOOM_KEY = "combat-mode-zoom";
const ZOOM_MIN = 0.3;
const ZOOM_MAX = 1.5;

function loadZoom(): number {
  try {
    const v = Number(localStorage.getItem(ZOOM_KEY));
    return Number.isFinite(v) && v >= ZOOM_MIN && v <= ZOOM_MAX ? v : 1;
  } catch {
    return 1;
  }
}

function saveZoom(v: number) {
  try {
    localStorage.setItem(ZOOM_KEY, String(v));
  } catch {
    /* масштаб — удобство, не данные */
  }
}

/** Фокус в поле ввода или открыто окно — клавиши режима молчат (Q36). */
function keysBlocked(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  const tag = el?.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el?.isContentEditable) return true;
  return !!document.querySelector(".modal-backdrop, .cm-layer");
}

/**
 * Боевой режим пульта (Q1–Q18): полоса раунда и лента гнёзд по инициативе.
 * Занимает основную область пульта; трекер-список в правой панели остаётся.
 */
export function CombatMode({ sessionId }: { sessionId: number }) {
  const combat = useCombat(sessionId);
  const { session, turnOrder, turnTakers, currentId } = combat;
  const active = !!session?.combat_active;

  const [conditionOptions, setConditionOptions] = useState<string[]>([]);
  const [systemId, setSystemId] = useState<number | null>(null);
  // ПКМ: по пустому месту ленты — «Добавить в бой» (Q37), по гнезду — его меню (Q42).
  const [popup, setPopup] = useState<{ x: number; y: number; nestId: number | null } | null>(null);
  const popupEntry = popup?.nestId != null ? (combat.entries.find((e) => e.id === popup.nestId) ?? null) : null;
  // «+ эффект» в гнезде (Q51) — окно с этим гнездом целью.
  const [effectFor, setEffectFor] = useState<number | null>(null);
  const [endAsk, setEndAsk] = useState<{ gone: string[]; kept: string[] } | null>(null);
  const ended = useEndedEffects(sessionId);
  useEffect(() => {
    findDndSystemId().then((id) => {
      if (!id) return;
      setSystemId(id);
      loadDndMechanicsGroup(id, "Состояния").then((list) => setConditionOptions(list.map((c) => c.name)));
    });
  }, []);

  const nextId = useMemo(() => {
    if (!active || turnTakers.length < 2) return null;
    const i = turnTakers.findIndex((e) => e.id === currentId);
    return turnTakers[(i + 1) % turnTakers.length]?.id ?? null;
  }, [active, turnTakers, currentId]);

  const current = turnOrder.find((e) => e.id === currentId) ?? null;
  const next = turnOrder.find((e) => e.id === nextId) ?? null;
  const npcsWithout = turnOrder.filter(
    (e) => e.kind === "creature" && e.entity_type !== "character" && e.initiative == null && !isDead(e)
  );
  const waiting = turnOrder.filter((e) => e.kind === "creature" && e.initiative == null && !isDead(e)).length;

  const actions: NestActions = {
    update: combat.updateEntry,
    updateState: combat.updateState,
    setInitiative: (entry, initiative) =>
      void combat.change("Инициатива", () => write.put(`/initiative-entries/${entry.id}`, { initiative }), {
        patch: patchRow(entry.id, { initiative }),
      }),
    effects: combat.effects,
    openEffect: (entry) => setEffectFor(entry.id),
    entries: combat.entries,
  };

  /**
   * «Конец боя» (Q58, Q75): не отменяется — спросить, если в бою что-то было;
   * есть эффекты — показать, что уйдёт и что останется.
   */
  function askEnd() {
    const summary = endCombatSummary(combat.entries);
    if (summary.gone.length || summary.kept.length || (combat.battle?.log_count ?? 0) > 0) setEndAsk(summary);
    else void combat.stopCombat();
  }

  async function rollForNpcs() {
    const rolls = new Map<number, number>();
    for (const e of npcsWithout) {
      const mod = e.dex_modifier ?? 0;
      const value = rollDiceFormula(`1к20${mod >= 0 ? "+" : ""}${mod}`);
      if (value != null) rolls.set(e.id, value);
    }
    if (rolls.size === 0) return;
    await combat.change(
      "Инициатива НПС",
      async () => {
        for (const [id, initiative] of rolls) await write.put(`/initiative-entries/${id}`, { initiative });
      },
      { patch: (rows) => rows.map((e) => (rolls.has(e.id) ? { ...e, initiative: rolls.get(e.id)! } : e)) }
    );
  }

  // Пробел — следующий ход, Shift+пробел — назад (Q36). Перехват на захвате:
  // плеер приложения (audioPlayer.tsx) тоже слушает пробел и в режиме
  // уступает — до него событие не доходит.
  const stepRef = useRef(combat.step);
  stepRef.current = combat.step;
  useEffect(() => {
    if (!active) return;
    const handler = (e: KeyboardEvent) => {
      if (e.code !== "Space" || keysBlocked(e.target)) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      if (!e.repeat) stepRef.current(e.shiftKey ? -1 : 1);
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [active]);

  const lairCreatures = turnOrder.filter((e) => e.kind === "creature" && e.entity_type !== "character");

  return (
    <div className="combat-mode">
      <div className="cm-roundbar">
        {active ? (
          <>
            <div className="cm-round">
              <span className="cm-ui">Раунд</span>
              <b>{session?.combat_round || 1}</b>
            </div>
            {combat.battle && <BattleClock battle={combat.battle} />}
            {combat.battle?.carried_from != null && (
              <span className="cm-cont">Продолжение · из сессии {combat.battle.carried_from}</span>
            )}
            <button type="button" className="cm-btn" onClick={() => combat.step(-1)} title="Shift+пробел">
              Назад
            </button>
            <button type="button" className="cm-btn cm-btn--primary" onClick={() => combat.step(1)} title="Пробел">
              Следующий ход
            </button>
            <span className="cm-now">
              {current ? (
                <>
                  <span className="cm-ui">Ходит</span> <b>{current.name}</b>
                  {next && <span className="muted"> · дальше {next.name}</span>}
                </>
              ) : (
                <span className="muted">Ход не выбран</span>
              )}
            </span>
          </>
        ) : (
          <button
            type="button"
            className="cm-btn cm-btn--primary"
            disabled={turnTakers.length === 0}
            onClick={() => void combat.startCombat()}
          >
            Старт
          </button>
        )}
        {active && ended.length > 0 && (
          <span className="cm-ended" role="status">
            <span className="cm-ui">Закончилось</span>
            <span>
              {ended.map((l) => `${l.name} (${l.casterName}) — ${l.targets.join(", ")}`).join("; ")}
            </span>
            <button type="button" className="cm-x" aria-label="Убрать строку" onClick={() => setEndedEffects(sessionId, [])}>
              ✕
            </button>
          </span>
        )}
        <span className="cm-roundbar__gap" />
        {npcsWithout.length > 0 && (
          <button type="button" className="cm-btn cm-btn--wait" onClick={rollForNpcs} title="к20 + модификатор всем НПС без числа; персонажей не трогает">
            Бросить инициативу · без неё {waiting}
          </button>
        )}
        {active && (
          <button type="button" className="cm-btn" onClick={askEnd}>
            Конец боя
          </button>
        )}
        <button type="button" className="cm-btn" onClick={() => setCombatModeOpen(sessionId, false)}>
          Пульт
        </button>
      </div>

      {active && <BattleLogPanel combat={combat} />}

      <CombatPlayer themeId={session?.battle_playlist_id ?? null} onTheme={(id) => void combat.setTheme(id)} />

      <Ribbon currentId={currentId} onContext={(x, y, nestId) => setPopup({ x, y, nestId })}>
        {turnOrder.length === 0 && (
          <div className="cm-empty">Перетащите существо из поиска в трекер — встанет в бой</div>
        )}
        {turnOrder.map((entry: InitiativeEntry, i) => {
          const order = i + 1;
          const flag = active ? nestFlag(entry, currentId, nextId) : entry.initiative == null && entry.kind === "creature" && !isDead(entry) ? "wait" : null;
          if (entry.kind !== "creature")
            return (
              <NoteNest
                key={entry.id}
                entry={entry}
                order={order}
                flag={flag}
                actions={actions}
                lairCreatures={lairCreatures}
              />
            );
          if (isDead(entry)) return <StubNest key={entry.id} entry={entry} order={order} actions={actions} />;
          return (
            <FighterNest
              key={entry.id}
              entry={entry}
              order={order}
              flag={flag}
              actions={actions}
              conditionOptions={conditionOptions}
            />
          );
        })}
      </Ribbon>
      {popup && popup.nestId == null && (
        <AddToCombatPanel combat={combat} sessionId={sessionId} x={popup.x} y={popup.y} onClose={() => setPopup(null)} />
      )}
      {effectFor != null && (
        <EffectWindow combat={combat} originId={effectFor} systemId={systemId} onClose={() => setEffectFor(null)} />
      )}
      {endAsk && (
        <div className="cm-layer cm-layer--dim" onPointerDown={(e) => e.target === e.currentTarget && setEndAsk(null)}>
          <section className="cm-fx cm-fx--small" role="dialog" aria-label="Конец боя">
            <div className="cm-fx__h">
              <span className="cm-ui">Конец боя</span>
              <span />
              <button type="button" className="cm-x" aria-label="Закрыть" onClick={() => setEndAsk(null)}>
                ✕
              </button>
            </div>
            <div className="cm-fx__b">
              {combat.battle && (
                <div>
                  <b>«{combat.battle.name}»</b> · раунд {session?.combat_round || 1} · событий в логе: {combat.battle.log_count}.
                </div>
              )}
              {endAsk.gone.length > 0 && (
                <div>
                  <b className="cm-ui">Снимутся</b> эффекты боя: {endAsk.gone.join(", ")}.
                </div>
              )}
              {endAsk.kept.length > 0 && (
                <div>
                  <b className="cm-ui">Останутся на листе</b> до долгого отдыха: {endAsk.kept.join("; ")}.
                </div>
              )}
              <div className="muted">Счётчики гнёзд уходят вместе с боем; запомненные в статблоке остаются там.</div>
              <div className="muted">Конец боя не отменяется: лог закроется, бой встанет в «Бои вечера».</div>
            </div>
            <div className="cm-fx__foot">
              <button type="button" className="cm-btn" onClick={() => setEndAsk(null)}>
                Отмена
              </button>
              <button
                type="button"
                className="cm-btn cm-btn--primary"
                autoFocus
                onClick={() => {
                  setEndAsk(null);
                  void combat.stopCombat();
                }}
              >
                Закончить бой
              </button>
            </div>
          </section>
        </div>
      )}
      {popup && popupEntry && (
        <NestMenu
          combat={combat}
          sessionId={sessionId}
          entry={popupEntry}
          x={popup.x}
          y={popup.y}
          onClose={() => setPopup(null)}
        />
      )}
    </div>
  );
}

/**
 * Лента: пан средней кнопкой и левой по пустому месту, колесо — масштаб
 * вокруг курсора 30–150% (Q8, Q14). Смена хода и «К ходящему» центрируют
 * гнездо, масштаб не трогают. Масштаб помнится на компьютере.
 */
export function Ribbon({
  currentId,
  onContext,
  children,
  hint = "Пробел — следующий ход · Shift+пробел — назад · колесо — масштаб · средняя кнопка — сдвиг",
  toActiveLabel = "К ходящему",
}: {
  currentId: number | null;
  onContext: (x: number, y: number, nestId: number | null) => void;
  children: ReactNode;
  /** Подсказка внизу ленты; режим «Вызовы» LitM ставит свою. */
  hint?: string;
  toActiveLabel?: string;
}) {
  const vpRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const [view, setView] = useState(() => ({ x: 0, y: 0, scale: loadZoom() }));
  const viewRef = useRef(view);
  viewRef.current = view;
  const [glide, setGlide] = useState(false);
  const [height, setHeight] = useState(600);
  const [activeOff, setActiveOff] = useState(false);
  const drag = useRef<{ id: number; x: number; y: number; vx: number; vy: number } | null>(null);
  const [dragging, setDragging] = useState(false);

  // Лента занимает остаток окна: высота считается от её верха.
  useLayoutEffect(() => {
    const measure = () => {
      const el = vpRef.current;
      if (!el) return;
      const bar = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--player-bar-height")) || 0;
      setHeight(Math.max(320, window.innerHeight - el.getBoundingClientRect().top - bar - 12));
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  // Колесо — масштаб. Слушатель не пассивный: иначе страница прокрутится.
  useEffect(() => {
    const vp = vpRef.current;
    if (!vp) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = vp.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      setView((v) => {
        const scale = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, v.scale * Math.exp(-e.deltaY * 0.0015)));
        const k = scale / v.scale;
        saveZoom(scale);
        return { scale, x: cx - (cx - v.x) * k, y: cy - (cy - v.y) * k };
      });
    };
    vp.addEventListener("wheel", onWheel, { passive: false });
    return () => vp.removeEventListener("wheel", onWheel);
  }, []);

  function centerOn(entryId: number) {
    const vp = vpRef.current;
    const nest = stageRef.current?.querySelector<HTMLElement>(`[data-nest="${entryId}"]`);
    if (!vp || !nest) return;
    const { scale } = viewRef.current;
    const x = vp.clientWidth / 2 - (nest.offsetLeft + nest.offsetWidth / 2) * scale;
    setGlide(true);
    setView({ x, y: 0, scale });
    window.setTimeout(() => setGlide(false), 380);
    nest.classList.remove("is-flash");
    void nest.offsetWidth;
    nest.classList.add("is-flash");
  }

  // Ход перешёл — ходящий выезжает к центру (Q5).
  useEffect(() => {
    if (currentId != null) centerOn(currentId);
  }, [currentId]);

  // Щелчок по строке трекера — показать гнездо.
  useEffect(() => onNestFocus(centerOn), []);

  // «К ходящему» — только когда ходящий за краем.
  useEffect(() => {
    const vp = vpRef.current;
    const nest = currentId != null ? stageRef.current?.querySelector<HTMLElement>(`[data-nest="${currentId}"]`) : null;
    if (!vp || !nest) return setActiveOff(false);
    const left = view.x + nest.offsetLeft * view.scale;
    const right = left + nest.offsetWidth * view.scale;
    setActiveOff(right < 40 || left > vp.clientWidth - 40);
  }, [view, currentId]);

  function onPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    const empty = e.target === vpRef.current || e.target === stageRef.current;
    if (!(e.button === 1 || (e.button === 0 && empty))) return;
    e.preventDefault();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* указатель уже отпущен — тянуть нечего, сдвиг просто не начнётся */
    }
    drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, vx: view.x, vy: view.y };
    setDragging(true);
  }
  function onPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    setView((v) => ({ ...v, x: d.vx + e.clientX - d.x, y: d.vy + e.clientY - d.y }));
  }
  function onPointerUp(e: ReactPointerEvent<HTMLDivElement>) {
    if (drag.current?.id !== e.pointerId) return;
    drag.current = null;
    setDragging(false);
  }

  return (
    <div
      ref={vpRef}
      className={`cm-vp${dragging ? " is-dragging" : ""}`}
      style={{ height }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onContextMenu={(e) => {
        // В полях ввода — своё меню браузера (вставить, проверка написания).
        const el = e.target as HTMLElement;
        if (el.closest("input, textarea, select, a")) return;
        e.preventDefault();
        const nest = el.closest<HTMLElement>("[data-nest]");
        onContext(e.clientX, e.clientY, nest ? Number(nest.dataset.nest) : null);
      }}
      // Средняя кнопка в Chromium включает автопрокрутку — гасим.
      onMouseDown={(e) => {
        if (e.button === 1) e.preventDefault();
      }}
    >
      <div
        ref={stageRef}
        className={`cm-stage${glide ? " is-glide" : ""}`}
        style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}
      >
        {children}
      </div>
      <div className="cm-vp-tools">
        <span className="cm-vp-hint">{hint}</span>
        <span className="cm-vp-hint">{Math.round(view.scale * 100)}%</span>
      </div>
      {activeOff && currentId != null && (
        <button type="button" className="cm-btn cm-btn--primary cm-to-active" onClick={() => centerOn(currentId)}>
          {toActiveLabel}
        </button>
      )}
    </div>
  );
}
