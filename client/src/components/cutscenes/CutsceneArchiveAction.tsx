import { useState } from "react";
import { cutscenes } from "../../data/cutscenes";
import { useCutsceneAction } from "../../cutscenes/useCutsceneAction";
import { Modal } from "../Modal";

export function CutsceneArchiveAction({ id, name, archived }: { id: number; name: string; archived: boolean }) {
  const run = useCutsceneAction();
  const [confirm, setConfirm] = useState(false), [busy, setBusy] = useState(false);
  async function apply() {
    setBusy(true);
    try {
      const saved = await run(archived ? "Восстановить катсцену" : "Архивировать катсцену", () => archived ? cutscenes.restore(id) : cutscenes.archive(id));
      if (saved) setConfirm(false);
    } finally { setBusy(false); }
  }
  return <>
    <button type="button" disabled={busy} onClick={() => archived ? void apply() : setConfirm(true)}>{archived ? "Восстановить" : "В архив"}</button>
    {confirm && <Modal onClose={() => { if (!busy) setConfirm(false); }}><div className="stack">
      <h2>В архив «{name}»?</h2>
      <p className="reading-text">Катсцена исчезнет из обычного каталога. Существующие подборки, планы, показы и медиа сохранятся. Её можно восстановить из архива.</p>
      <div className="row"><button type="button" disabled={busy} onClick={() => setConfirm(false)}>Отмена</button>
        <button type="button" disabled={busy} onClick={() => void apply()}>{busy ? "Сохраняется…" : "В архив"}</button></div>
    </div></Modal>}
  </>;
}
