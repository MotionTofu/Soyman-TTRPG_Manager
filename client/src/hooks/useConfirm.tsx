import { useCallback, useState } from "react";
import { Modal } from "../components/Modal";

interface ConfirmOptions {
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

export function useConfirm() {
  const [pending, setPending] = useState<{
    opts: ConfirmOptions;
    resolve: (v: boolean) => void;
  } | null>(null);

  const confirm = useCallback((opts: ConfirmOptions | string) => {
    const normalized: ConfirmOptions = typeof opts === "string" ? { message: opts } : opts;
    return new Promise<boolean>((resolve) => {
      setPending({ opts: normalized, resolve });
    });
  }, []);

  const onClose = useCallback(
    (result: boolean) => {
      pending?.resolve(result);
      setPending(null);
    },
    [pending]
  );

  const dialog = pending ? (
    <Modal onClose={() => onClose(false)}>
      <div className="stack">
        {pending.opts.title && <h3 style={{ margin: 0 }}>{pending.opts.title}</h3>}
        <p style={{ whiteSpace: "pre-wrap", margin: 0 }}>{pending.opts.message}</p>
        <div className="row" style={{ justifyContent: "flex-end", gap: 8 }}>
          <button onClick={() => onClose(false)}>{pending.opts.cancelLabel ?? "Отмена"}</button>
          <button className={pending.opts.danger ? "danger" : "primary"} onClick={() => onClose(true)}>
            {pending.opts.confirmLabel ?? "Подтвердить"}
          </button>
        </div>
      </div>
    </Modal>
  ) : null;

  return [dialog, confirm] as const;
}

export function useAlert() {
  const [msg, setMsg] = useState<string | null>(null);
  const alert = useCallback((message: string) => {
    setMsg(message);
  }, []);
  const dialog = msg ? (
    <Modal onClose={() => setMsg(null)}>
      <div className="stack">
        <p style={{ whiteSpace: "pre-wrap", margin: 0 }}>{msg}</p>
        <div className="row" style={{ justifyContent: "flex-end" }}>
          <button className="primary" onClick={() => setMsg(null)}>
            OK
          </button>
        </div>
      </div>
    </Modal>
  ) : null;
  return [dialog, alert] as const;
}
