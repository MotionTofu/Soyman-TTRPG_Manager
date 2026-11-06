import { Fragment, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import type { CompendiumEntry } from "../../types";
import { extractEnglishName } from "../../compendium";
import { stripMentions } from "../../mentions";
import { CompendiumArticle, CompendiumRefs } from "../CompendiumArticle";
import { entryValue } from "../compendiumArticleData";
import { EntityPreviewModal } from "../EntityPreviewModal";
import { MentionText } from "../mentions/MentionText";
import { CardPicture } from "../dnd/DndCards";
import { ASI_NAMES } from "../dnd/DndLevelUpWizard";
import { columnRecharge, progressionRowForLevel } from "../dnd/progression";
import type { DndEffect } from "../dnd/effects";
import { ProfileBlock } from "./ProfileParts";
import { profileNames, profileProgression, profileRefs, type Ref } from "./dndProfileData";

export function ProfileFacts({ facts }: { facts: { label: string; value: string }[] }) {
  return <dl className="dnd-facts">{facts.filter((fact) => fact.value).map((fact) => <div key={fact.label}><dt>{fact.label}</dt><dd>{fact.value}</dd></div>)}</dl>;
}
export function ProfileField({ label, children }: { label: string; children: ReactNode }) {
  return <div><dt>{label}</dt><dd>{children}</dd></div>;
}
const feet = (ref: Ref) => ref.distance ? `${ref.distance} фт.` : "";

export function DndBasics({ entry, features, onEdit }: { entry: CompendiumEntry; features: CompendiumEntry[]; onEdit: () => void }) {
  const str = (key: string) => entryValue(entry, key);
  const species = entry.kind === "species";
  const armor = profileRefs(entry.data.armor_profs), weapons = profileRefs(entry.data.weapon_profs);
  const skills = profileNames(entry.data.skill_choice_options);
  const skillCount = Array.isArray(entry.data.skill_choice_options) ? entry.data.skill_choice_options.length : 0;
  const multiclass = entry.data.multiclass_profs as Record<string, unknown> | undefined;
  const multiclassRefs = multiclass ? Object.values(multiclass).flatMap(profileRefs) : [];
  const senses = [...profileRefs(entry.data.senses), ...features.flatMap((feature) => profileRefs(feature.data.senses))];
  const uniqueSenses = [...new Map(senses.map((sense) => [sense.id, sense])).values()];
  const speeds = profileRefs(entry.data.speeds);
  const darkvision = uniqueSenses.find((sense) => /тёмное зрение|темное зрение/i.test(sense.name));
  const resistance = features.flatMap((feature) => ((feature.data.effects as DndEffect[] | undefined) ?? [])
    .filter((effect) => effect.type === "resistance").flatMap((effect) => profileRefs(effect.damageType)));
  const uniqueResistance = [...new Map(resistance.map((ref) => [ref.id, ref])).values()];
  const creatureType = profileRefs(entry.data.creature_type);
  const facts = species ? [
    { label: "Размер", value: str("size") },
    ...speeds.map((speed) => ({ label: speed.name === "Ходьба" ? "Скорость" : speed.name, value: feet(speed) })),
    { label: "Тёмное зрение", value: darkvision ? feet(darkvision) : "" },
  ] : [
    { label: "Кость хитов", value: str("hit_die") },
    { label: "Основные", value: profileNames(entry.data.primary_abilities) },
    { label: "Спасброски", value: profileNames(entry.data.saving_throws) },
    { label: "Подкласс", value: str("subclass_level") ? `${str("subclass_level")} ур.` : "" },
  ];
  return <ProfileBlock title="Основы" focal actions={<button type="button" className="d-btn d-btn--sm" onClick={onEdit}>Править</button>}>
    <ProfileFacts facts={facts} />
    {!facts.some((fact) => fact.value) && !armor.length && !weapons.length && !skills && !str("multiclass_prereq") && !multiclassRefs.length && !creatureType.length && !uniqueResistance.length && !uniqueSenses.length && <p className="muted">Добавьте основные сведения в запись.</p>}
    <dl className="dnd-profile-fields">
      {armor.length > 0 && <ProfileField label="Доспехи"><CompendiumRefs refs={armor} /></ProfileField>}
      {weapons.length > 0 && <ProfileField label="Оружие"><CompendiumRefs refs={weapons} /></ProfileField>}
      {skills && <ProfileField label={`Навыки · ${str("skill_choice_count") || "—"} из ${skillCount}`}>{skills}</ProfileField>}
      {(str("multiclass_prereq") || multiclassRefs.length > 0) && <ProfileField label="Мультикласс"><MentionText text={str("multiclass_prereq")} />{multiclassRefs.length > 0 && <> · <CompendiumRefs refs={multiclassRefs} /></>}</ProfileField>}
      {creatureType.length > 0 && <ProfileField label="Тип существа"><CompendiumRefs refs={creatureType} /></ProfileField>}
      {uniqueResistance.length > 0 && <ProfileField label="Сопротивления"><CompendiumRefs refs={uniqueResistance} /></ProfileField>}
      {uniqueSenses.length > 0 && <ProfileField label="Чувства"><CompendiumRefs refs={uniqueSenses.map((sense) => ({ ...sense, distance: feet(sense) }))} /></ProfileField>}
    </dl>
  </ProfileBlock>;
}

export function DndFeatures({ entry, features, onEdit, onAdd, onProgression }: {
  entry: CompendiumEntry; features: CompendiumEntry[]; onEdit: (feature: CompendiumEntry) => void;
  onAdd: () => void; onProgression?: () => void;
}) {
  const [opened, setOpened] = useState<number | null>(null);
  const species = entry.kind === "species";
  const groups = new Map<number, CompendiumEntry[]>();
  for (const feature of features) {
    const level = species ? 0 : feature.level ?? 0;
    if (!groups.has(level)) groups.set(level, []);
    groups.get(level)!.push(feature);
  }
  const article = (feature: CompendiumEntry) => <CompendiumArticle entry={feature} parentName={`${entry.name}${feature.level != null && !species ? ` · ${feature.level} уровень` : ""}`} typeLabel={species ? "Черта вида" : "Умение класса"} onEdit={() => onEdit(feature)} onCollapse={() => setOpened(null)} />;
  return <ProfileBlock title={species ? "Черты вида" : "Умения по уровням"} count={features.length} actions={<>
    {onProgression && <button type="button" className="d-btn d-btn--sm d-btn--ghost dnd-features__progression" onClick={onProgression}>Таблица развития ›</button>}
    <button type="button" className="d-btn d-btn--sm" onClick={onAdd}>{species ? "+ Черта" : "+ Умение"}</button>
  </>}>
    {!features.length && <p className="muted">{species ? "Добавьте черты вида." : "Добавьте умения класса."}</p>}
    {[...groups].sort(([a], [b]) => a - b).map(([level, list]) => species ? list.map((feature) => <div className="dnd-feature-row" key={feature.id}>
      <button type="button" aria-expanded={opened === feature.id} onClick={() => setOpened(opened === feature.id ? null : feature.id)}><strong>{feature.name}</strong><span>{stripMentions(feature.description).split("\n")[0]}</span><small>{opened === feature.id ? "▴" : "▾"}</small></button>
      {opened === feature.id && article(feature)}
    </div>) : <div className="dnd-level-row" key={level}>
      <div className="dnd-level-row__head"><span>{level ? `${level} ур.` : "—"}</span>{list.map((feature) => <button type="button" key={feature.id} aria-expanded={opened === feature.id} onClick={() => setOpened(opened === feature.id ? null : feature.id)}>{feature.name}</button>)}</div>
      {list.filter((feature) => feature.id === opened).map((feature) => <Fragment key={feature.id}>{article(feature)}</Fragment>)}
    </div>)}
  </ProfileBlock>;
}

export function DndSubclassCards({ entries, large = false }: { entries: CompendiumEntry[]; large?: boolean }) {
  return <div className={`dnd-subclass-cards${large ? " dnd-subclass-cards--large" : ""}`}>{entries.map((entry) => <Link key={entry.id} to={`/systems/${entry.system_id}/entries/${entry.id}`}><CardPicture id={entry.id} name={entry.name} card={entry.avatar_image_url ?? null} thumb={320} /><span>{entry.name}</span></Link>)}</div>;
}

export function DndDescription({ entry, onEdit }: { entry: CompendiumEntry; onEdit: () => void }) {
  const [full, setFull] = useState(false);
  const paragraphs = entry.description.split(/\n\s*\n/);
  return <ProfileBlock title="Описание" actions={<>
    {paragraphs.length > 2 && <button type="button" className="d-btn d-btn--sm d-btn--ghost" onClick={() => setFull(!full)}>{full ? "Свернуть" : "Развернуть"}</button>}
    <button type="button" className="d-btn d-btn--sm d-btn--ghost" onClick={onEdit}>Править</button>
  </>}><div className="profile-prose"><MentionText text={full ? entry.description : paragraphs.slice(0, 2).join("\n\n")} /></div></ProfileBlock>;
}

export function DndEquipment({ entry, onEdit }: { entry: CompendiumEntry; onEdit: () => void }) {
  const variants = [["А", entryValue(entry, "equipment_a")], ["Б", entryValue(entry, "equipment_b")], ["В", entryValue(entry, "equipment_c_gold") ? `${entryValue(entry, "equipment_c_gold")} зм` : ""]].filter(([, value]) => value);
  if (!variants.length) return null;
  return <ProfileBlock title="Начальное снаряжение" actions={<button type="button" className="d-btn d-btn--sm d-btn--ghost" onClick={onEdit}>Править</button>}>
    {variants.map(([label, value]) => <div className="dnd-equipment-variant" key={label}><strong>{label}</strong> <MentionText text={value} /></div>)}
  </ProfileBlock>;
}

export function DndReference({ entry, onEdit }: { entry: CompendiumEntry; onEdit: () => void }) {
  const standard = entry.data.standard_array as Record<string, unknown> | undefined;
  const abilities: Record<string, string> = { str: "СИЛ", dex: "ЛОВ", con: "ТЕЛ", int: "ИНТ", wis: "МДР", cha: "ХАР" };
  return <details className="paper-fold"><summary>Справка {entry.name_original && <span className="d-note">· {entry.name_original}</span>}</summary><div className="paper-fold__body">
    <dl className="dnd-profile-fields">
      {entryValue(entry, "source") && <ProfileField label="Источник">{entryValue(entry, "source")}</ProfileField>}
      {entry.name_original && <ProfileField label="Исходное название">{entry.name_original}</ProfileField>}
      {standard && <ProfileField label="Стандартный набор">{Object.entries(standard).filter(([, value]) => typeof value === "number").map(([key, value]) => `${abilities[key] ?? key} ${value}`).join(" · ")}</ProfileField>}
    </dl><button type="button" className="d-btn d-btn--sm" onClick={onEdit}>Править</button>
  </div></details>;
}

const norm = (text: string) => {
  const value = extractEnglishName(text).name.trim().toLocaleLowerCase("ru").replace(/ё/g, "е").replace(/\s*\([^)]*\)\s*$/, "");
  return ASI_NAMES.some((name) => name.toLocaleLowerCase("ru") === value) ? "asi" : value;
};
export function DndProfileProgression({ entry, features, subclasses, onEdit, onEditFeature }: { entry: CompendiumEntry; features: CompendiumEntry[]; subclasses: CompendiumEntry[]; onEdit: () => void; onEditFeature: (feature: CompendiumEntry) => void }) {
  const [subId, setSubId] = useState("");
  const [preview, setPreview] = useState<CompendiumEntry | null>(null);
  const base = profileProgression(entry);
  const eligible = subclasses.filter((subclass) => profileProgression(subclass));
  const subclass = eligible.find((candidate) => String(candidate.id) === subId);
  const extra = subclass ? profileProgression(subclass) : null;
  const columns = [...(base?.columns ?? []), ...(extra?.columns.filter((column) => column.role !== "level").map((column) => ({ ...column, key: `sub:${column.key}`, label: `${subclass!.name} · ${column.label}` })) ?? [])];
  const byName = new Map(features.map((feature) => [norm(feature.name), feature]));
  function featureCell(text: string) {
    return text.split(/,\s*/).filter(Boolean).map((name, i) => {
      const feature = byName.get(norm(name));
      return <Fragment key={i}>{i > 0 && " · "}{feature ? <button type="button" className="dnd-progression__ability" onClick={() => setPreview(feature)}>{name}</button> : name}</Fragment>;
    });
  }
  return <>
    <ProfileBlock title="Таблица развития" count={base?.rows.length} actions={<>
      {eligible.length > 0 && <select className="d-select" aria-label="Столбцы подкласса" value={subId} onChange={(event) => setSubId(event.target.value)}><option value="">Класс</option>{eligible.map((candidate) => <option key={candidate.id} value={candidate.id}>+ {candidate.name}</option>)}</select>}
      <button type="button" className="d-btn d-btn--sm" onClick={onEdit}>Править таблицу</button>
    </>}>
      {!base ? <p className="muted">Таблица развития пока не записана.</p> : <div className="dnd-progression-scroll"><table className="dnd-progression"><thead><tr>{columns.map((column) => <th scope="col" key={column.key}>{column.label}{column.role === "resource" && <small>↻ {columnRecharge(column) === "short" ? "короткий" : columnRecharge(column) === "long" ? "долгий" : "без отдыха"}</small>}</th>)}</tr></thead><tbody>
        {base.rows.map((row, ri) => {
          const level = Number(row[base.columns.find((column) => column.role === "level")?.key ?? ""]) || ri + 1;
          const subRow = extra ? progressionRowForLevel(extra, level) : null;
          const isSubclassLevel = base.columns.some((column) => column.role === "features" && /подкласс/i.test(row[column.key] ?? "")) || String(level) === entryValue(entry, "subclass_level");
          return <tr key={ri} className={isSubclassLevel ? "is-subclass-level" : ""}>{columns.map((column) => {
            const value = column.key.startsWith("sub:") ? subRow?.[column.key.slice(4)] ?? "—" : row[column.key] ?? "";
            return <td key={column.key}>{column.role === "features" ? featureCell(value) : value}</td>;
          })}</tr>;
        })}
      </tbody></table></div>}
    </ProfileBlock>
    {preview && <EntityPreviewModal type="compendium_entry" id={preview.id} onClose={() => setPreview(null)}><CompendiumArticle entry={preview} parentName={entry.name} typeLabel="Умение класса" onEdit={() => onEditFeature(preview)} /></EntityPreviewModal>}
  </>;
}
