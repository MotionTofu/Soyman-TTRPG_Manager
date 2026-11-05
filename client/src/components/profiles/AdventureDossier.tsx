import { useState } from "react";
import { plural } from "../../sceneKinds";
import type { StoryArcDetail } from "../../types";
import { ARC_PASSPORT_FIELDS, OUTCOME_FIELDS } from "../adventure/AdventureDossier";
import type { PaperField } from "../PaperFieldsCard";
import { Modal } from "../Modal";
import { MentionText } from "../mentions/MentionText";
import { MentionTextarea } from "../mentions/MentionTextarea";
import { ProfileBlock, ProfileText, ProfileTypeGlyph } from "./ProfileParts";

export function adventureFacts(arc: Pick<StoryArcDetail, "recommended_level" | "player_count" | "duration">) {
  const n = Number(arc.player_count);
  return [
    arc.recommended_level && `ур. ${arc.recommended_level}`,
    arc.player_count && (/игрок/i.test(arc.player_count) ? arc.player_count : `${arc.player_count} ${Number.isFinite(n) ? plural(n, "игрок", "игрока", "игроков") : "игроков"}`),
    arc.duration && (/^\d+(?:[.,]\d+)?$/.test(arc.duration.trim()) ? `${arc.duration} ч` : arc.duration),
  ].filter(Boolean) as string[];
}

export function AdventureDescription({ arc, onSave }: { arc: StoryArcDetail; onSave: (patch: Record<string, unknown>) => Promise<void> }) {
  return <ProfileText title="Описание" value={arc.description} onSave={(v) => onSave({ description: v })} defaultSettingId={arc.setting_id}
    fields={[{ key: "promise", label: "Обещание", value: arc.passport?.promise ?? "" }]}
    onSaveFields={(v) => onSave({ passport: { ...arc.passport, promise: v.promise } })}>
    {arc.passport?.promise && <p className="profile-prose"><strong>Обещание.</strong> <MentionText text={arc.passport.promise} /></p>}
  </ProfileText>;
}

const PASSPORT: readonly PaperField[] = [{ key: "central_question", label: "Центральный вопрос" }, ...ARC_PASSPORT_FIELDS];
const MAIN_PASSPORT = new Set(["central_question", "theme_question", "genre", "scale", "tone", "not_this"]);

export function AdventurePassport({ arc, onSave }: { arc: StoryArcDetail; onSave: (patch: Record<string, unknown>) => Promise<void> }) {
  return <JsonFields title="Паспорт" fields={PASSPORT} values={arc.passport ?? {}} mainKeys={MAIN_PASSPORT} empty="Опишите вопросы игры, жанр, масштаб и тон." addLabel="+ Паспорт" settingId={arc.setting_id} onSave={(passport) => onSave({ passport })} />;
}
export function AdventureOutcomes({ arc, onSave }: { arc: StoryArcDetail; onSave: (patch: Record<string, unknown>) => Promise<void> }) {
  return <JsonFields title="Исходы" fields={OUTCOME_FIELDS} values={arc.outcomes ?? {}} empty="Чем может кончиться приключение — для кампании." addLabel="+ Исход" settingId={arc.setting_id} onSave={(outcomes) => onSave({ outcomes })} />;
}

function JsonFields({ title, fields, values, empty, addLabel, onSave, mainKeys, settingId }: {
  title: string; fields: readonly PaperField[]; values: Record<string, string>; empty: string; addLabel: string;
  onSave: (values: Record<string, string>) => Promise<void>; mainKeys?: Set<string>; settingId: number;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const filled = fields.filter((f) => values[f.key]?.trim());
  const main = filled.filter((f) => !mainKeys || mainKeys.has(f.key));
  const extra = filled.filter((f) => mainKeys && !mainKeys.has(f.key));
  const start = () => { setDraft(Object.fromEntries(fields.map((f) => [f.key, values[f.key] ?? ""]))); setError(""); setEditing(true); };
  const save = async () => { setSaving(true); try { await onSave({ ...values, ...draft }); setEditing(false); } catch (e) { setError(e instanceof Error ? e.message : "Не сохранилось"); } finally { setSaving(false); } };
  const grid = (list: readonly PaperField[]) => <dl className="adventure-profile-json">{list.map((f) => <div key={f.key} className={f.key === "central_question" || f.key === "theme_question" ? "is-wide" : undefined}><dt>{f.label}</dt><dd><MentionText text={values[f.key]} /></dd></div>)}</dl>;
  return <ProfileBlock title={title} actions={!editing && filled.length > 0 && <button className="d-btn d-btn--sm d-btn--ghost" onClick={start}>Править</button>}>
    {editing ? <div className="stack"><div className="profile-columns">{fields.map((f) => <label className="stack" key={f.key}><span className="d-mono">{f.label}</span><MentionTextarea rows={2} value={draft[f.key] ?? ""} onChange={(v) => setDraft((d) => ({ ...d, [f.key]: v }))} defaultSettingId={settingId} /></label>)}</div>{error && <p role="alert">{error}</p>}<div className="row"><button className="d-btn" disabled={saving} onClick={save}>Сохранить</button><button className="d-btn d-btn--ghost" disabled={saving} onClick={() => setEditing(false)}>Отмена</button></div></div> : filled.length ? <>{grid(main)}{extra.length > 0 && <details className="adventure-profile-more"><summary>Ещё: {extra.map((f) => f.label.toLocaleLowerCase()).join(" · ")}</summary>{grid(extra)}</details>}</> : <div className="profile-invitation"><ProfileTypeGlyph type="adventure" /><span>{empty}</span><button className="d-btn d-btn--sm" onClick={start}>{addLabel}</button></div>}
  </ProfileBlock>;
}

export function AdventureMetadataEditor({ arc, onSave, onClose }: { arc: StoryArcDetail; onSave: (patch: Record<string, unknown>) => Promise<void>; onClose: () => void }) {
  const fields = [{ key: "name", label: "Имя" }, { key: "recommended_level", label: "Уровень персонажей" }, { key: "player_count", label: "Число игроков" }, { key: "duration", label: "Длительность" }, { key: "source", label: "Источник" }] as const;
  const [draft, setDraft] = useState(Object.fromEntries(fields.map((f) => [f.key, arc[f.key] ?? ""])));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  async function submit() { setSaving(true); try { await onSave(Object.fromEntries(Object.entries(draft).filter(([key]) => key !== "name" || arc.is_default !== 1))); onClose(); } catch (e) { setError(e instanceof Error ? e.message : "Не сохранилось"); } finally { setSaving(false); } }
  return <Modal ariaLabel="Редактировать приключение" onClose={() => !saving && onClose()}><div className="stack"><h2>Редактировать приключение</h2>{fields.filter((f) => f.key !== "name" || arc.is_default !== 1).map((f) => <label className="stack" key={f.key}>{f.label}<input value={draft[f.key]} onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })} /></label>)}{error && <p role="alert">{error}</p>}<button className="d-btn" disabled={saving || !draft.name.trim()} onClick={submit}>Сохранить</button></div></Modal>;
}
