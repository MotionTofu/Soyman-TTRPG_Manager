import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  campScene,
  giveToLimit,
  limitReached,
  overcomeBy,
  passSpotlight,
  reduceLimit,
  turnedLimits,
  type LitmChallengeState,
  type LitmSceneState,
} from "@shared/litm/conflict";
import { giveStatus, heroCondition, parseStatusTag, reduceStatus, statusTier, type LitmStatus } from "@shared/litm/status";
import { useResource } from "../../../data/hooks";
import { sessionPaths } from "../../../data/sessions";
import { statblockListPath } from "../../../data/statblocks";
import { useConfirm, usePrompt } from "../../../hooks/useConfirm";
import { Ribbon } from "../../../combat/CombatMode";
import { ContextMenu, type ContextMenuItem } from "../../ContextMenu";
import type { Character, InitiativeEntry, LitMCharacterData, LitMThemeCard, SessionStage, SessionUnionRow, Statblock } from "../../../types";
import { normalizeCharacter } from "../LitMCharacterForm";
import { LitmStatusCards } from "../LitmStatusCards";
import { LitmChallengeProfile } from "../LitmChallengeProfile";
import { LitmRich, MightMark, Rating, Status } from "../LitmBook";
import { challengeProfile, mightOf } from "../litmChallenge";
import { patchLitmSheet, restoreScratched } from "./litmSheetWrite";
import { LITM_RIBBON_TARGET, useLitmRibbon, type LitmRibbon, type LitmSource } from "./useLitmRibbon";
import { useUnloadTarget } from "../../../unloadTargets";
import { LitmAddPanel } from "./LitmAddPanel";
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
 * Режим «Вызовы» пульта Legend in the Mist (Backlog Д33, доска Litm-Pult):
 * сверху полоса «Сцена», под ней герои со статусами и спотлайтом, ниже лента
 * вызовов с полным профилем. Инициативы, хитов и раундов нет — спотлайт
 * передаётся пробелом следующему, кто в круге не ходил (Q4).
 */
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
  const { scene } = ribbon;
  const stage = useResource<SessionStage>(sessionPaths.stage(sessionId)).data ?? null;
  const current = stage?.current ?? null;
  const [adding, setAdding] = useState(false);
  const [confirmDialog, confirm] = useConfirm();
  const [promptDialog, prompt] = usePrompt();
  const [menu, setMenu] = useState<{ x: number; y: number; items: ContextMenuItem[]; title?: string } | null>(null);
  // Кто из героев повержен (статус 5+) — спотлайт его пропускает. Карточки
  // читают свои листы сами и сообщают сюда.
  const [down, setDown] = useState<Record<number, boolean>>({});
  const order = useMemo(() => characters.map((c) => c.id), [characters]);
  const out = useMemo(() => order.filter((id) => down[id]), [order, down]);

  const sp = scene.spotlight;
  const next = useMemo(() => passSpotlight(sp, order, out).current, [sp, order, out]);

  function spotlight(to?: number) {
    const name = characters.find((c) => c.id === (to ?? next))?.character_name ?? "";
    void ribbon.setScene(`Спотлайт: ${name}`, { ...scene, spotlight: passSpotlight(sp, order, out, to) });
  }

  // Пробел — спотлайт следующему (Q4). Перехват на захвате, как в бою D&D:
  // плеер приложения тоже слушает пробел.
  const spotRef = useRef(spotlight);
  spotRef.current = spotlight;
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.code !== "Space" || keysBlocked(e.target)) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      if (!e.repeat) spotRef.current();
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

  async function camp() {
    if (!(await confirm({ message: "Привал: снять сюжетные теги сцены и вернуть героям вычеркнутые теги силы?", confirmLabel: "Привал" }))) return;
    await ribbon.setScene("Привал", campScene(scene));
    for (const c of characters) await patchLitmSheet(c.id, `${c.character_name}: вычеркнутое не вернулось`, restoreScratched);
  }

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
          <button type="button" className="d-btn d-btn--sm" onClick={() => setAdding(true)}>
            + Вызов
          </button>
          <button type="button" className="d-btn d-btn--sm d-btn--ghost" onClick={() => void addOwn()}>
            + Свой
          </button>
        </span>
      </div>

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

      <SceneStrip
        scene={scene}
        sceneName={current?.name ?? null}
        onChange={(label, s) => void ribbon.setScene(label, { ...s, sceneId: s.sceneId ?? current?.id ?? null })}
        onMenu={setMenu}
        onCamp={() => void camp()}
      />

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
            onDown={(v) => setDown((d) => (d[c.id] === v ? d : { ...d, [c.id]: v }))}
          />
        ))}
      </div>

      <Ribbon
        currentId={null}
        hint="Пробел — спотлайт следующему · колесо — масштаб · средняя кнопка — сдвиг · ПКМ по пустому — добавить вызов"
        onContext={(x, y, nestId) => {
          if (nestId == null) return setAdding(true);
          const row = ribbon.challenges.find((e) => e.id === nestId);
          if (row) setMenu({ x, y, title: row.name, items: nestItems(row, ribbon, confirm) });
        }}
      >
        <div className="lp-track">
          {ribbon.challenges.map((row) => (
            <ChallengeNest key={row.id} row={row} ribbon={ribbon} onMenu={setMenu} confirm={confirm} />
          ))}
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
      {menu && <ContextMenu x={menu.x} y={menu.y} title={menu.title} items={menu.items} onClose={() => setMenu(null)} />}
    </div>
  );
}

type Confirm = ReturnType<typeof useConfirm>[1];
type OpenMenu = (m: { x: number; y: number; items: ContextMenuItem[]; title?: string }) => void;

function nestItems(row: InitiativeEntry, ribbon: LitmRibbon, confirm: Confirm): ContextMenuItem[] {
  const items: ContextMenuItem[] = [];
  if (row.entity_type === "compendium_entry" && row.entity_id != null) {
    items.push({ label: "Открыть профиль", onClick: () => window.open(`/compendium/${row.entity_id}`, "_blank") });
  }
  if ((row.entity_type === "compendium_entry" || row.entity_type === "being") && row.entity_id != null) {
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

/** Полоса «Сцена» (Q11): общие сюжетные теги, статусы сцены, пределы-счётчики, «Привал». */
function SceneStrip({
  scene,
  sceneName,
  onChange,
  onMenu,
  onCamp,
}: {
  scene: LitmSceneState;
  sceneName: string | null;
  onChange: (label: string, s: LitmSceneState) => void;
  onMenu: OpenMenu;
  onCamp: () => void;
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
      <button type="button" className="d-btn d-btn--sm lp-camp" onClick={onCamp}>
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
  onDown,
}: {
  character: Character;
  now: boolean;
  acted: boolean;
  isNext: boolean;
  count: number;
  onSpotlight: () => void;
  onDown: (down: boolean) => void;
}) {
  const rows = useResource<Statblock[]>(statblockListPath("character", character.id)).data ?? NO_STATBLOCKS;
  const sb = rows.find((s) => s.format === "litm_character");
  const sheet = useMemo<LitMCharacterData | null>(() => {
    if (!sb) return null;
    try {
      return normalizeCharacter(JSON.parse(sb.content || "{}"));
    } catch {
      return normalizeCharacter({});
    }
  }, [sb]);
  const statuses = sheet?.statuses ?? [];
  const isDown = !!heroCondition(statuses).overcome;
  useEffect(() => onDown(isDown), [isDown, onDown]);
  const [open, setOpen] = useState<string | null>(null);
  const name = character.character_name;

  function toggle(kind: "themes" | "storyThemes", index: number, tag: string) {
    void patchLitmSheet(character.id, `${name}: тег «${tag}»`, (d) => {
      const flip = (t: LitMThemeCard): LitMThemeCard => {
        const s = t.scratchedTags ?? [];
        return { ...t, scratchedTags: s.includes(tag) ? s.filter((x) => x !== tag) : [...s, tag] };
      };
      return { [kind]: d[kind].map((t, k) => (k === index ? flip(t) : t)) };
    });
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
      {!sb ? (
        <span className="lb-empty">Нет листа LitM — «Создать» на странице героя.</span>
      ) : (
        <>
          <LitmStatusCards
            compact
            statuses={statuses}
            onChange={(update) => void patchLitmSheet(character.id, `${name}: статусы`, (d) => ({ statuses: update(d.statuses ?? []) }))}
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
function ChallengeNest({ row, ribbon, onMenu, confirm }: { row: InitiativeEntry; ribbon: LitmRibbon; onMenu: OpenMenu; confirm: Confirm }) {
  const state = ribbon.stateOf(row);
  const hasProfile = (row.entity_type === "compendium_entry" || row.entity_type === "being") && row.entity_id != null;
  const rows = useResource<Statblock[]>(hasProfile ? statblockListPath(row.entity_type!, row.entity_id!) : null).data ?? NO_STATBLOCKS;
  const sb = rows.find((s) => s.format === "litm_challenge");
  const profile = useMemo(() => (sb ? challengeProfile({ name: row.name, name_original: "", description: "", data: {} }, sb) : null), [sb, row.name]);
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
            onClick={(e) => onMenu({ x: e.clientX, y: e.clientY, title: row.name, items: nestItems(row, ribbon, confirm) })}
          >
            ⋯
          </button>
        </span>
      </div>
      {profile && (
        <div className="lp-meta">
          <Rating value={profile.rating} />
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
          <LitmChallengeProfile profile={profile} hideLimits />
        </div>
      ) : hasProfile ? (
        <p className="lb-empty">Профиль не найден.</p>
      ) : null}
    </article>
  );
}
