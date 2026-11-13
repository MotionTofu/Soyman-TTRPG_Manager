import { useState } from "react";
import { legacyLimitSide, updateRibbonLimit } from "@shared/litm/compound";
import type { LitmLimitState } from "@shared/litm/conflict";
import { statusTier } from "@shared/litm/status";
import { Modal } from "../../Modal";
import type { ribbonLimitUpdates } from "../litmChallenge";

type Update = ReturnType<typeof ribbonLimitUpdates>[number];

export function LitmRibbonLimits({ name, updates, onClose, onApply }: {
  name: string;
  updates: Update[];
  onClose: () => void;
  onApply: (limits: { index: number; value: LitmLimitState }[]) => Promise<boolean>;
}) {
  const [sides, setSides] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);
  const sideOf = ({ index, old, next }: Update) => sides[index] ?? legacyLimitSide(old, next.sides ?? []) ?? "";
  const resolved = updates.flatMap(({ index, old, next }) => {
    const value = updateRibbonLimit(old, next, sideOf({ index, old, next }));
    return value ? [{ index, value }] : [];
  });

  async function submit() {
    if (busy || resolved.length !== updates.length) return;
    setBusy(true);
    try {
      if (await onApply(resolved)) onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal onClose={busy ? () => {} : onClose} ariaLabel="Обновить Пределы" className="lp-effect">
      <h2>Обновить Пределы</h2>
      <p>{name} · все отмеченные клетки сохранятся.</p>
      {updates.map((update) => {
        const { index, old, next } = update;
        return <div key={index} className="lp-give__row">
          <b>{old.name} ({old.max ?? "—"})</b>
          <span>{old.marks.length ? `Отметки ${old.marks.join(", ")} · уровень ${statusTier(old.marks)}` : "Без отметок"}</span>
          {!!next.sides?.length && !!old.marks.length && <label className="lp-give__name">
            Сторона Предела
            <select value={sideOf(update)} onChange={(e) => setSides((current) => ({ ...current, [index]: e.target.value }))}>
              <option value="">— выбрать по событиям сцены —</option>
              {next.sides.map((side) => <option key={side.status}>{side.status}</option>)}
            </select>
          </label>}
        </div>;
      })}
      <div className="modal-footer row">
        <button type="button" disabled={busy} onClick={onClose}>Отмена</button>
        <button type="button" className="primary" disabled={busy || resolved.length !== updates.length} onClick={() => void submit()}>Перенести отметки</button>
      </div>
    </Modal>
  );
}
