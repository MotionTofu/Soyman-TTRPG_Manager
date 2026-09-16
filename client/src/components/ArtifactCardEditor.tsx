import { useEffect, useState } from "react";
import { useAction, useResource, write } from "../data/hooks";
import { ArtifactCard } from "./ArtifactCard";
import type { ArtifactCardPayload } from "../types";

// Вкладка «Карточка предмета» — единственное место, где карточка правится.
// Аналог CreatureCardEditor, но проще: нет ролей и тактики.

export function ArtifactCardEditor({ id }: { id: number }) {
  const card = useResource<ArtifactCardPayload>(`/artifacts/${id}/card`);
  const data: ArtifactCardPayload | null | undefined = card.data ?? (card.error ? null : undefined);
  const run = useAction();
  const [description, setDescription] = useState("");
  const [secret, setSecret] = useState("");
  const [history, setHistory] = useState("");
  const [power, setPower] = useState("");
  const [saving, setSaving] = useState(false);

  // Поля заполняются из карточки, пока Мастер их не тронул: пришедшее извне
  // (правка «Секрета» в «Досье», другое окно) набранное не затирает
  // (docs/adr/0001, п. 5).
  const [seed, setSeed] = useState<ArtifactCardPayload | null>(null);
  useEffect(() => {
    if (!card.data || card.data === seed) return;
    const untouched =
      !seed ||
      (description === seed.description && secret === seed.secret && history === seed.history && power === seed.power);
    setSeed(card.data);
    if (!untouched) return;
    setDescription(card.data.description);
    setSecret(card.data.secret);
    setHistory(card.data.history);
    setPower(card.data.power);
  }, [card.data, seed, description, secret, history, power]);

  async function save() {
    if (!data) return;
    setSaving(true);
    const body = { description, secret, history, power };
    try {
      await run(() => write.put(`/artifacts/${id}`, body), { affects: [{ kind: "artifact", id }] });
    } finally {
      setSaving(false);
    }
  }

  if (data === undefined) return <span className="muted">Загрузка…</span>;
  if (data === null) return <span className="muted">Не найдено.</span>;

  return (
    <div className="creature-card-editor">
      <div className="card stack">
        <span className="editable-card-field-label">Секрет</span>
        <span className="muted">Тайна мастера, скрытая от игроков.</span>
        <textarea rows={3} value={secret} onChange={(e) => setSecret(e.target.value)} />

        <span className="editable-card-field-label">Описание</span>
        <span className="muted">То же поле, что «Короткое описание» во вкладке «Досье».</span>
        <textarea rows={4} value={description} onChange={(e) => setDescription(e.target.value)} />

        <span className="editable-card-field-label">История</span>
        <textarea rows={4} value={history} onChange={(e) => setHistory(e.target.value)} />

        <span className="editable-card-field-label">Сила / свойства</span>
        <textarea rows={4} value={power} onChange={(e) => setPower(e.target.value)} />

        <div className="row">
          <button type="button" onClick={save} disabled={saving}>
            {saving ? "Сохраняю…" : "Сохранить"}
          </button>
        </div>
      </div>

      <div className="creature-card-editor__preview">
        <span className="editable-card-field-label">Как выглядит</span>
        <ArtifactCard data={data} variant="page" hideProfileButton />
      </div>
    </div>
  );
}
