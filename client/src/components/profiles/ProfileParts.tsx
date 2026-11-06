import { useState, type ComponentProps, type CSSProperties, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { TYPE_COLORS } from "../../graphTypes";
import { DETAIL_ROUTES } from "../../entityTypes";
import { TypeGlyph } from "../TypeGlyph";
import { NavIcon } from "../NavIcons";
import { MentionText } from "../mentions/MentionText";
import { MentionTextarea } from "../mentions/MentionTextarea";
import { EditableTextCard } from "../EditableTextCard";
import { EntityFieldInputs, toFieldValues } from "../EntityFieldsCard";
import type { TimeTone } from "../chronicle/time";
import "./profiles.css";

const LABELS: Record<string, string> = { being: "Существо", location: "Место", community: "Сообщество", artifact: "Предмет", setting_event: "Событие", campaign_event: "Событие", scene: "Сцена", adventure: "Приключение" };

/** У события нет собственного цвета: те же переменные, что у точки Хроники. */
export function profileColor(type: string, tone: TimeTone = "past") {
  return type === "compendium_entry" ? "var(--compendium)" : type === "adventure" ? "var(--type-adventure)" : type.endsWith("_event") ? `var(--t-${tone})` : TYPE_COLORS[type] ?? "var(--ink)";
}

export function profileStyle(type: string, tone?: TimeTone): CSSProperties {
  return { "--profile-type": profileColor(type, tone) } as CSSProperties;
}

export function ProfileTypeLabel({ type, label }: { type: string; label?: string }) {
  return <span className="profile-type-label">{label ?? LABELS[type] ?? type}</span>;
}

export function ProfileTypeGlyph({ type }: { type:string }) {
  return <TypeGlyph type={type === "campaign_event" ? "setting_event" : type} />;
}

export function ProfileHero({ type, typeLabel, name, subtype, createdAt, labels, image, onGallery, coverLabel, cover, children }: {
  type: string; name: string; subtype?: ReactNode; createdAt?: string; labels?: ReactNode;
  image?: string | null; onGallery?: () => void; coverLabel?: string; children?: ReactNode;
  /** Карта ДнД и существующее превью чертежа в том же герое профиля. */
  typeLabel?: string; cover?: ReactNode;
}) {
  const date = createdAt?.slice(0, 10).split("-").reverse().join(".");
  return <section className={`profile-hero profile-hero--${type}`}>
    <div className="profile-hero__main">
      <div className="profile-passport"><ProfileTypeGlyph type={type} /><ProfileTypeLabel type={type} label={typeLabel} />{subtype && <span>{subtype}</span>}{date && <span>С {date}</span>}</div>
      <h1 className="profile-title">{name}</h1>
      {labels && <div className="profile-labels">{labels}</div>}
      {children}
    </div>
    {cover ?? <button type="button" className={`profile-cover${image ? "" : " profile-cover--ph"}`} onClick={onGallery} aria-label={coverLabel ?? (onGallery ? (type.endsWith("_event") ? "Сменить картинку события" : "Открыть галерею") : "Картинка не задана")} disabled={!onGallery}>
      {image ? <img src={image} alt={name} /> : <ProfileTypeGlyph type={type} />}
      {onGallery && !coverLabel && !type.endsWith("_event") && <span className="profile-cover__from">Из галереи</span>}
      <span className="profile-cover__caption">{coverLabel ?? (type.endsWith("_event") ? "Картинка события · щелчок — сменить" : <>{type === "being" ? "Портрет" : "Картинка"}{onGallery ? " · открыть галерею" : " · не задана"}</>)}</span>
    </button>}
  </section>;
}

export function ProfileBlock({ title, count, actions, children, focal = false }: { title: string; count?: number; actions?: ReactNode; children: ReactNode; focal?: boolean }) {
  return <section className={focal ? "d-focal profile-block" : "d-block profile-block"}>
    <div className="profile-block__head"><h2 className="d-plate">{title}</h2>{count !== undefined && <span className="d-note">{count}</span>}<div className="profile-block__actions">{actions}</div></div>
    {children}
  </section>;
}

/** Только профили Мастера: общий EditableTextCard и вид игрока остаются прежними. */
export function ProfileText({ title, value, onSave, emptyLabel, help, rows = 5, defaultSettingId, children, fields, onSaveFields, focal = false }: ComponentProps<typeof EditableTextCard> & { focal?: boolean }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [values, setValues] = useState(() => toFieldValues(fields ?? []));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const start = () => { setDraft(value); setValues(toFieldValues(fields ?? [])); setError(""); setEditing(true); };
  async function save() {
    setSaving(true); setError("");
    try { if (onSaveFields) await onSaveFields(values); await onSave(draft); setEditing(false); }
    catch (e) { setError(e instanceof Error ? e.message : "Не сохранилось"); }
    finally { setSaving(false); }
  }
  return <ProfileBlock title={title} focal={focal} actions={!editing && !!value && <button type="button" className="d-btn d-btn--sm d-btn--ghost" onClick={start}>Править</button>}>
    {editing ? <div className="stack">
      {help && <span className="muted">{help}</span>}
      {!!fields?.length && <EntityFieldInputs fields={fields} values={values} onChange={(key, v) => setValues((prev) => ({ ...prev, [key]: v }))} />}
      <MentionTextarea value={draft} onChange={setDraft} rows={rows} defaultSettingId={defaultSettingId} />
      {error && <span role="alert">{error}</span>}
      <div className="row"><button type="button" className="d-btn" onClick={save} disabled={saving}>Сохранить</button><button type="button" className="d-btn d-btn--ghost" onClick={() => setEditing(false)} disabled={saving}>Отмена</button></div>
    </div> : value ? <div className="profile-prose"><MentionText text={value} /></div> : <div className="profile-invitation"><NavIcon name="edit" /><span>{emptyLabel ?? `Добавьте ${title.toLocaleLowerCase()}.`}</span><button type="button" className="d-btn d-btn--sm" onClick={start}>+ {title}</button></div>}
    {children}
  </ProfileBlock>;
}

export function ProfileEntityLink({ type, id, name, to }: { type: string; id: number; name: string; to?: string }) {
  return <Link className="profile-entity-link" style={profileStyle(type)} to={to ?? `${DETAIL_ROUTES[type] ?? `/${type}`}/${id}`}><span>{name}</span></Link>;
}

/** Основа профиля в контексте кампании читается без редакторов. */
export function ProfileChapterRead({ chapters }: { chapters:{id:number;title:string;content:string}[] }) {
  return chapters.length ? <div className="stack">{chapters.map((c) => <article key={c.id}>{c.title && <h3>{c.title}</h3>}<MentionText text={c.content} /></article>)}</div> : <p className="muted">Статей пока нет.</p>;
}
