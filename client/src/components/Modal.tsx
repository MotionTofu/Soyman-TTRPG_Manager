import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

interface Props {
  onClose: () => void;
  children: ReactNode;
  // Off by default (existing behavior) — set false for modals where an
  // accidental click outside would discard unsaved input (e.g. the @-mention
  // "create new entity" flow), forcing the user through an explicit button.
  closeOnBackdropClick?: boolean;
  // Подбор пачкой с телефона (этап 6): широкое окно вместо 420px —
  // спискам нужно место, а мишеням ширина.
  wide?: boolean;
  // Имя диалога для AT (role=dialog без имени — безымянный для скринридера).
  ariaLabel?: string;
  // Куда встаёт фокус при открытии. По умолчанию — на первый интерактив
  // внутри окна. false — на само окно: у модалки хитов первым интерактивом
  // идёт цифра пада, и скринридер объявлял «кнопка 1» вместо имени диалога.
  autoFocus?: boolean;
  // Дополнительный класс на само окно (не на затемнение): размерные
  // варианты вроде модалки состояний, которой на мобиле нужен весь экран.
  className?: string;
}

// Стек открытых модалок: вложенная (кроп портрета внутри визарда) тоже
// <Modal>. Обе подписки висят на document, и stopPropagation соседних
// слушателей на том же узле не останавливает — без стека ESC при открытом
// кропе дёргал confirm закрытия всего визарда раньше onCancel кропа.
const modalStack: (() => void)[] = [];

// Rendered via a portal into <body> so the modal never ends up nested inside
// a surrounding <label>/<form> — e.g. a <label> wrapping a file input would
// otherwise forward any click inside the modal (like a mouseup after
// dragging in an image cropper) to that input, silently reopening the file
// picker.
export function Modal({ onClose, children, closeOnBackdropClick = true, wide, ariaLabel, autoFocus = true, className }: Props) {
  // A "click" only means the mousedown AND mouseup landed on the same
  // element. Selecting text inside the modal and dragging past its edge
  // before releasing ends the drag over the backdrop — the browser then
  // fires click on the backdrop (their nearest common ancestor) even though
  // the user never intended to click it. Tracking where the press started
  // and only closing when it *also* started on the backdrop fixes that
  // without losing the real "click outside to close" behavior.
  const mouseDownOnBackdrop = useRef(false);
  const modalRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    // Фокус на первый интерактив внутри модалки только при монтировании — иначе каждый ререндер (набор текста) прыгал бы на первое поле
    const getFocusable = () =>
      modalRef.current?.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
    const first = autoFocus ? getFocusable()?.[0] : undefined;
    if (first) first.focus();
    else modalRef.current?.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        // Отвечает только верхняя модалка стека: нижняя молчит.
        if (modalStack[modalStack.length - 1] !== closeTop) return;
        e.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (e.key !== "Tab" || !modalRef.current) return;
      const focusable = getFocusable();
      if (!focusable || focusable.length === 0) return;
      const list = Array.from(focusable).filter((el) => !el.hasAttribute("disabled") && el.tabIndex !== -1 && (el as HTMLElement).offsetParent !== null);
      if (list.length === 0) return;
      const firstEl = list[0];
      const lastEl = list[list.length - 1];
      if (e.shiftKey) {
        if (document.activeElement === firstEl) {
          e.preventDefault();
          lastEl.focus();
        }
      } else {
        if (document.activeElement === lastEl) {
          e.preventDefault();
          firstEl.focus();
        }
      }
    };
    const closeTop = () => onCloseRef.current();
    modalStack.push(closeTop);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      const i = modalStack.indexOf(closeTop);
      if (i >= 0) modalStack.splice(i, 1);
      // Возврат фокуса на триггер
      prev?.focus?.();
    };
  }, []);

  return createPortal(
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        mouseDownOnBackdrop.current = e.target === e.currentTarget;
      }}
      onClick={(e) => {
        if (closeOnBackdropClick && e.target === e.currentTarget && mouseDownOnBackdrop.current) {
          onClose();
        }
        mouseDownOnBackdrop.current = false;
      }}
    >
      <div className={`modal${wide ? " modal-wide" : ""}${className ? ` ${className}` : ""}`} ref={modalRef} role="dialog" aria-modal="true" aria-label={ariaLabel} tabIndex={-1}>
        {children}
      </div>
    </div>,
    document.body
  );
}
