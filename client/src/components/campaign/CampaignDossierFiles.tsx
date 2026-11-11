import { useQueries } from "@tanstack/react-query";
import { Fragment, useCallback, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link, useNavigate } from "react-router-dom";
import { deriveSheet } from "@shared/dnd/derive";
import { normalizeDndCharacter } from "@shared/dnd/normalize";
import { resourceQuery } from "../../data/hooks";
import { statblockListPath } from "../../data/statblocks";
import { isSafeImageUrl } from "../../utils/safeUrl";
import { formatDateKeyRu } from "../../utils/date";
import { CHARACTER_STATUSES, CHARACTER_STATUS_LABELS, isLiving, statusOf } from "../../characterStatus";
import type { CampaignDebt, Character, CharacterStatus, RosterPlayer } from "../../types";
import { liveEffectEntryIds, withLiveEffects } from "../dnd/dndFeatures";
import { useCompendiumEntries } from "../dnd/useCompendiumEntries";
import { stripLatin } from "../dnd/sheetShared";
import { ContextMenu, type ContextMenuItem } from "../ContextMenu";
import { NavIcon } from "../NavIcons";
import "./campaign-dossier.css";

// Личные дела (гриллинг «Партия» 2026-10-23): игрок — хозяин дела, персонажи
// вложены. Живые — полными блоками, погибшие и ушедшие — строкой «Память».

/** Что показать из листа: D&D — строки характеристик, иначе ссылка на лист. */
export type SheetInfo =
  | { kind: "loading" }
  | { kind: "error"; retry: () => void }
  | { kind: "dnd"; line: string; level: number; ac: number | string; hp: string; speed: number | string }
  | { kind: "empty" }
  | { kind: "other" };

/**
 * Листы персонажей кампании. Те же ключи запросов и живые эффекты справочника,
 * что у листа: правка в другом окне меняет числа здесь без пересохранения.
 */
export function useCharacterSheets(characters: Character[]): Map<number, SheetInfo> {
  const statblocks = useQueries({
    queries: characters.map((c) => resourceQuery<{ content: string; format: string }[]>(statblockListPath("character", c.id))),
  });
  const parsed = statblocks.map((q) => {
    const dnd = q.data?.find((s) => s.format === "dnd_character");
    try { return dnd ? normalizeDndCharacter(JSON.parse(dnd.content || "{}")) : null; }
    catch { return null; }
  });
  const getEntry = useCompendiumEntries(parsed.flatMap((d) => d ? liveEffectEntryIds(d) : []));
  return new Map(characters.map((c, i): [number, SheetInfo] => {
    const q = statblocks[i];
    if (q.isPending) return [c.id, { kind: "loading" }];
    if (q.isError) return [c.id, { kind: "error", retry: () => void q.refetch() }];
    const d = parsed[i];
    if (!d) return [c.id, q.data?.length ? { kind: "other" } : { kind: "empty" }];
    if (!d.raceName && !d.classes?.length) return [c.id, { kind: "empty" }];
    try {
      const sheet = deriveSheet(withLiveEffects(d, getEntry));
      const classes = d.classes.filter((k) => k.className).map((k) => `${stripLatin(k.className)} ${k.level}`).join(" / ");
      const max = Number(sheet.maxHitPoints.value) || 0;
      return [c.id, {
        kind: "dnd",
        line: [stripLatin(d.raceName), classes].filter(Boolean).join(" · "),
        level: Number(sheet.level.value) || 0,
        ac: sheet.armorClass.value,
        hp: max ? `${d.hitPointsCurrent || max}/${max}` : "—",
        speed: sheet.walkSpeed.value || "—",
      }];
    } catch {
      // Нечитаемый лист не должен прятать игрока и его действия.
      return [c.id, { kind: "other" }];
    }
  }));
}

interface Props {
  roster: RosterPlayer[];
  characters: Character[];
  sheets: Map<number, SheetInfo>;
  /** Спотлайт за кампанию LitM по id персонажа (Д33, Q15). */
  spotlight?: Record<string, number>;
  debts: CampaignDebt[];
  currency: string;
  hideFinance: boolean;
  addingFor: number | null;
  drafts: Record<number, string>;
  onDraft: (playerId: number, name: string) => void;
  onStartAdding: (playerId: number) => void;
  onCancelAdding: () => void;
  onAddCharacter: (playerId: number) => void;
  onPeek: (characterId: number) => void;
  onStatus: (character: Character, status: CharacterStatus) => void;
  onDelete: (characterId: number, name: string) => void;
  onSettle: (debt: CampaignDebt) => void;
  onToggleLeft: (playerId: number, status: string) => void;
  onRemovePlayer: (playerId: number) => void;
}

type Menu = { key: string; title: string; items: ContextMenuItem[]; x: number; y: number; trigger: HTMLElement | null };

const STATUS_ORDER: CharacterStatus[] = ["active", "reserve", "temporary"];
const MEMORY_INLINE = 3;

export function CampaignDossierFiles(props: Props) {
  const { roster, characters, sheets, debts, currency, hideFinance, addingFor, drafts } = props;
  const navigate = useNavigate();
  const [menu, setMenu] = useState<Menu | null>(null);
  const menuRoot = useRef<HTMLDivElement>(null);
  const closeMenu = useCallback(() => {
    setMenu((m) => {
      if (m?.trigger && menuRoot.current?.contains(document.activeElement)) m.trigger.focus({ preventScroll: true });
      return null;
    });
  }, []);
  useLayoutEffect(() => {
    if (!menu) return;
    menuRoot.current?.querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true });
    const onScroll = (e: Event) => {
      if (!(e.target instanceof Node) || !menuRoot.current?.contains(e.target)) closeMenu();
    };
    window.addEventListener("resize", closeMenu);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      window.removeEventListener("resize", closeMenu);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [menu, closeMenu]);

  /** Меню у кнопки (щелчок) или у курсора (ПКМ). */
  function openMenu(e: React.MouseEvent<HTMLElement>, key: string, title: string, items: ContextMenuItem[]) {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "click" && menu?.key === key) { closeMenu(); return; }
    const at = e.type === "contextmenu" ? { left: e.clientX, bottom: e.clientY } : e.currentTarget.getBoundingClientRect();
    setMenu({ key, title, items, x: at.left, y: at.bottom, trigger: e.currentTarget });
  }
  const expanded = (key: string) => menu?.key === key;

  // Меню персонажа (Q27): статусы, одна черта, переходы и удаление.
  const characterMenu = (c: Character): ContextMenuItem[] => [
    ...CHARACTER_STATUSES.map((s) => ({
      label: `${statusOf(c) === s ? "✓ " : "  "}${CHARACTER_STATUS_LABELS[s]}`,
      onClick: () => props.onStatus(c, s),
    })),
    { label: "Открыть лист", dividerBefore: true, onClick: () => navigate(`/characters/${c.id}`) },
    { label: "Быстрый просмотр", onClick: () => props.onPeek(c.id) },
    { label: "Удалить персонажа…", danger: true, onClick: () => props.onDelete(c.id, c.character_name) },
  ];

  const playerMenu = (p: RosterPlayer): ContextMenuItem[] => [
    { label: "Открыть игрока", onClick: () => navigate(`/players/${p.id}`) },
    { label: p.roster_status === "left" ? "Вернуть в состав" : "Игрок покинул кампанию", onClick: () => props.onToggleLeft(p.id, p.roster_status) },
    { label: "Убрать из состава", danger: true, onClick: () => props.onRemovePlayer(p.id) },
  ];

  // Покинувшие — в конце, под своей строкой (Q17); номера дел сквозные.
  const ordered = [...roster.filter((p) => p.roster_status !== "left"), ...roster.filter((p) => p.roster_status === "left")];
  const firstLeft = ordered.findIndex((p) => p.roster_status === "left");

  return <><ul className="dossier-files">
    {ordered.map((p, index) => {
      const own = characters.filter((c) => c.player_id === p.id);
      const living = own.filter(isLiving).sort((a, b) => STATUS_ORDER.indexOf(statusOf(a)) - STATUS_ORDER.indexOf(statusOf(b)));
      const memory = own.filter((c) => !isLiving(c));
      const isLeft = p.roster_status === "left";
      const debt = debts.find((d) => d.player_id === p.id);
      // Посещаемость — игрока, а не персонажа: строка у первого живого (как в концепте).
      const last = p.last_session_date && (
        <p className="dossier-file__last">
          <span>Последняя игра</span> {formatDateKeyRu(p.last_session_date)} · {p.last_session_attended ? "присутствовал" : "пропустил"}
        </p>
      );
      return <Fragment key={p.id}>
        {index === firstLeft && <li className="dossier-files__divider d-mono">Покинули кампанию</li>}
        <li className={`dossier-file${isLeft ? " is-left" : ""}`}>
          <header className="dossier-file__header">
            <div className="dossier-file__title">
              <span className="dossier-file__number">Дело / {String(index + 1).padStart(2, "0")}</span>
              <Link className="dossier-file__player" to={`/players/${p.id}`}>{p.name}</Link>
            </div>
            {debt && !hideFinance && (
              <button type="button" className="dossier-file__debt" aria-haspopup="menu" aria-expanded={expanded(`debt-${p.id}`)}
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => openMenu(e, `debt-${p.id}`, `${p.name}: долг`, [{ label: "Оплатил", onClick: () => props.onSettle(debt) }])}>
                Долг {debt.owed} {currency} · {debt.sessions} {debt.sessions === 1 ? "игра" : debt.sessions < 5 ? "игры" : "игр"}
              </button>
            )}
            <button type="button" className="dossier-file__menu" aria-label={`Действия с делом ${p.name}`} aria-haspopup="menu"
              aria-expanded={expanded(`player-${p.id}`)} onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => openMenu(e, `player-${p.id}`, `Действия с делом ${p.name}`, playerMenu(p))}>
              …
            </button>
          </header>
          <ul className="dossier-file__characters">
            {living.map((c, ci) => {
              const img = c.thumbnail_image_url ?? c.avatar_image_url;
              const info = sheets.get(c.id) ?? { kind: "loading" as const };
              const status = statusOf(c);
              return <li className="dossier-character" key={c.id} data-status={status}
                onContextMenu={(e) => openMenu(e, `char-${c.id}`, c.character_name, characterMenu(c))}>
                <div className="dossier-photo-wrap">
                  <Link className="dossier-photo" to={`/characters/${c.id}`} aria-label={`Лист персонажа ${c.character_name}`}>
                    {img && isSafeImageUrl(img)
                      ? <img className="dossier-photo__image" src={img} alt="" loading="lazy" />
                      : <span className="dossier-photo__placeholder" aria-hidden="true">{c.character_name.slice(0, 1)}</span>}
                    <span className="dossier-photo__signature">{c.character_name}</span>
                  </Link>
                  <button type="button" className="dossier-peek" onClick={() => props.onPeek(c.id)} aria-label={`Быстрый просмотр ${c.character_name}`}>
                    <NavIcon name="eye" />
                  </button>
                </div>
                <div className="dossier-character__info">
                  <button type="button" className="dossier-status" data-status={status} aria-haspopup="menu"
                    aria-label={`Статус ${c.character_name}: ${CHARACTER_STATUS_LABELS[status]}`}
                    aria-expanded={expanded(`char-${c.id}`)} onMouseDown={(e) => e.stopPropagation()}
                    onClick={(e) => openMenu(e, `char-${c.id}`, c.character_name, characterMenu(c))}>
                    {CHARACTER_STATUS_LABELS[status]}
                  </button>
                  <SheetLines id={c.id} name={c.character_name} info={info} />
                  {!!props.spotlight?.[c.id] && <p className="dossier-file__last"><span>Спотлайт за кампанию</span> ×{props.spotlight[c.id]}</p>}
                  {ci === 0 && last}
                </div>
              </li>;
            })}
          </ul>
          {memory.length > 0 && <Memory items={memory} onMenu={(e, c) => openMenu(e, `char-${c.id}`, c.character_name, characterMenu(c))} sheets={sheets} />}
          {!own.length && <p className="dossier-file__empty">Персонажа пока нет</p>}
          {!living.length && last}
          {addingFor === p.id && <form className="dossier-create" onSubmit={(e) => { e.preventDefault(); props.onAddCharacter(p.id); }}>
            <label htmlFor={`dossier-name-${p.id}`}>Имя персонажа</label>
            <input id={`dossier-name-${p.id}`} autoFocus value={drafts[p.id] ?? ""}
              onChange={(e) => props.onDraft(p.id, e.target.value)}
              onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); props.onCancelAdding(); } }} />
            <div className="dossier-create__actions">
              <button type="submit" className="dossier-text-action" disabled={!(drafts[p.id] ?? "").trim()}>Добавить</button>
              <button type="button" className="dossier-text-action" onClick={props.onCancelAdding}>Отмена</button>
            </div>
          </form>}
          <footer className="dossier-file__footer">
            <button type="button" className="dossier-text-action" onClick={() => props.onStartAdding(p.id)} aria-label={`Добавить персонажа игроку ${p.name}`}>+ Персонаж</button>
          </footer>
        </li>
      </Fragment>;
    })}
  </ul>
  {menu && createPortal(<div className="dossier-action-menu paper-scope" ref={menuRoot}
    onKeyDown={(e) => {
      if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
      const buttons = [...(menuRoot.current?.querySelectorAll<HTMLButtonElement>("button") ?? [])];
      if (!buttons.length) return;
      e.preventDefault();
      const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
      const next = e.key === "Home" ? 0 : e.key === "End" ? buttons.length - 1 : (index + (e.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length;
      buttons[next]?.focus({ preventScroll: true });
    }}>
    <ContextMenu x={menu.x} y={menu.y} title={menu.title} ariaLabel={menu.title} items={menu.items} onClose={closeMenu} />
  </div>, document.body)}
  </>;
}

function SheetLines({ id, name, info }: { id: number; name: string; info: SheetInfo }) {
  if (info.kind === "loading") return <p className="dossier-sheet muted" aria-busy="true">…</p>;
  if (info.kind === "error") return <button type="button" className="dossier-text-action" onClick={info.retry}>Повторить загрузку</button>;
  if (info.kind === "empty") return <p className="dossier-sheet muted">Лист не заполнен · <Link to={`/characters/${id}`}>Заполнить ›</Link></p>;
  if (info.kind === "other") return <p className="dossier-sheet"><Link to={`/characters/${id}`}>Открыть лист ›</Link></p>;
  return <>
    {info.line && <p className="dossier-sheet__line">{info.line}</p>}
    <dl className="dossier-stats" aria-label={`Характеристики ${name}`}>
      <div><dt>кз</dt><dd>{info.ac}</dd></div>
      <div><dt>хиты</dt><dd>{info.hp}</dd></div>
      <div><dt>скор.</dt><dd>{info.speed}</dd></div>
    </dl>
  </>;
}

// «Память» (Q22): погибшие и ушедшие одной строкой; больше трёх — свёрнуто.
function Memory({ items, sheets, onMenu }: { items: Character[]; sheets: Map<number, SheetInfo>; onMenu: (e: React.MouseEvent<HTMLElement>, c: Character) => void }) {
  const list = <ul className="dossier-memory__list">
    {items.map((c) => {
      const img = c.thumbnail_image_url ?? c.avatar_image_url;
      const info = sheets.get(c.id);
      const dead = statusOf(c) === "dead";
      return <li key={c.id} onContextMenu={(e) => onMenu(e, c)}>
        <Link to={`/characters/${c.id}`} className="dossier-memory__item">
          {img && isSafeImageUrl(img) ? <img src={img} alt="" loading="lazy" /> : <span className="dossier-memory__dot" aria-hidden="true">{c.character_name.slice(0, 1)}</span>}
          <span>{dead ? "† " : ""}{c.character_name}{info?.kind === "dnd" && info.line ? ` · ${info.line}` : ""}{dead ? "" : " · ушёл"}</span>
        </Link>
      </li>;
    })}
  </ul>;
  return items.length > MEMORY_INLINE
    ? <details className="dossier-memory"><summary className="dossier-memory__label">Память · {items.length}</summary>{list}</details>
    : <div className="dossier-memory"><span className="dossier-memory__label">Память:</span>{list}</div>;
}
