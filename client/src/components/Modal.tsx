import { useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

interface Props {
  onClose: () => void;
  children: ReactNode;
  // Off by default (existing behavior) — set false for modals where an
  // accidental click outside would discard unsaved input (e.g. the @-mention
  // "create new entity" flow), forcing the user through an explicit button.
  closeOnBackdropClick?: boolean;
}

// Rendered via a portal into <body> so the modal never ends up nested inside
// a surrounding <label>/<form> — e.g. a <label> wrapping a file input would
// otherwise forward any click inside the modal (like a mouseup after
// dragging in an image cropper) to that input, silently reopening the file
// picker.
export function Modal({ onClose, children, closeOnBackdropClick = true }: Props) {
  // A "click" only means the mousedown AND mouseup landed on the same
  // element. Selecting text inside the modal and dragging past its edge
  // before releasing ends the drag over the backdrop — the browser then
  // fires click on the backdrop (their nearest common ancestor) even though
  // the user never intended to click it. Tracking where the press started
  // and only closing when it *also* started on the backdrop fixes that
  // without losing the real "click outside to close" behavior.
  const mouseDownOnBackdrop = useRef(false);
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
      <div className="modal">{children}</div>
    </div>,
    document.body
  );
}
