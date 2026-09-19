import { useCallback, useEffect, useLayoutEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { CompendiumEntry } from "../../types";
import { readResource } from "../../data/imperative";
import { api } from "../../api/client";
import { useDndPrefs } from "../../hooks/useDndPrefs";
import type { DndCardBack } from "../../dndPrefs";
import { MentionText } from "../mentions/MentionText";
import { openMentionPreview } from "../mentions/mentionPreviewStore";
import { ContextMenu } from "../ContextMenu";
import { Modal } from "../Modal";
import { useIsMobile } from "../../hooks/useIsMobile";
import { loadDndClassFeatures, loadDndSpeciesFeatures } from "./dndCompendium";
import backGood from "../../assets/cards/back-good.webp";
import backEvil from "../../assets/cards/back-evil.webp";
import "./dnd-cards.css";

/**
 * Карты классов, подклассов и видов (гриллинг 2026-09-18): плитка, лицо и
 * рубашка-свиток с описанием. Одни детали на визард, лист и раздел системы —
 * иначе три места разошлись бы в том, что на рубашке написано.
 *
 * Карта — `avatar_image_url` записи (WebP 1024×1536). Нет карты — рисуется
 * рубашка с набранным именем. Рубашка — личная настройка (dndPrefs.cardBack).
 */

const BACKS: Record<DndCardBack, string> = { good: backGood, evil: backEvil };

/** Превью карты: сервер ужимает файл по `?w=` (160/320), подпись ссылки
 *  остаётся в силе — параметр дописывается к ней. */
export function cardThumb(url: string, width: 160 | 320): string {
  // OneShot stores catalog images inline. Query parameters are meaningful
  // only for the SoyMan file route; appending one to data:/blob: corrupts
  // the URL (the base64 payload becomes a different resource).
  if (url.startsWith("data:") || url.startsWith("blob:")) return url;
  return `${url}${url.includes("?") ? "&" : "?"}w=${width}`;
}

export interface CardOption {
  id: number;
  name: string;
  card: string | null;
}

function CardPicture({ id, name, card, thumb }: { id: number; name: string; card: string | null; thumb?: 160 | 320 }) {
  const { cardBack } = useDndPrefs();
  // Ссылка на файл подписана на 60 секунд, а списки карт живут дольше:
  // плитка, впервые нарисованная позже (вкладка подклассов, лента), получала
  // бы протухшую подпись. Отказ картинки — один перезапрос записи мимо кэша
  // слоя данных за свежей подписью.
  const [fresh, setFresh] = useState<string | null>(null);
  const [retried, setRetried] = useState(false);
  useEffect(() => {
    setFresh(null);
    setRetried(false);
  }, [card]);
  const url = fresh ?? card;
  if (url) {
    return (
      <img
        className="dc-img"
        src={thumb ? cardThumb(url, thumb) : url}
        alt={name}
        loading="lazy"
        draggable={false}
        onError={() => {
          if (retried || id < 0) return;
          setRetried(true);
          api
            .get<CompendiumEntry>(`/systems/entries/${id}`)
            .then((e) => e.avatar_image_url && setFresh(e.avatar_image_url))
            .catch(() => {});
        }}
      />
    );
  }
  return (
    <span className="dc-img dc-img--blank" style={{ backgroundImage: `url(${BACKS[cardBack]})` }}>
      <span className="dc-blank-name">{name}</span>
    </span>
  );
}

/** Плитка сетки и ленты. `note` — подпись поверх низа («с 3 ур.»). */
export function CardTile({
  option,
  browseOptions,
  selected,
  dim,
  note,
  small,
  onClick,
}: {
  option: CardOption;
  /** Соседи из той же сетки для перелистывания крупного изображения. */
  browseOptions?: CardOption[];
  selected?: boolean;
  dim?: boolean;
  note?: string;
  small?: boolean;
  onClick: () => void;
}) {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [previewId, setPreviewId] = useState<number | null>(null);
  const browse = browseOptions && browseOptions.length > 0 ? browseOptions : null;
  const previewIndex = browse && previewId != null ? browse.findIndex((candidate) => candidate.id === previewId) : -1;
  const previewOption = previewIndex >= 0 && browse ? browse[previewIndex] : option;
  const canBrowse = !!browse && browse.length > 1;

  const stepPreview = useCallback((delta: -1 | 1) => {
    if (!browse || browse.length < 2) return;
    setPreviewId((currentId) => {
      const index = Math.max(0, browse.findIndex((candidate) => candidate.id === currentId));
      return browse[(index + delta + browse.length) % browse.length].id;
    });
  }, [browse]);

  function openContextMenu(event: ReactMouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    setMenu({
      x: event.clientX || rect.left,
      y: event.clientY || rect.bottom,
    });
  }

  useEffect(() => {
    if (previewId == null || !canBrowse) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      stepPreview(event.key === "ArrowLeft" ? -1 : 1);
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [previewId, canBrowse, stepPreview]);

  return (
    <>
      <button
        type="button"
        className={`dc-tile${selected ? " is-selected" : ""}${dim ? " is-dim" : ""}${small ? " dc-tile--small" : ""}`}
        aria-pressed={selected}
        title={option.name}
        onClick={onClick}
        onContextMenu={openContextMenu}
      >
        <CardPicture id={option.id} name={option.name} card={option.card} thumb={small ? 160 : 320} />
        {note && <span className="dc-tile-note">{note}</span>}
        {/* Имя простым текстом (владелец, 2026-09-18): надпись на самой карте
            мелкая, а в ленте её не разобрать вовсе. */}
        <span className="dc-tile-name">{option.name}</span>
      </button>
      {menu && createPortal(
        <ContextMenu
          x={menu.x}
          y={menu.y}
          title={option.name}
          items={[{ label: "Открыть изображение крупно", onClick: () => setPreviewId(option.id) }]}
          onClose={() => setMenu(null)}
        />,
        document.body
      )}
      {previewId != null && (
        <Modal
          className="dc-card-image-modal"
          ariaLabel={`Изображение карты «${previewOption.name}»`}
          onClose={() => setPreviewId(null)}
        >
          <button
            type="button"
            className="dc-card-image-close"
            aria-label="Закрыть"
            title="Закрыть"
            onClick={() => setPreviewId(null)}
          >
            ×
          </button>
          <CardPicture id={previewOption.id} name={previewOption.name} card={previewOption.card} />
          {canBrowse && browse && (
            <nav className="dc-card-image-nav" aria-label="Соседние карты">
              <button type="button" onClick={() => stepPreview(-1)} title="Предыдущая карта">
                <span aria-hidden="true">←</span>
                <span>{browse[(previewIndex - 1 + browse.length) % browse.length].name}</span>
              </button>
              <button type="button" onClick={() => stepPreview(1)} title="Следующая карта">
                <span>{browse[(previewIndex + 1) % browse.length].name}</span>
                <span aria-hidden="true">→</span>
              </button>
            </nav>
          )}
        </Modal>
      )}
    </>
  );
}

/** Сетка плиток. На ПК после выбора сворачивается в ленту (`collapsed`). */
export function CardGrid({
  options,
  selectedId,
  collapsed,
  noteFor,
  dimFor,
  onPick,
  trailing,
}: {
  options: CardOption[];
  selectedId: number | null;
  collapsed?: boolean;
  noteFor?: (o: CardOption) => string | undefined;
  dimFor?: (o: CardOption) => boolean;
  onPick: (o: CardOption) => void;
  /** Последняя плитка сверх списка («Свой вариант» у видов). */
  trailing?: ReactNode;
}) {
  const stripRef = useRef<HTMLDivElement>(null);
  // Лента прокручивается к выбранной: в ней два десятка плиток, и выбранная
  // иначе оказывается за краем.
  useEffect(() => {
    if (!collapsed) return;
    stripRef.current?.querySelector<HTMLElement>(".is-selected")?.scrollIntoView({ inline: "center", block: "nearest" });
  }, [collapsed, selectedId]);
  return (
    <div ref={stripRef} className={collapsed ? "dc-strip" : "dc-grid"}>
      {options.map((o) => (
        <CardTile
          key={o.id}
          option={o}
          browseOptions={options}
          small={collapsed}
          selected={o.id === selectedId}
          dim={dimFor?.(o)}
          note={noteFor?.(o)}
          onClick={() => onPick(o)}
        />
      ))}
      {trailing}
    </div>
  );
}

// ——— рубашка-свиток ———

interface ProgressionColumn {
  key: string;
  label: string;
  role?: string;
}
interface Progression {
  columns: ProgressionColumn[];
  rows: Record<string, string>[];
}

function readProgression(entry: CompendiumEntry): Progression | null {
  const p = entry.data.progression as Progression | undefined;
  return p && Array.isArray(p.columns) && Array.isArray(p.rows) && p.columns.length > 0 ? p : null;
}

const norm = (s: string) => s.trim().toLocaleLowerCase("ru").replace(/ё/g, "е");

/**
 * Имя умения, по щелчку — окошко с его текстом (решение 8: и ПК, и телефон,
 * под словом или над ним — по тому, где больше места). Стрелка — в полную
 * запись; в листе её перехватывает карточка умения персонажа.
 */
export function AbilityRef({
  feature,
  label,
  onOpenFull,
}: {
  feature: CompendiumEntry;
  label?: string;
  onOpenFull?: (feature: CompendiumEntry) => void;
}) {
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number } | null>(null);

  function toggle() {
    if (pos) return setPos(null);
    const r = btnRef.current!.getBoundingClientRect();
    const width = Math.min(340, window.innerWidth - 16);
    const left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8));
    // Нижняя половина экрана — окошко над словом, верхняя — под ним.
    setPos(r.top > window.innerHeight / 2 ? { left, bottom: window.innerHeight - r.top + 6 } : { left, top: r.bottom + 6 });
  }

  useEffect(() => {
    if (!pos) return;
    const close = (e: Event) => {
      const t = e.target as Node;
      if (popRef.current?.contains(t) || btnRef.current?.contains(t)) return;
      setPos(null);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setPos(null);
    // Прокрутка подложки уводит слово из-под окошка — окошко закрывается,
    // а не висит отдельно от него. Прокрутка внутри самого окошка — нет.
    const onScroll = (e: Event) => {
      if (!popRef.current?.contains(e.target as Node)) setPos(null);
    };
    const onResize = () => setPos(null);
    document.addEventListener("pointerdown", close, true);
    document.addEventListener("keydown", onKey, true);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    return () => {
      document.removeEventListener("pointerdown", close, true);
      document.removeEventListener("keydown", onKey, true);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
    };
  }, [pos]);

  return (
    <>
      <button ref={btnRef} type="button" className="dc-ability" aria-expanded={!!pos} onClick={toggle}>
        {label ?? feature.name}
      </button>
      {pos &&
        createPortal(
          <div
            ref={popRef}
            className="dc-pop"
            role="dialog"
            aria-label={feature.name}
            style={{ left: pos.left, top: pos.top, bottom: pos.bottom }}
          >
            <div className="dc-pop-head">
              <strong>{feature.name}</strong>
              {feature.level != null && <span className="muted"> · {feature.level} ур.</span>}
              <button
                type="button"
                className="dc-pop-full"
                aria-label="Открыть полностью"
                title="Открыть полностью"
                onClick={() => {
                  setPos(null);
                  (onOpenFull ?? ((f) => openMentionPreview("compendium_entry", f.id)))(feature);
                }}
              >
                →
              </button>
            </div>
            <div className="dc-pop-body">
              <MentionText text={feature.description || "Описания нет."} />
            </div>
          </div>,
          document.body
        )}
    </>
  );
}

function statLine(entry: CompendiumEntry): string {
  const d = entry.data;
  const parts: string[] = [];
  if (entry.kind === "class") {
    if (d.hit_die) parts.push(`Кость хитов ${String(d.hit_die)}`);
    const prim = Array.isArray(d.primary_abilities) ? d.primary_abilities.join(", ") : String(d.primary_abilities ?? "");
    if (prim) parts.push(`Основная: ${prim}`);
    const saves = Array.isArray(d.saving_throws) ? d.saving_throws.join(", ") : String(d.saving_throws ?? "");
    if (saves) parts.push(`Спасброски: ${saves}`);
  }
  if (entry.kind === "species") {
    if (d.size) parts.push(String(d.size));
    const type = (d.creature_type as { name?: string } | undefined)?.name;
    if (type) parts.push(type);
    for (const s of (d.speeds as { name: string; distance: string }[] | undefined) ?? []) {
      if (s.distance) parts.push(`${s.name.toLowerCase()} ${s.distance} фт.`);
    }
    for (const s of (d.senses as { name: string; distance: string }[] | undefined) ?? []) {
      parts.push(s.distance ? `${s.name.toLowerCase()} ${s.distance} фт.` : s.name.toLowerCase());
    }
  }
  return parts.join(" · ");
}

/**
 * Рубашка-свиток. Порядок (решение 18): полоса подклассов наверху — кто
 * пришёл за подклассом, тот не листает весь класс; сводка; таблица развития,
 * она же оглавление (щелчок по уровню — к умениям уровня); умения.
 *
 * `currentLevel` — лист персонажа: строка уровня подсвечена, умения выше
 * приглушены, но не скрыты.
 */
export function CardScroll({
  entry,
  features,
  strip,
  currentLevel,
  onOpenFull,
  anchorPrefix,
}: {
  entry: CompendiumEntry;
  features: CompendiumEntry[];
  strip?: ReactNode;
  currentLevel?: number;
  onOpenFull?: (feature: CompendiumEntry) => void;
  /** Префикс якорей уровней — две рубашки на странице не должны делить id. */
  anchorPrefix: string;
}) {
  const { cardBack } = useDndPrefs();
  const prog = readProgression(entry);
  const byName = new Map(features.map((f) => [norm(f.name), f]));
  const levels = [...new Set(features.map((f) => f.level ?? 0))].sort((a, b) => a - b);
  const stats = statLine(entry);

  function jump(level: number) {
    document.getElementById(`${anchorPrefix}-lvl-${level}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function featureCell(text: string) {
    const names = text.split(/,\s*/).filter(Boolean);
    return names.map((n, i) => {
      const f = byName.get(norm(n));
      return (
        <span key={i}>
          {i > 0 && ", "}
          {f ? <AbilityRef feature={f} label={n} onOpenFull={onOpenFull} /> : n}
        </span>
      );
    });
  }

  return (
    <div className={`dc-scroll dc-scroll--${cardBack}`}>
      <div className="dc-scroll-frame" aria-hidden="true" />
      <div className="dc-scroll-body">
        {strip}
        <h3 className="dc-title">{entry.name}</h3>
        {stats && <p className="dc-stats">{stats}</p>}
        {entry.description && (
          <div className="dc-summary">
            <MentionText text={entry.description} />
          </div>
        )}
        {prog && (
          <div className="dc-prog-wrap">
            <table className="dc-prog">
              <thead>
                <tr>
                  {prog.columns.map((c) => (
                    <th key={c.key}>{c.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {prog.rows.map((row, ri) => {
                  const lvl = Number(row[prog.columns.find((c) => c.role === "level")?.key ?? ""]) || ri + 1;
                  return (
                    <tr key={ri} className={currentLevel === lvl ? "is-current" : currentLevel != null && lvl > currentLevel ? "is-ahead" : ""}>
                      {prog.columns.map((c) => (
                        <td key={c.key}>
                          {c.role === "level" && levels.includes(lvl) ? (
                            <button type="button" className="dc-lvl" onClick={() => jump(lvl)} title="К умениям уровня">
                              {row[c.key]}
                            </button>
                          ) : c.role === "features" ? (
                            featureCell(row[c.key] ?? "")
                          ) : (
                            row[c.key]
                          )}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {levels.map((lvl) => (
          <section
            key={lvl}
            id={`${anchorPrefix}-lvl-${lvl}`}
            className={`dc-level${currentLevel != null && lvl > currentLevel ? " is-ahead" : ""}`}
          >
            {lvl > 0 && <h4 className="dc-level-head">{lvl} уровень</h4>}
            {features
              .filter((f) => (f.level ?? 0) === lvl)
              .map((f) => (
                <div key={f.id} className="dc-feature">
                  <h5>{f.name}</h5>
                  <MentionText text={f.description || ""} />
                </div>
              ))}
          </section>
        ))}
      </div>
    </div>
  );
}

// ——— запись целиком: лицо + рубашка ———

/** Запись и её умения. Чтения идут через слой данных — повторное открытие
 *  той же карты ответ не ждёт. */
export function useCardEntry(systemId: number | null, entryId: number | null) {
  const [state, setState] = useState<{ id: number; entry: CompendiumEntry; features: CompendiumEntry[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!systemId || !entryId) return;
    let alive = true;
    setError(null);
    readResource<CompendiumEntry>(`/systems/entries/${entryId}`)
      .then(async (entry) => {
        const features =
          entry.kind === "species"
            ? await loadDndSpeciesFeatures(systemId, entryId)
            : await loadDndClassFeatures(systemId, entryId);
        const sorted = [...features].sort((a, b) => (a.level ?? 0) - (b.level ?? 0) || a.position - b.position);
        if (alive) setState({ id: entryId, entry, features: sorted });
      })
      .catch((e: unknown) => {
        if (alive) setError(e instanceof Error ? e.message : "не загрузилось");
      });
    return () => {
      alive = false;
    };
  }, [systemId, entryId]);
  return { data: state && state.id === entryId ? state : null, error };
}

/**
 * Лицо и рубашка. ПК — рядом, лицо липнет к верху. Телефон (решение 5,
 * вариант «Б») — одна сторона, переворот касанием по лицу; на рубашке
 * липкая полоска: имя, «к оглавлению», «↺ лицо».
 */
export function CardSpread({
  systemId,
  entryId,
  strip,
  currentLevel,
  onOpenFull,
  actions,
}: {
  systemId: number | null;
  entryId: number;
  strip?: ReactNode;
  currentLevel?: number;
  onOpenFull?: (feature: CompendiumEntry) => void;
  /** Кнопки под лицом («Выбрать»). */
  actions?: ReactNode;
}) {
  const { data, error } = useCardEntry(systemId, entryId);
  const mobile = useIsMobile();
  const [flipped, setFlipped] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => setFlipped(false), [entryId]);

  if (error) return <div className="muted">Карта не загрузилась: {error}</div>;
  if (!data) return <div className="muted">Загружаю карту…</div>;
  const { entry, features } = data;
  const anchor = `dc${entry.id}`;
  const face = (
    <div className="dc-face">
      <button
        type="button"
        className="dc-face-btn"
        onClick={() => mobile && setFlipped(true)}
        aria-label={mobile ? `${entry.name}: перевернуть` : entry.name}
        tabIndex={mobile ? 0 : -1}
      >
        <CardPicture id={entry.id} name={entry.name} card={entry.avatar_image_url ?? null} />
      </button>
      {mobile && <span className="dc-flip-hint muted">Коснись карты — перевернуть</span>}
      {actions && <div className="dc-face-actions">{actions}</div>}
    </div>
  );
  const scroll = (
    <CardScroll
      entry={entry}
      features={features}
      strip={strip}
      currentLevel={currentLevel}
      onOpenFull={onOpenFull}
      anchorPrefix={anchor}
    />
  );
  if (!mobile) {
    return (
      <div ref={rootRef} className="dc-spread">
        {face}
        {scroll}
      </div>
    );
  }
  return (
    <div ref={rootRef} className="dc-spread is-mobile">
      {flipped ? (
        <>
          <div className="dc-mobile-bar">
            <strong>{entry.name}</strong>
            <button
              type="button"
              onClick={() => rootRef.current?.querySelector(".dc-prog-wrap, .dc-summary")?.scrollIntoView({ block: "start" })}
            >
              к оглавлению
            </button>
            <button type="button" onClick={() => setFlipped(false)}>
              ↺ лицо
            </button>
          </div>
          {scroll}
          {actions && <div className="dc-face-actions">{actions}</div>}
        </>
      ) : (
        face
      )}
    </div>
  );
}
