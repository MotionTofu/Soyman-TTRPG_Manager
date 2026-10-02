import { useState } from "react";
import { Link } from "react-router-dom";
import { ForceBlock, SecretSeal } from "./CreatureCard";
import { MentionTextarea } from "./mentions/MentionTextarea";
import { FORCE_FIELDS, hasForce } from "../beingForce";
import { mentionTone } from "../mentions";
import type { BeingForce } from "../types";

// «Карточка фракции» — шапка досье сообщества (разбор 2026-10-02): тот же
// двигатель силы, что у существа, «Лица» и секрет за сургучом. Просмотр и
// правка — одна карточка, как у существа (Q8).

const SHOWN_FACES = 4;

export function FactionCard({
  force,
  secret,
  members,
  settingId,
  onSave,
  onAllMembers,
}: {
  force: BeingForce;
  secret: string;
  members: { id: number; name: string }[];
  settingId: number;
  onSave: (patch: { force: BeingForce; secret: string }) => Promise<boolean>;
  onAllMembers: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<BeingForce>({});
  const [secretDraft, setSecretDraft] = useState("");
  const [showExtra, setShowExtra] = useState(false);
  const [saving, setSaving] = useState(false);

  function startEdit() {
    setDraft(force);
    setSecretDraft(secret);
    setShowExtra(false);
    setEditing(true);
  }

  async function save() {
    setSaving(true);
    try {
      if (await onSave({ force: draft, secret: secretDraft })) setEditing(false);
    } finally {
      setSaving(false);
    }
  }

  if (editing) {
    const fields = FORCE_FIELDS.filter((f) => f.core || showExtra || draft[f.key]);
    return (
      <div className="creature-card-editor is-inline">
        <div className="card stack">
          <div className="creature-card-editor__force">
            {fields.map((f) => (
              <label key={f.key} className="stack creature-card-editor__force-field">
                <span className="editable-card-field-label">{f.label}</span>
                <MentionTextarea
                  value={draft[f.key] ?? ""}
                  onChange={(v) => setDraft((prev) => ({ ...prev, [f.key]: v }))}
                  rows={2}
                  autoGrow
                  defaultSettingId={settingId}
                />
              </label>
            ))}
            {!showExtra && FORCE_FIELDS.some((f) => !f.core && !draft[f.key]) && (
              <button type="button" className="comp-mini" onClick={() => setShowExtra(true)}>
                + Средства, интерес, позиция, под давлением
              </button>
            )}
          </div>
          <span className="editable-card-field-label">Секрет</span>
          <textarea rows={3} value={secretDraft} onChange={(e) => setSecretDraft(e.target.value)} />
          <div className="row">
            <button type="button" className="primary" onClick={save} disabled={saving}>
              {saving ? "Сохраняю…" : "Сохранить"}
            </button>
            <button type="button" onClick={() => setEditing(false)} disabled={saving}>
              Отмена
            </button>
          </div>
        </div>
      </div>
    );
  }

  const faces = members.slice(0, SHOWN_FACES);
  return (
    <article className="creature-card paper-scope creature-card--page is-embedded">
      <div className="creature-card__head">
        <span className="creature-card__head-label">За столом</span>
        <button type="button" className="creature-card__edit" onClick={startEdit}>
          Править
        </button>
      </div>
      {hasForce(force) ? (
        <ForceBlock force={force} wide />
      ) : (
        <div className="creature-card__empty">
          Чего хотят, чего боятся — пока не записано.{" "}
          <button type="button" className="creature-card__more" onClick={startEdit}>
            Заполнить
          </button>
        </div>
      )}
      {members.length > 0 && (
        <div className="faction-card__faces">
          <span className="creature-card__head-label">Лица · {members.length}</span>{" "}
          {faces.map((m, i) => (
            <span key={m.id}>
              {i > 0 && ", "}
              <Link className={`mention-link mention--${mentionTone("being", m.id)}`} to={`/beings/${m.id}`}>
                {m.name}
              </Link>
            </span>
          ))}
          {members.length > faces.length && (
            <button type="button" className="creature-card__more" onClick={onAllMembers}>
              ещё {members.length - faces.length} ›
            </button>
          )}
        </div>
      )}
      {secret.trim() && <SecretSeal text={secret} />}
    </article>
  );
}
