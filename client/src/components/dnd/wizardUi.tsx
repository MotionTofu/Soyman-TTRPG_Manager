import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { CompendiumEntry } from "../../types";
import { readResource } from "../../data/imperative";
import { Modal } from "../Modal";
import { MentionText } from "../mentions/MentionText";
import { CardPicture, CardScroll, useCardEntry, type CardOption } from "./DndCards";
import "./wizard-mobile.css";
import "./wizard-skin.css";

// Арт наборов и прочие ассеты облика визарда — в public/ui/wizard (OneShot
// берёт public из client).
const setPackArt = "/ui/wizard/set-pack.webp";
const setChestArt = "/ui/wizard/set-chest.webp";

/**
 * Детали мобильного визарда (гриллинг 2026-09-24): шторка снизу, список со
 * строками под палец, лента карт и выбор «набор или сундук». Правило одно:
 * у выбора есть арт — лента, нет — список со шторкой описания.
 */

// ——— шторка ———

export function Sheet({
  title,
  onClose,
  children,
  actions,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <Modal onClose={onClose} className="wz-sheet" ariaLabel={title} autoFocus={false}>
      <div className="wz-sheet-in">
        <div className="wz-sheet-head">
          <strong>{title}</strong>
          <button type="button" className="wz-icon-btn" aria-label="Закрыть" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="wz-sheet-body">{children}</div>
        {actions && <div className="wz-sheet-foot">{actions}</div>}
      </div>
    </Modal>
  );
}

/** Шторка записи справочника: описание догружается, если его не принесли. */
export function EntrySheet({
  entryId,
  entry: given,
  title,
  meta,
  extra,
  action,
  onClose,
}: {
  entryId: number;
  entry?: CompendiumEntry | null;
  title?: string;
  meta?: ReactNode;
  extra?: ReactNode;
  action?: { label: string; onClick: () => void; disabled?: boolean };
  onClose: () => void;
}) {
  const [entry, setEntry] = useState<CompendiumEntry | null>(given ?? null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (given?.description != null) return;
    let alive = true;
    readResource<CompendiumEntry>(`/systems/entries/${entryId}`)
      .then((e) => alive && setEntry(e))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [entryId, given]);
  return (
    <Sheet
      title={title ?? entry?.name ?? "…"}
      onClose={onClose}
      actions={
        action && (
          <span className="wz-shadow">
            <button type="button" className="primary wz-wide-btn" disabled={action.disabled} onClick={action.onClick}>
              {action.label}
            </button>
          </span>
        )
      }
    >
      {meta && <div className="wz-sheet-meta">{meta}</div>}
      {entry ? (
        <MentionText text={entry.description?.trim() ? entry.description : "Описания нет."} />
      ) : (
        <span className="muted">{failed ? "Описание не загрузилось." : "Загружаю…"}</span>
      )}
      {extra}
    </Sheet>
  );
}

// ——— список со строками под палец ———

export interface PickRow {
  key: string;
  title: ReactNode;
  meta?: ReactNode;
  picked: boolean;
  /** Строка видна, но не берётся («с 5 ур.», «уже есть»). */
  disabled?: boolean;
}

/**
 * Строка: тап по тексту — шторка с описанием (если есть `onOpen`), тап по
 * отметке — взять сразу. Без описания тап по всей строке берёт.
 */
export function PickList({
  rows,
  onToggle,
  onOpen,
  full,
  collapse,
}: {
  rows: PickRow[];
  onToggle: (key: string) => void;
  onOpen?: (key: string) => void;
  /** Квота набрана: невзятые строки приглушены (кроме квоты 1 — там замена). */
  full?: boolean;
  /** Выбор сделан — список сворачивается до взятого, остальное по кнопке:
   *  тридцать строк под выбранной прятали то, что шаг просит дальше. */
  collapse?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  if (rows.length === 0) return <span className="muted">Ничего не найдено.</span>;
  const folded = !!collapse && !expanded && rows.some((r) => r.picked);
  const shown = folded ? rows.filter((r) => r.picked) : rows;
  return (
    <>
    <ul className="wz-list">
      {shown.map((r) => {
        const blocked = r.disabled || (full && !r.picked);
        return (
          <li key={r.key} className={`wz-row${r.picked ? " is-picked" : ""}${blocked ? " is-blocked" : ""}`}>
            <button
              type="button"
              className="wz-row-main"
              disabled={!onOpen && blocked}
              onClick={() => (onOpen ? onOpen(r.key) : onToggle(r.key))}
            >
              <span className="wz-row-title">{r.title}</span>
              {r.meta && <span className="wz-row-meta">{r.meta}</span>}
            </button>
            <button
              type="button"
              className="wz-row-check"
              aria-pressed={r.picked}
              aria-label={r.picked ? "Убрать" : "Взять"}
              disabled={blocked}
              onClick={() => onToggle(r.key)}
            >
              <span aria-hidden="true">{r.picked ? "✓" : "+"}</span>
            </button>
          </li>
        );
      })}
    </ul>
    {folded && (
      <button type="button" className="wz-more" onClick={() => setExpanded(true)}>
        Показать все варианты ({rows.length})
      </button>
    )}
    {collapse && expanded && (
      <button type="button" className="wz-more" onClick={() => setExpanded(false)}>
        Свернуть до выбранного
      </button>
    )}
    </>
  );
}

/** Заголовок группы выбора со счётчиком «2/3». */
export function PickHead({ label, picked, total, hint }: { label: ReactNode; picked?: number; total?: number; hint?: ReactNode }) {
  const counted = picked != null && total != null;
  return (
    <div className="wz-group-head">
      <span className="wz-group-label">{label}</span>
      {counted && (
        <span className={`wz-count${picked >= total ? " is-done" : ""}`}>
          {picked}/{total}
        </span>
      )}
      {hint && <span className="wz-group-hint">{hint}</span>}
    </div>
  );
}

/** Поиск над списком или лентой. */
export function SearchField({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <input
      type="search"
      className="wz-search"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      aria-label={placeholder}
    />
  );
}

// ——— лента карт ———

/** Своя карта в конце ленты («Свой вариант»): id -1, без рубашки. */
export const CUSTOM_CARD_ID = -1;

/**
 * Лента карт: одна карта на экран (на ПК — три-четыре), свайп с доводкой,
 * тап по центральной карте переворачивает её на текст, по соседней —
 * подводит к центру. Под лентой — имя, счётчик и «Выбрать».
 */
export function CardRibbon({
  systemId,
  options,
  selectedId,
  onPick,
  searchPlaceholder,
  noteFor,
  pickDisabled,
  aside,
}: {
  systemId: number | null;
  options: CardOption[];
  selectedId: number | null;
  onPick: (id: number) => void;
  searchPlaceholder?: string;
  noteFor?: (o: CardOption) => string | undefined;
  /** Выбор недоступен (подкласс раньше своего уровня) — только смотреть. */
  pickDisabled?: string;
  /** Рядом с поиском — например, уровень у ленты классов. */
  aside?: ReactNode;
}) {
  const [q, setQ] = useState("");
  const needle = q.trim().toLowerCase();
  const list = needle ? options.filter((o) => o.id === CUSTOM_CARD_ID || o.name.toLowerCase().includes(needle)) : options;
  const trackRef = useRef<HTMLDivElement>(null);
  const [cur, setCur] = useState(0);
  const [flipped, setFlipped] = useState<number | null>(null);

  function scrollToIndex(i: number, smooth = true) {
    const track = trackRef.current;
    const slide = track?.children[i] as HTMLElement | undefined;
    if (!track || !slide) return;
    track.scrollTo({ left: slide.offsetLeft - (track.clientWidth - slide.clientWidth) / 2, behavior: smooth ? "smooth" : "auto" });
  }
  function onScroll() {
    const track = trackRef.current;
    if (!track) return;
    const center = track.scrollLeft + track.clientWidth / 2;
    let best = 0;
    let bestDist = Infinity;
    Array.from(track.children).forEach((el, i) => {
      const s = el as HTMLElement;
      const d = Math.abs(s.offsetLeft + s.clientWidth / 2 - center);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    });
    if (best !== cur) {
      setCur(best);
      setFlipped(null);
    }
  }
  // К выбранной — при открытии шага и после смены поиска.
  useLayoutEffect(() => {
    const i = Math.max(0, list.findIndex((o) => o.id === selectedId));
    setCur(i);
    scrollToIndex(i, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needle]);

  const current = list[Math.min(cur, list.length - 1)];
  const isCustom = current?.id === CUSTOM_CARD_ID;
  const chosen = current != null && current.id === selectedId;

  return (
    <div className="wz-ribbon">
      {(searchPlaceholder || aside) && (
        <div className="wz-ribbon-tools">
          {searchPlaceholder && <SearchField value={q} onChange={setQ} placeholder={searchPlaceholder} />}
          {aside}
        </div>
      )}
      {list.length === 0 ? (
        <span className="muted">Ничего не найдено.</span>
      ) : (
        <>
          <div ref={trackRef} className="wz-ribbon-track" onScroll={onScroll}>
            {list.map((o, i) => {
              const note = noteFor?.(o);
              return (
                <div
                  key={o.id}
                  className={`wz-slide${i === cur ? " is-current" : ""}${o.id === selectedId ? " is-selected" : ""}`}
                  aria-current={i === cur}
                >
                  {flipped === o.id ? (
                    <RibbonBack systemId={systemId} entryId={o.id} onFlip={() => setFlipped(null)} />
                  ) : (
                    <button
                      type="button"
                      className="wz-slide-face"
                      aria-label={i === cur ? `${o.name}: перевернуть` : o.name}
                      onClick={() => {
                        if (i !== cur) return scrollToIndex(i);
                        if (o.id === CUSTOM_CARD_ID) return onPick(o.id);
                        setFlipped(o.id);
                      }}
                    >
                      {o.id === CUSTOM_CARD_ID ? (
                        <span className="wz-slide-custom">
                          <span>{o.name}</span>
                          <span className="muted">договоритесь с Мастером</span>
                        </span>
                      ) : (
                        <CardPicture id={o.id} name={o.name} card={o.card} thumb={320} />
                      )}
                      {note && <span className="dc-tile-note">{note}</span>}
                      {o.id === selectedId && <span className="wz-slide-badge">Выбрано</span>}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
          <div className="wz-ribbon-bar">
            <button type="button" className="wz-icon-btn wz-ribbon-arrow" aria-label="Предыдущая" disabled={cur <= 0} onClick={() => scrollToIndex(cur - 1)}>
              ‹
            </button>
            <div className="wz-ribbon-caption">
              <strong className="wz-display">{current?.name}</strong>
              <span className="muted">
                {cur + 1} / {list.length}
                {!isCustom && " · коснись карты — текст"}
              </span>
            </div>
            <button
              type="button"
              className="wz-icon-btn wz-ribbon-arrow"
              aria-label="Следующая"
              disabled={cur >= list.length - 1}
              onClick={() => scrollToIndex(cur + 1)}
            >
              ›
            </button>
          </div>
          {pickDisabled ? (
            <span className="muted wz-center">{pickDisabled}</span>
          ) : (
            <button
              type="button"
              className={`wz-wide-btn${chosen ? "" : " primary"}`}
              disabled={chosen || !current}
              onClick={() => current && onPick(current.id)}
            >
              {chosen ? (
                <>
                  ✓ Выбрано: <span className="wz-hl">{current?.name}</span>
                </>
              ) : (
                <>
                  Выбрать: <span className="wz-hl">{current?.name ?? ""}</span>
                </>
              )}
            </button>
          )}
        </>
      )}
    </div>
  );
}

function RibbonBack({ systemId, entryId, onFlip }: { systemId: number | null; entryId: number; onFlip: () => void }) {
  const { data, error } = useCardEntry(systemId, entryId);
  return (
    <div className="wz-slide-back">
      <button type="button" className="wz-slide-flip" onClick={onFlip}>
        ↺ к карте
      </button>
      {error ? (
        <span className="muted">Текст не загрузился: {error}</span>
      ) : !data ? (
        <span className="muted">Загружаю…</span>
      ) : (
        <CardScroll entry={data.entry} features={data.features} anchorPrefix={`wz${entryId}`} />
      )}
    </div>
  );
}

// ——— снаряжение: набор или сундук ———

export interface DuelOption {
  label: string;
  letter: string;
  gold: number;
  items: string[];
  /** Выборы внутри набора, ещё не сделанные («музыкальный инструмент»). */
  pending: string[];
}

/**
 * Ряд «как в Героях»: набор против сундука. Вариант только с золотом —
 * сундук, с вещами — набор. Тап выбирает, «i» — полный список в шторке.
 */
export function SetDuel({
  title,
  options,
  selected,
  onSelect,
  onOpen,
}: {
  title: string;
  options: DuelOption[];
  selected: string | null;
  onSelect: (label: string) => void;
  onOpen: (label: string) => void;
}) {
  return (
    <section className="wz-duel">
      <PickHead label={title} />
      <div className="wz-duel-row" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
        {options.map((o) => {
          const chest = o.items.length === 0;
          const on = o.label === selected;
          return (
            <div key={o.label} className={`wz-set${on ? " is-selected" : ""}`}>
              <button type="button" className="wz-set-main" aria-pressed={on} onClick={() => onSelect(o.label)}>
                <img className="wz-set-art" src={chest ? setChestArt : setPackArt} alt="" draggable={false} />
                <span className="wz-set-letter">{o.letter}</span>
                {chest ? (
                  <span className="wz-set-gold is-big">{o.gold} ЗМ</span>
                ) : (
                  <>
                    <span className="wz-set-items">
                      {o.items.slice(0, 3).join(", ")}
                      {o.items.length > 3 && ` и ещё ${o.items.length - 3}`}
                    </span>
                    {o.gold > 0 && <span className="wz-set-gold">+ {o.gold} ЗМ</span>}
                  </>
                )}
              </button>
              {!chest && (
                <button type="button" className="wz-set-info" aria-label={`Состав: ${o.label}`} onClick={() => onOpen(o.label)}>
                  i
                </button>
              )}
              {on && o.pending.length > 0 && (
                <button type="button" className="wz-set-pending" onClick={() => onOpen(o.label)}>
                  Выбрать: {o.pending.join(", ")}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

// ——— прогресс: нотный стан ———

/** Центры черепов-нот стана (% ширины картинки staff.webp) и начало его
 *  концовки — тактовая черта со звездой. Картинка одна на 11 нот: шагов
 *  меньше — стан режется после последней нужной ноты и подклеивается концовка,
 *  поэтому высота одна и шапка не прыгает, когда меняется число шагов. */
const STAFF_NOTES = [16.2, 23.2, 30.1, 36.4, 43.8, 50.6, 58.1, 66.0, 73.2, 80.1, 88.3];
const STAFF_END = 91.5;

export function StepStaff({ index, total, onOpen }: { index: number; total: number; onOpen: () => void }) {
  const t = Math.max(1, Math.min(total, STAFF_NOTES.length));
  const i = Math.max(0, Math.min(index, t - 1));
  const last = i === t - 1;
  const left = t === STAFF_NOTES.length ? STAFF_END : (STAFF_NOTES[t - 1] + STAFF_NOTES[t]) / 2;
  const done = last ? left : (STAFF_NOTES[i] + STAFF_NOTES[i + 1]) / 2;
  const w = (pct: number) => `calc(var(--staff-w) * ${pct / 100})`;
  return (
    <button type="button" className="wz-staff" aria-label={`Шаг ${i + 1} из ${t} — все шаги`} onClick={onOpen}>
      <span className="wz-staff-part is-dim" style={{ width: w(left) }} />
      <span className={`wz-staff-part wz-staff-end${last ? "" : " is-dim"}`} style={{ width: w(100 - STAFF_END) }} />
      <span className="wz-staff-part wz-staff-done" style={{ width: w(done) }} />
      <span className="wz-staff-mark" style={{ left: w(STAFF_NOTES[i]) }} />
    </button>
  );
}
