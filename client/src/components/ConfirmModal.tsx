import { Modal } from "./Modal";

interface ConfirmModalProps {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel?: string;
  danger?: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

export function ConfirmModal({
  title,
  message,
  confirmLabel,
  cancelLabel = "Отмена",
  danger = false,
  onClose,
  onConfirm,
}: ConfirmModalProps) {
  return (
    <Modal onClose={onClose} closeOnBackdropClick={false}>
      <div className="external-confirm">
        <div className="external-confirm__head" role="heading" aria-level={2}>
          <span>{title}</span>
        </div>
        <p className="external-confirm__text">{message}</p>
        <div className="external-confirm__actions">
          <button type="button" onClick={onClose}>
            {cancelLabel}
          </button>
          <button type="button" className={danger ? "danger" : "primary"} onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </Modal>
  );
}
