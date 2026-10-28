import { useState, type FormEvent } from "react";
import { cutscenes } from "../../data/cutscenes";
import { useCutsceneAction } from "../../cutscenes/useCutsceneAction";
import { Modal } from "../Modal";

export function CreateCutsceneModal({ onClose, onCreated }: { onClose: () => void; onCreated: (id: number) => void }) {
  const run = useCutsceneAction(), [name, setName] = useState(""), [description, setDescription] = useState(""), [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault(); if (busy || !name.trim()) return;
    setBusy(true);
    try {
      const result = await run("Создать катсцену", () => cutscenes.create(name, description));
      if (result) onCreated(result.id);
    } finally { setBusy(false); }
  }
  return <Modal ariaLabel="Новая катсцена" onClose={() => { if (!busy) onClose(); }} closeOnBackdropClick={false}>
    <form className="stack cutscene-metadata" onSubmit={event => { void submit(event); }}>
      <h2>Новая катсцена</h2>
      <p>Общий оригинал для кампаний и сессий.</p>
      <label>Название<input required value={name} disabled={busy} onChange={event => setName(event.target.value)} /></label>
      <label>Описание<textarea rows={4} value={description} disabled={busy} onChange={event => setDescription(event.target.value)} /></label>
      <div className="cutscene-metadata__actions"><button type="button" disabled={busy} onClick={onClose}>Отмена</button>
        <button type="submit" className="primary" disabled={busy || !name.trim()}>{busy ? "Создание…" : "Создать"}</button></div>
    </form>
  </Modal>;
}
