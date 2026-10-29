import { MentionText } from "../mentions/MentionText";
import { OtherscapeText } from "./OtherscapeText";
import { OtherscapeSource } from "./OtherscapeSource";
import type { EquipmentPresentation, EquipmentTag } from "./equipmentPresentation";
import "./otherscape-power-sets.css";

function TagList({ tags }: { tags: EquipmentTag[] }) {
  return <ul className="oc-loadout-tags">{tags.map((tag, index) => <li key={index}>
    <div className="oc-gear-tag-title"><strong>{tag.translation}</strong>{tag.primary && <span className="oc-tag-primary">Основной тег</span>}</div>
    <div className="oc-gear-tag"><OtherscapeText text={tag.original} /></div>
  </li>)}</ul>;
}

export function OtherscapeEquipmentBody({ name, originalName, equipment }: {
  name: string;
  originalName: string;
  equipment: EquipmentPresentation;
}) {
  return <article className="oc-dossier" aria-label={`${name} [${originalName}]`}>
    <header className="oc-dossier-header"><h2>{name} <span className="oc-original-name">[{originalName}]</span></h2></header>
    {equipment.description && <blockquote className="oc-flavor"><span aria-hidden="true">“</span><OtherscapeText text={equipment.description} /></blockquote>}
    {equipment.variant === "item" ? <>
      <div className="oc-mechanics oc-mechanics--with-limits">
        <div className="oc-main-rules"><section>
          <h3>Теги снаряжения <span className="oc-section-original">[Loadout Tags]</span></h3>
          {equipment.tags ? <TagList tags={equipment.tags} /> : <OtherscapeText text={equipment.tagText} />}
        </section></div>
        <aside className="oc-limits oc-equipment-weakness" aria-label="Слабость — Weakness">
          <div className="oc-limit-label">Слабость [Weakness]</div>
          {equipment.weakness ? <>
            <div className="oc-weakness-translation"><OtherscapeText text={equipment.weakness.translation} /></div>
            <div className="oc-gear-tag"><OtherscapeText text={equipment.weakness.original} /></div>
          </> : <OtherscapeText text={equipment.weaknessText} />}
        </aside>
      </div>
      {equipment.body && <div className="oc-equipment-notes"><OtherscapeText text={equipment.body} /></div>}
    </> : equipment.variant === "generic" ? <div className="oc-main-rules oc-generic-sections">
      {equipment.sections.map((section, index) => <section key={index}>
        <h3>{section.title} <span className="oc-section-original">[{section.originalTitle}]</span></h3>
        {section.tags ? <><TagList tags={section.tags} />{section.after && <div className="oc-equipment-notes"><OtherscapeText text={section.after} /></div>}</> : <OtherscapeText text={section.text} />}
      </section>)}
    </div> : <div className={equipment.variant === "special" ? "oc-mechanics oc-equipment-special" : "oc-reference-text"}><OtherscapeText text={equipment.body} /></div>}
    {equipment.original && <details className="oc-original"><summary>Оригинал — Original</summary><div className="oc-original-text"><MentionText text={equipment.original} /></div></details>}
    <OtherscapeSource source={equipment.source} pages={equipment.pages} />
  </article>;
}
