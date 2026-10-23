import { useState, type ReactNode } from "react";
import { MentionText } from "./mentions/MentionText";
import { MentionTextarea } from "./mentions/MentionTextarea";
import { plural } from "../sceneKinds";

// Карточка «подпись — значение» на бумаге: досье приключения (доска 36) и
// «В кампании» досье персонажа (доска 37).

export type PaperField = { key: string; label: string; hint?: string };

/**
 * Карточка «подпись — значение» с правкой на месте: та же рамка, что у
 * «За столом» существа и предмета. Пустые значения в просмотре не видны.
 */
export function PaperFieldsCard({
  label,
  fields,
  values,
  onSave,
  empty,
  children,
  strong,
  showGrid = true,
  rows,
  mentionSettingId,
  externalHeading = false,
}: {
  label: string;
  fields: readonly PaperField[];
  values: Record<string, string>;
  onSave: (next: Record<string, string>) => Promise<void>;
  empty: string;
  children?: ReactNode;
  /** Главный блок листа — толще обведён (доска 36). */
  strong?: boolean;
  /** Просмотр рисует сам вызывающий (children) — сетку полей не показывать. */
  showGrid?: boolean;
  /**
   * Паспорт кампании (доска 41): поля строками «подпись — значение», с
   * упоминаниями и абзацами; незаполненные — счётом «Пусто N полей».
   */
  rows?: boolean;
  /** Упоминания в полях: «@» в правке открывает выбор, просмотр — ссылками. */
  mentionSettingId?: number | null;
  externalHeading?: boolean;
}) {
  const mentions = mentionSettingId !== undefined;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const filled = fields.filter((f) => values[f.key]?.trim());

  function start() {
    setDraft(Object.fromEntries(fields.map((f) => [f.key, values[f.key] ?? ""])));
    setEditing(true);
  }
  async function submit() {
    setSaving(true);
    try {
      await onSave(draft);
      setEditing(false);
    } catch {
      // Плашку показал слой; набранное остаётся.
    } finally {
      setSaving(false);
    }
  }

  if (editing) {
    return (
      <>
      {externalHeading && <h2 className="campaign-passport__heading">{label}</h2>}
      <div className="creature-card-editor is-inline">
        <div className="card stack">
          {!externalHeading && <span className="editable-card-field-label">{label}</span>}
          <div className="scene-head__grid">
            {fields.map((f) => (
              <label key={f.key} className="stack editable-card-field">
                <span>{f.label}{externalHeading ? ":" : ""}</span>
                {mentions ? (
                  <MentionTextarea
                    rows={2}
                    value={draft[f.key] ?? ""}
                    placeholder={f.hint}
                    defaultSettingId={mentionSettingId ?? undefined}
                    onChange={(v) => setDraft((d) => ({ ...d, [f.key]: v }))}
                  />
                ) : (
                  <textarea
                    rows={2}
                    value={draft[f.key] ?? ""}
                    placeholder={f.hint}
                    onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })}
                  />
                )}
              </label>
            ))}
          </div>
          <div className="row">
            <button type="button" className="primary" onClick={submit} disabled={saving}>
              Сохранить
            </button>
            <button type="button" onClick={() => setEditing(false)} disabled={saving}>
              Отмена
            </button>
          </div>
        </div>
      </div>
      </>
    );
  }

  return (
    <>
    {externalHeading && (
      <header className="campaign-passport__head">
        <h2 className="campaign-passport__heading">{label}</h2>
        <button type="button" className="creature-card__edit" onClick={start}>Править</button>
      </header>
    )}
    <article className={`creature-card paper-scope creature-card--page is-embedded${strong ? "" : " is-quiet"}`}>
      {!externalHeading && <div className="creature-card__head">
        <span className="creature-card__head-label">{label}</span>
        <button type="button" className="creature-card__edit" onClick={start}>
          Править
        </button>
      </div>}
      {children}
      {rows && showGrid ? (
        <>
          {filled.length > 0 && (
            <dl className="paper-fields-rows">
              {filled.map((f) => (
                <div key={f.key}>
                  <dt className="creature-card__head-label">{f.label}{externalHeading ? ":" : ""}</dt>
                  <dd>{mentions ? <MentionText text={values[f.key]} /> : values[f.key]}</dd>
                </div>
              ))}
            </dl>
          )}
          {filled.length < fields.length && (
            filled.length === 0 ? (
              <div className="creature-card__empty">
                {empty}{" "}
                <button type="button" className="creature-card__more" onClick={start}>
                  Заполнить
                </button>
              </div>
            ) : (
              // Счёт, а не перечень (гриллинг 2026-10-23, Q5): дюжина названий
              // пустых полей мелким шрифтом — шум; сами названия — в подсказке.
              <button
                type="button"
                className="creature-card__more paper-fields-missing"
                onClick={start}
                title={fields.filter((f) => !values[f.key]?.trim()).map((f) => f.label).join(", ")}
              >
                Пусто {fields.length - filled.length} {plural(fields.length - filled.length, "поле", "поля", "полей")} — заполнить ›
              </button>
            )
          )}
        </>
      ) : !showGrid ? null : filled.length > 0 ? (
        <dl className="scene-head__grid">
          {filled.map((f) => (
            <div key={f.key}>
              <dt className="creature-card__head-label">{f.label}</dt>
              <dd>{values[f.key]}</dd>
            </div>
          ))}
        </dl>
      ) : (
        !children && (
          <div className="creature-card__empty">
            {empty}{" "}
            <button type="button" className="creature-card__more" onClick={start}>
              Заполнить
            </button>
          </div>
        )
      )}
    </article>
    </>
  );
}
