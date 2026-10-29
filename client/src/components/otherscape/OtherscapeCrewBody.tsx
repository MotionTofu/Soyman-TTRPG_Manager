import { MentionText } from "../mentions/MentionText";
import { OtherscapeText } from "./OtherscapeText";
import { OtherscapeSource } from "./OtherscapeSource";
import type { CrewPairList, CrewPresentation } from "./crewPresentation";
import "./otherscape-power-sets.css";

function Pairs({ list, tags = false }: { list: CrewPairList; tags?: boolean }) {
  return <>
    {list.before && <div className="oc-crew-list-before"><OtherscapeText text={list.before} /></div>}
    <ul className={tags ? "oc-loadout-tags" : "oc-crew-pairs"}>{list.pairs.map((pair, index) => <li key={index}>
      <div className="oc-gear-tag-title"><strong>{pair.translation}</strong>{pair.primary && <span className="oc-tag-primary">Титульный тег</span>}</div>
      <div className={tags ? "oc-gear-tag" : "oc-crew-pair-original"}><OtherscapeText text={pair.original} /></div>
    </li>)}</ul>
    {list.after && <div className="oc-crew-list-after"><OtherscapeText text={list.after} /></div>}
  </>;
}

function Heading({ text }: { text: string }) {
  const [title, ...original] = text.split(" — ");
  return <h3>{title}{original.length > 0 && <> <span className="oc-section-original">[{original.join(" — ")}]</span></>}</h3>;
}

export function OtherscapeCrewBody({ name, originalName, crew }: {
  name: string;
  originalName: string;
  crew: CrewPresentation;
}) {
  return <article className="oc-dossier" aria-label={`${name} [${originalName}]`}>
    <header className="oc-dossier-header"><h2>{name} <span className="oc-original-name">[{originalName}]</span></h2></header>
    {crew.variant === "kit" && crew.power && crew.weakness && crew.motivation ? <>
      <div className="oc-crew-instructions"><OtherscapeText text={crew.instructions} /></div>
      <blockquote className="oc-flavor oc-crew-motivation"><span aria-hidden="true">“</span><div>
        <div className="oc-formula-label">Мотивация [{crew.motivation.kind}]</div>
        <OtherscapeText text={crew.motivation.text} />
        <div className="oc-crew-pair-original"><OtherscapeText text={crew.motivation.original} /></div>
      </div></blockquote>
      <div className="oc-mechanics oc-mechanics--with-limits">
        <div className="oc-main-rules"><section aria-label="Теги силы">
          <h3>Теги силы <span className="oc-section-original">[Power Tags]</span></h3><Pairs list={crew.power} tags />
        </section></div>
        <aside className="oc-limits oc-crew-weakness" aria-label="Теги слабости">
          <h3 className="oc-limit-label">Теги слабости [Weakness Tags]</h3><Pairs list={crew.weakness} tags />
        </aside>
      </div>
      {crew.motivation.after && <div className="oc-related"><OtherscapeText text={crew.motivation.after} /></div>}
    </> : crew.variant === "special" ? <div className="oc-mechanics oc-crew-special"><OtherscapeText text={crew.body} /></div>
      : <div className="oc-reference-text oc-crew-reference oc-main-rules">{crew.sections.map((section, index) => <section key={index}>
        {section.heading && <Heading text={section.heading} />}
        {section.list ? <Pairs list={section.list} /> : <OtherscapeText text={section.text} />}
      </section>)}</div>}
    {crew.original && <details className="oc-original"><summary>Оригинал — Original</summary><div className="oc-original-text"><MentionText text={crew.original} /></div></details>}
    <OtherscapeSource source={crew.source} pages={crew.pages} />
  </article>;
}
