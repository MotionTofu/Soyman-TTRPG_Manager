import { MentionText } from "../mentions/MentionText";
import { OtherscapeText } from "./OtherscapeText";
import { OtherscapeSource } from "./OtherscapeSource";
import type { DevelopmentPresentation } from "./developmentPresentation";
import "./otherscape-power-sets.css";

function RuleHeading({ text }: { text: string }) {
  const [title, ...original] = text.split(" — ");
  return <h3>{title}{original.length > 0 && <> <span className="oc-section-original">[{original.join(" — ")}]</span></>}</h3>;
}

export function OtherscapeDevelopmentBody({ name, originalName, development }: {
  name: string;
  originalName: string;
  development: DevelopmentPresentation;
}) {
  return <article className="oc-dossier" aria-label={`${name} [${originalName}]`}>
    <header className="oc-dossier-header"><h2>{name} <span className="oc-original-name">[{originalName}]</span></h2></header>
    {development.variant === "essence" ? <div className="oc-mechanics oc-mechanics--with-limits oc-development-mechanic">
      <div className="oc-main-rules"><section>
        <h3>Особенность эссенции <span className="oc-section-original">[Essence Special]</span></h3>
        <OtherscapeText text={development.body} />
      </section></div>
      <aside className="oc-limits oc-essence-condition" aria-label="Состав тем">
        <div className="oc-limit-label">Состав тем</div><OtherscapeText text={development.condition} />
      </aside>
    </div> : development.variant === "veteran" ? <div className="oc-mechanics oc-development-mechanic"><OtherscapeText text={development.body} /></div>
      : <div className="oc-reference-text oc-development-rule oc-main-rules">{development.blocks.map((block, index) => <div className={`oc-rule-block${block.kind === "formula" ? " oc-rule-formula" : ""}`} key={index}>
        {block.kind === "heading" ? <RuleHeading text={block.text} /> : <>
          {block.kind === "formula" && <div className="oc-formula-label">Формула</div>}
          <OtherscapeText text={block.text} />
        </>}
      </div>)}</div>}
    {development.original && <details className="oc-original"><summary>Оригинал — Original</summary><div className="oc-original-text"><MentionText text={development.original} /></div></details>}
    {development.related && <div className="oc-related"><OtherscapeText text={development.related} /></div>}
    <OtherscapeSource source={development.source} pages={development.pages} />
  </article>;
}
