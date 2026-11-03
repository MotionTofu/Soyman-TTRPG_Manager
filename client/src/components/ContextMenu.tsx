import { Fragment, useEffect, useRef, useState } from "react";
import { TypeGlyph } from "./TypeGlyph";

export interface ContextMenuItem {
  label: string;
  onClick?: () => void;
  danger?: boolean;
  /** Черта над пунктом — отделяет группу действий. */
  dividerBefore?: boolean;
  /** Горячая клавиша справа от подписи. */
  hint?: string;
  /** Подменю на один уровень (§6.12): на ПК — сбоку, по наведению или «→»;
   *  в шторке телефона — раскрывается на месте. Пункт с детьми свой onClick
   *  не вызывает. */
  children?: ContextMenuItem[];
}

interface Props {
  x: number;
  y: number;
  /** Шапка меню — не пункт, а подпись: чему принадлежат действия ниже. */
  title?: string;
  /** Тип сущности для знака в шапке (меню объекта, §6.12). */
  glyph?: string;
  /** Opt-in menu semantics for keyboard-operated action triggers. */
  ariaLabel?: string;
  items: ContextMenuItem[];
  /** Мелкая подсказка под пунктами (например, как вызвать меню браузера). */
  footer?: string;
  onClose: () => void;
}

// Телефон: меню — шторка снизу, пункты под палец (§6.12, Q7).
const COARSE = typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches;

function moveFocus(root: HTMLElement, step: number) {
  const buttons = Array.from(root.querySelectorAll<HTMLButtonElement>(":scope > button, :scope > .context-menu-group > button"));
  if (!buttons.length) return;
  const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
  buttons[(at + step + buttons.length) % buttons.length].focus();
}

export function ContextMenu({ x, y, title, glyph, ariaLabel, items, footer, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const subRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const [expanded, setExpanded] = useState<{ index: number; x: number; y: number } | null>(null);
  // Меню открывается там, где щёлкнули, и у правого-нижнего края уезжало за
  // экран: на 375 px меню плитки доски (180 px) от кнопки «⋯» на 304 px просто
  // обрезалось. Замер после монтирования, а не расчёт по числу пунктов.
  const [at, setAt] = useState({ x, y });
  useEffect(() => {
    const el = ref.current;
    if (!el || COARSE) return;
    const r = el.getBoundingClientRect();
    const pad = 8;
    const nx = Math.max(pad, Math.min(x, window.innerWidth - r.width - pad));
    const ny = Math.max(pad, Math.min(y, window.innerHeight - r.height - pad));
    setAt((prev) => (prev.x === nx && prev.y === ny ? prev : { x: nx, y: ny }));
  }, [x, y, items]);

  // Подменю прижимается к экрану так же; не влезает справа — встаёт слева.
  const [subAt, setSubAt] = useState<{ x: number; y: number } | null>(null);
  useEffect(() => {
    const el = subRef.current;
    if (!el || !expanded) return setSubAt(null);
    const r = el.getBoundingClientRect();
    const menu = ref.current!.getBoundingClientRect();
    const nx = expanded.x + r.width > window.innerWidth - 8 ? menu.left - r.width + 4 : expanded.x;
    const ny = Math.max(8, Math.min(expanded.y, window.innerHeight - r.height - 8));
    setSubAt({ x: nx, y: ny });
  }, [expanded]);

  // Фокус на первый пункт — чтобы стрелки, Enter и Esc работали сразу, и с
  // мыши, и после Menu / Shift+F10. Рамки обводки не будет: :focus-visible
  // после щелчка мышью не срабатывает. Один раз: onClose у вызывающих часто
  // новый на каждую отрисовку, и фокус прыгал бы наверх.
  useEffect(() => {
    if (!ref.current?.contains(document.activeElement)) {
      triggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    }
    (ref.current?.querySelector<HTMLElement>("button") ?? ref.current)?.focus();
  }, []);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        triggerRef.current?.focus({ preventScroll: true });
        onClose();
      }
    }
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [onClose]);

  function openSub(index: number, button: HTMLElement) {
    const r = button.getBoundingClientRect();
    setExpanded({ index, x: r.right - 4, y: r.top - 6 });
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    const inSub = subRef.current?.contains(document.activeElement) ?? false;
    const root = inSub ? subRef.current! : ref.current!;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      moveFocus(root, e.key === "ArrowDown" ? 1 : -1);
    } else if (e.key === "ArrowRight" && !inSub) {
      const button = document.activeElement as HTMLElement | null;
      const index = Number(button?.dataset.sub);
      if (button && Number.isInteger(index)) {
        e.preventDefault();
        openSub(index, button);
        requestAnimationFrame(() => subRef.current && moveFocus(subRef.current, 1));
      }
    } else if (e.key === "ArrowLeft" && inSub) {
      e.preventDefault();
      const index = expanded?.index;
      setExpanded(null);
      ref.current?.querySelector<HTMLElement>(`[data-sub="${index}"]`)?.focus();
    }
  }

  const role = ariaLabel ? "menuitem" : undefined;
  function leaf(item: ContextMenuItem, key: number, inSub = false) {
    return (
      <button
        role={role}
        key={key}
        className={`context-menu-item${item.danger ? " danger" : ""}`}
        onMouseEnter={COARSE || inSub ? undefined : () => setExpanded(null)}
        onClick={() => {
          item.onClick?.();
          onClose();
        }}
      >
        <span className="context-menu-label">{item.label}</span>
        {item.hint && <span className="context-menu-hint">{item.hint}</span>}
      </button>
    );
  }

  const open = expanded ? items[expanded.index] : null;
  return (
    <>
      {COARSE && <div className="context-menu-scrim" onMouseDown={onClose} />}
      <div
        ref={ref}
        tabIndex={-1}
        className={`context-menu${COARSE ? " context-menu--sheet" : ""}`}
        role={ariaLabel ? "menu" : undefined}
        aria-label={ariaLabel}
        onKeyDown={onKeyDown}
        // Наведение уводит фокус за собой — иначе подсвечены два пункта сразу.
        onMouseOver={(e) => (e.target as Element).closest("button")?.focus({ preventScroll: true })}
        onContextMenu={(e) => e.preventDefault()}
        style={COARSE ? undefined : { position: "fixed", left: at.x, top: at.y }}
      >
        {title && (
          <div className="context-menu-title">
            {glyph && <TypeGlyph type={glyph} />}
            <span>{title}</span>
          </div>
        )}
        {items.map((item, i) =>
          item.children ? (
            <Fragment key={i}>
              {item.dividerBefore && <hr className="context-menu-divider" />}
              <div className="context-menu-group">
                <button
                  role={role}
                  data-sub={i}
                  aria-haspopup="menu"
                  aria-expanded={expanded?.index === i}
                  className={`context-menu-item context-menu-group-toggle${expanded?.index === i ? " open" : ""}`}
                  onMouseEnter={COARSE ? undefined : (e) => openSub(i, e.currentTarget)}
                  onClick={(e) => (expanded?.index === i ? setExpanded(null) : openSub(i, e.currentTarget))}
                >
                  <span className="context-menu-label">{item.label}</span>
                  <span className="context-menu-hint">{COARSE && expanded?.index === i ? "▾" : "▸"}</span>
                </button>
                {COARSE && expanded?.index === i && (
                  <div className="context-menu-submenu">{item.children.map((c, j) => leaf(c, j, true))}</div>
                )}
              </div>
            </Fragment>
          ) : (
            <Fragment key={i}>
              {item.dividerBefore && <hr className="context-menu-divider" />}
              {leaf(item, i)}
            </Fragment>
          )
        )}
        {footer && <div className="context-menu-foot">{footer}</div>}
        {!COARSE && open?.children && (
          <div
            ref={subRef}
            className="context-menu context-menu--sub"
            role={ariaLabel ? "menu" : undefined}
            style={{ position: "fixed", left: (subAt ?? expanded!).x, top: (subAt ?? expanded!).y, visibility: subAt ? undefined : "hidden" }}
          >
            {open.children.map((c, j) => leaf(c, j, true))}
          </div>
        )}
      </div>
    </>
  );
}
