import { useCallback, useEffect, useRef, useState } from "react";
import { Modal } from "../components/Modal";

interface ConfirmOptions {
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  /**
   * Сообщение, а не вопрос: одна кнопка, отказываться не от чего.
   *
   * Итог загрузки приключения («обновлено 3, добавлено 1, копия в архиве») и
   * сообщение об ошибке — это отчёт. Вторая кнопка рядом с ним читается как
   * выбор, которого нет.
   */
  hideCancel?: boolean;
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
          {!pending.opts.hideCancel && (
            <button onClick={() => onClose(false)}>{pending.opts.cancelLabel ?? "Отмена"}</button>
          )}
          <button className={pending.opts.danger ? "danger" : "primary"} onClick={() => onClose(true)}>
            {pending.opts.confirmLabel ?? "Подтвердить"}
          </button>
        </div>
      </div>
    </Modal>
  ) : null;

  return [dialog, confirm] as const;
}

interface PromptOptions {
  title?: string;
  message: string;
  defaultValue?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  placeholder?: string;
  /** Показать текст только для копирования: поле только для чтения, одна кнопка. */
  readOnly?: boolean;
}

/**
 * Ввод строки — замена браузерному `prompt()`.
 *
 * Нативное окно блокирует весь процесс, не следует теме приложения и в части
 * окружений просто не работает (в `CanvasPage` из-за этого имя доски давно
 * правится строкой на месте). Здесь то же самое, но своим диалогом: Enter
 * подтверждает, Esc отменяет, текст выделен сразу — значит переименование
 * это «открыл, напечатал, Enter», без возни с выделением.
 *
 * Возвращает введённую строку или `null`, если Мастер отказался, — как
 * нативный `prompt`, чтобы вызывающий код не пришлось переписывать.
 */
export function usePrompt() {
  const [pending, setPending] = useState<{
    opts: PromptOptions;
    resolve: (v: string | null) => void;
  } | null>(null);
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const prompt = useCallback((opts: PromptOptions | string, defaultValue?: string) => {
    const normalized: PromptOptions =
      typeof opts === "string" ? { message: opts, defaultValue } : opts;
    setValue(normalized.defaultValue ?? "");
    return new Promise<string | null>((resolve) => {
      setPending({ opts: normalized, resolve });
    });
  }, []);

  // Текст выделяется целиком: при переименовании старое имя чаще заменяют, а
  // не дописывают к нему.
  useEffect(() => {
    if (!pending) return;
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    el.select();
  }, [pending]);

  const finish = useCallback(
    (result: string | null) => {
      pending?.resolve(result);
      setPending(null);
    },
    [pending]
  );

  const dialog = pending ? (
    <Modal onClose={() => finish(null)}>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          finish(pending.opts.readOnly ? null : value);
        }}
      >
        {pending.opts.title && <h3 style={{ margin: 0 }}>{pending.opts.title}</h3>}
        <label className="stack" style={{ gap: 4 }}>
          <span style={{ whiteSpace: "pre-wrap" }}>{pending.opts.message}</span>
          <input
            ref={inputRef}
            value={value}
            readOnly={pending.opts.readOnly}
            placeholder={pending.opts.placeholder}
            onChange={(e) => setValue(e.target.value)}
          />
        </label>
        <div className="row" style={{ justifyContent: "flex-end", gap: 8 }}>
          <button type="button" onClick={() => finish(null)}>
            {pending.opts.cancelLabel ?? (pending.opts.readOnly ? "Закрыть" : "Отмена")}
          </button>
          {!pending.opts.readOnly && (
            <button type="submit" className="primary">
              {pending.opts.confirmLabel ?? "Сохранить"}
            </button>
          )}
        </div>
      </form>
    </Modal>
  ) : null;

  return [dialog, prompt] as const;
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
