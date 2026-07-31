import { Modal } from "./Modal";

// Native confirm() only offers OK/Cancel — this adds a real third option
// ("Отмена" = keep editing, distinct from "Нет" = discard changes) for the
// edit-toggle "Сохранить изменения?" prompt. Delete confirmations stay on
// window.confirm() (a plain Да/Нет question fits it fine).
export function ConfirmDialog({
  message,
  onSave,
  onDiscard,
  onCancel,
}: {
  message: string;
  onSave: () => void;
  onDiscard: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal onClose={onCancel} closeOnBackdropClick={false}>
      <div className="stack">
        <p>{message}</p>
        <div className="row" style={{ justifyContent: "flex-end" }}>
          <button type="button" onClick={onCancel}>
            Отмена
          </button>
          <button type="button" onClick={onDiscard}>
            Нет
          </button>
          <button type="button" className="primary" onClick={onSave}>
            Да
          </button>
        </div>
      </div>
    </Modal>
  );
}
