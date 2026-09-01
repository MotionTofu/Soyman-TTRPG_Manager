import { useEffect, useState } from "react";
import { api } from "../api/client";
import { ArtifactCard, type ArtifactCardPayload } from "./ArtifactCard";

// Вкладка «Карточка предмета» — единственное место, где карточка правится.
// Аналог CreatureCardEditor, но проще: нет ролей и тактики.

export function ArtifactCardEditor({
  id,
  onChange,
}: {
  id: number;
  onChange?: () => void;
}) {
  const [data, setData] = useState<ArtifactCardPayload | null | undefined>(undefined);
  const [description, setDescription] = useState("");
  const [secret, setSecret] = useState("");
  const [history, setHistory] = useState("");
  const [power, setPower] = useState("");
  const [saving, setSaving] = useState(false);

  const load = () => {
    api
      .get<ArtifactCardPayload>(`/artifacts/${id}/card`)
      .then((d) => {
        setData(d);
        setDescription(d.description);
        setSecret(d.secret);
        setHistory(d.history);
        setPower(d.power);
      })
      .catch(() => setData(null));
  };
  useEffect(load, [id]);

  async function save() {
    if (!data) return;
    setSaving(true);
    try {
      await api.put(`/artifacts/${id}`, {
        description,
        secret,
        history,
        power,
      });
      load();
      onChange?.();
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
