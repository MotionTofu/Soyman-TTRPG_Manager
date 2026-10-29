import { MentionText } from "../mentions/MentionText";
import { OtherscapeText } from "./OtherscapeText";
import { OtherscapeSource } from "./OtherscapeSource";
import type { ArchetypeKitList, ArchetypePresentation } from "./archetypePresentation";
import "./otherscape-power-sets.css";

function Kits({ list }: { list: ArchetypeKitList }) {
  return <>
    <ul className="oc-archetype-kits">{list.kits.map((kit, index) => <li key={index}>
      <strong><MentionText text={kit.link} /></strong>
      <div className="oc-archetype-kit-meta"><span>{kit.theme}</span><MentionText text={kit.page} /></div>
    </li>)}</ul>
    {list.after && <div className="oc-archetype-note"><OtherscapeText text={list.after} /></div>}
  </>;
}

export function OtherscapeArchetypeBody({ name, originalName, archetype }: {
  name: string;
  originalName: string;
  archetype: ArchetypePresentation;
}) {
  const profile = archetype.profile;
  return <article className="oc-dossier" aria-label={`${name} [${originalName}]`}>
    <header className="oc-dossier-header"><h2>{name} <span className="oc-original-name">[{originalName}]</span></h2></header>
    {profile ? <>
      <blockquote className="oc-flavor"><span aria-hidden="true">“</span><OtherscapeText text={profile.concept} /></blockquote>
      <div className="oc-mechanics oc-archetype-themes oc-main-rules">
        <section aria-label="Три основных набора"><h3>Три основных набора <span className="oc-section-original">[Base Theme Kits]</span></h3><Kits list={profile.base} /></section>
        <section aria-label="Четвёртый набор: выберите один"><h3>Четвёртый набор: выберите один <span className="oc-section-original">[Choose One]</span></h3><Kits list={profile.choice} /></section>
      </div>
      <section className="oc-archetype-loadout oc-main-rules" aria-label="Начальное снаряжение">
        <h3>Начальное снаряжение <span className="oc-section-original">[Loadout]</span></h3>
        <OtherscapeText text={profile.loadout.translation} />
        <details className="oc-original"><summary>Оригинал — Loadout</summary><div className="oc-original-text"><MentionText text={profile.loadout.original} /></div></details>
        <div className="oc-archetype-note"><OtherscapeText text={profile.loadout.notes} /></div>
      </section>
      <section className="oc-rule-formula oc-archetype-creation" aria-label="Создание тем">
        <h3 className="oc-formula-label">Создание тем [Rapid Creation]</h3><OtherscapeText text={profile.creation} />
      </section>
    </> : <div className="oc-reference-text oc-archetype-loadout"><OtherscapeText text={archetype.body} /></div>}
    <OtherscapeSource source={archetype.source} pages={archetype.pages} />
  </article>;
}
