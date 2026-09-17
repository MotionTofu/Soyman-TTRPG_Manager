import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useResource } from "../../data/hooks";
import { settingPaths } from "../../data/settingEntities";
import { IMAGE_ACCEPT, IMAGE_HINT } from "../../imageUpload";
import { useImageCrop } from "../../hooks/useImageCrop";
import type { CropShape } from "../ImageCropModal";
import type { SettingLocation } from "../../types";

// Кирпичики шагов визарда. Все работают с черновиком, ничего не сохраняя:
// сущности ещё нет, запросы уходят одним пакетом после «Создать».

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="stack editable-card-field">
      <span>{label}</span>
      {children}
      {hint && <span className="muted image-hint">{hint}</span>}
    </label>
  );
}

export function TextField({
  label,
  value,
  onChange,
  placeholder,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  hint?: string;
}) {
  return (
    <Field label={label} hint={hint}>
      <input value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
    </Field>
  );
}

export function TextAreaField({
  label,
  value,
  onChange,
  rows = 3,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  rows?: number;
  placeholder?: string;
}) {
  return (
    <Field label={label}>
      <textarea rows={rows} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
    </Field>
  );
}

// Синонимы имени: по одному в строке — так же, как их хранит база (JSON-массив
// строк), и так же, как их правит AliasesCard в профиле.
export function AliasesField({
  label = "Альтернативные названия",
  aliases,
  nameOriginal,
  onChange,
}: {
  label?: string;
  aliases: string[];
  nameOriginal: string;
  onChange: (aliases: string[], nameOriginal: string) => void;
}) {
  return (
    <>
      <Field
        label={label}
        hint="По одному в строке. Ищутся наравне с основным названием — пригодится, когда книга зовёт сущность по-другому."
      >
        <textarea
          rows={3}
          value={aliases.join("\n")}
          onChange={(e) =>
            onChange(
              e.target.value.split("\n").map((a) => a.trim()).filter(Boolean),
              nameOriginal
            )
          }
        />
      </Field>
      <TextField
        label="Название в оригинале"
        value={nameOriginal}
        placeholder="Waterdeep"
        onChange={(v) => onChange(aliases, v)}
      />
    </>
  );
}

// Аватарка выбирается до создания сущности, поэтому файл лежит в черновике, а
// уходит на сервер уже после — когда есть id, куда его положить.
export function AvatarField({
  file,
  onChange,
  shape = "square",
}: {
  file: File | null;
  onChange: (file: File | null) => void;
  shape?: CropShape;
}) {
  const crop = useImageCrop(shape, (f) => onChange(f));
  const previewUrl = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
  useEffect(() => () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  return (
    <Field label="Аватарка" hint={IMAGE_HINT}>
      <div className="row" style={{ alignItems: "center" }}>
        {previewUrl && <img src={previewUrl} alt="" className="wizard-avatar-preview" />}
        <label className="character-avatar-upload">
          {file ? "Заменить" : "Выбрать изображение"}
          <input
            type="file"
            accept={IMAGE_ACCEPT}
            style={{ display: "none" }}
            onChange={(e) => crop.onSelect(e.target.files?.[0] ?? null)}
          />
        </label>
        {file && (
          <button type="button" onClick={() => onChange(null)}>
            Убрать
          </button>
        )}
        {crop.modal}
      </div>
    </Field>
  );
}

export interface PickOption {
  id: number;
  name: string;
  // Показывается серым справа — тип сущности или родительская локация.
  hint?: string;
}

// Выбор нескольких сущностей из готового списка: строка поиска и отмеченные
// пункты. Списки в сеттинге обозримые (сотни), поэтому фильтрация на месте, а
// не запросом на каждый символ.
export function MultiPickField({
  label,
  hint,
  options,
  selected,
  onChange,
  emptyLabel = "Нечего выбирать.",
}: {
  label: string;
  hint?: string;
  options: PickOption[];
  selected: number[];
  onChange: (ids: number[]) => void;
  emptyLabel?: string;
}) {
  const [query, setQuery] = useState("");
  const visible = query.trim()
    ? options.filter((o) => o.name.toLowerCase().includes(query.trim().toLowerCase()))
    : options;

  function toggle(id: number) {
    onChange(selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id]);
  }

  return (
    <div className="stack editable-card-field">
      <span>
        {label}
        {selected.length > 0 && <span className="muted"> — выбрано {selected.length}</span>}
      </span>
      {hint && <span className="muted image-hint">{hint}</span>}
      {options.length === 0 ? (
        <span className="muted">{emptyLabel}</span>
      ) : (
        <>
          <input placeholder="Поиск…" value={query} onChange={(e) => setQuery(e.target.value)} />
          <div className="wizard-pick-list">
            {visible.map((o) => (
              <label key={o.id} className="wizard-pick-row">
                <input type="checkbox" checked={selected.includes(o.id)} onChange={() => toggle(o.id)} />
                <span>{o.name}</span>
                {o.hint && <span className="muted">{o.hint}</span>}
              </label>
            ))}
            {visible.length === 0 && <span className="muted">Ничего не найдено.</span>}
          </div>
        </>
      )}
    </div>
  );
}

const NO_LOCATIONS: SettingLocation[] = [];

// Те же данные сеттинга нужны почти каждому шагу, поэтому загрузка живёт
// здесь, а не в каждом шаге отдельно.
export function useSettingOptions(settingId: number) {
  // Списки — под ключами слоя, теми же, что у страницы сеттинга: созданное
  // в соседнем шаге или окне появляется в выборе без перезагрузки визарда.
  const rawLocations = useResource<SettingLocation[]>(settingPaths.inSetting("location", settingId)).data ?? NO_LOCATIONS;
  const beingRows = useResource<{ id: number; name: string; category: string }[]>(settingPaths.inSetting("being", settingId)).data;
  const communityRows = useResource<{ id: number; name: string }[]>(settingPaths.inSetting("community", settingId)).data;
  const eventRows = useResource<{ id: number; title: string; inworld_year: number }[]>(`/settings/${settingId}/calendar-events`).data;
  const artifactRows = useResource<{ id: number; name: string; item_type: string | null }[]>(settingPaths.inSetting("artifact", settingId)).data;

  const locations = useMemo<PickOption[]>(
    () => rawLocations.map((l) => ({ id: l.id, name: l.name, hint: l.kind || undefined })),
    [rawLocations]
  );
  const beings = useMemo<PickOption[]>(
    () => (beingRows ?? []).map((b) => ({ id: b.id, name: b.name, hint: b.category === "bestiary" ? "бестиарий" : undefined })),
    [beingRows]
  );
  const communities = useMemo<PickOption[]>(() => (communityRows ?? []).map((c) => ({ id: c.id, name: c.name })), [communityRows]);
  const events = useMemo<PickOption[]>(
    () => (eventRows ?? []).map((e) => ({ id: e.id, name: e.title, hint: `${e.inworld_year} г.` })),
    [eventRows]
  );
  const artifacts = useMemo<PickOption[]>(
    () => (artifactRows ?? []).map((a) => ({ id: a.id, name: a.name, hint: a.item_type || undefined })),
    [artifactRows]
  );

  return { locations, rawLocations, beings, communities, events, artifacts };
}

export const RELATION_TONES = [
  { value: "positive", label: "хорошее" },
  { value: "neutral", label: "нейтральное" },
  { value: "negative", label: "плохое" },
  { value: "mixed", label: "смешанное" },
] as const;

export interface DraftRelation {
  to_type: "being" | "community";
  to_id: number;
  tone: string;
  label: string;
}

// Отношения создаваемой сущности к другим: направленные, как и в профиле
// (entity_relations), — «кто и что чувствует», а не просто «связаны».
export function RelationsField({
  beings,
  communities,
  relations,
  onChange,
}: {
  beings: PickOption[];
  communities: PickOption[];
  relations: DraftRelation[];
  onChange: (next: DraftRelation[]) => void;
}) {
  const targets = [
    ...beings.map((b) => ({ ...b, type: "being" as const })),
    ...communities.map((c) => ({ ...c, type: "community" as const })),
  ];

  function add() {
    const first = targets[0];
    if (!first) return;
    onChange([...relations, { to_type: first.type, to_id: first.id, tone: "neutral", label: "" }]);
  }

  function patch(index: number, values: Partial<DraftRelation>) {
    onChange(relations.map((r, i) => (i === index ? { ...r, ...values } : r)));
  }

  return (
    <div className="stack editable-card-field">
      <span>Отношения</span>
      {targets.length === 0 ? (
        <span className="muted">В сеттинге пока не с кем строить отношения.</span>
      ) : (
        <>
          {relations.map((r, i) => (
            <div key={i} className="row wizard-relation-row">
              <select
                value={`${r.to_type}:${r.to_id}`}
                onChange={(e) => {
                  const [type, id] = e.target.value.split(":");
                  patch(i, { to_type: type as DraftRelation["to_type"], to_id: Number(id) });
                }}
              >
                {targets.map((t) => (
                  <option key={`${t.type}:${t.id}`} value={`${t.type}:${t.id}`}>
                    {t.name}
                    {t.type === "community" ? " (сообщество)" : ""}
                  </option>
                ))}
              </select>
              <select value={r.tone} onChange={(e) => patch(i, { tone: e.target.value })}>
                {RELATION_TONES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
              <input
                placeholder="Например: покровитель, должник, кровная вражда"
                value={r.label}
                onChange={(e) => patch(i, { label: e.target.value })}
              />
              <button type="button" onClick={() => onChange(relations.filter((_, j) => j !== i))}>
                ✕
              </button>
            </div>
          ))}
          <button type="button" onClick={add} style={{ alignSelf: "flex-start" }}>
            + Добавить отношение
          </button>
        </>
      )}
    </div>
  );
}
