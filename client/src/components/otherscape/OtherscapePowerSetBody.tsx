import { MentionText } from "../mentions/MentionText";
import { OtherscapeSource } from "./OtherscapeSource";
import { OtherscapeText } from "./OtherscapeText";
import { displayLimitName, type PowerSetPresentation } from "./powerSetPresentation";
import "./otherscape-power-sets.css";

export function OtherscapePowerSetBody({ name, originalName, powerSet }: {
  name: string;
  originalName: string;
  powerSet: PowerSetPresentation;
}) {
  const main = powerSet.sections.filter(section => !["Limits", "Threats", "Consequences"].includes(section.key));
  return <article className="oc-dossier" aria-label={`${name} [${originalName}]`}>
    <header className="oc-dossier-header">
      <h2>{name} <span className="oc-original-name">[{originalName}]</span></h2>
      <div className="oc-difficulty"><strong>+{powerSet.bonus}</strong><span>К сложности</span></div>
    </header>
    {powerSet.description && <blockquote className="oc-flavor"><span aria-hidden="true">“</span><OtherscapeText text={powerSet.description} /></blockquote>}
    {powerSet.introduction && <div className="oc-introduction"><OtherscapeText text={powerSet.introduction} /></div>}
    <div className={`oc-mechanics${powerSet.limits ? " oc-mechanics--with-limits" : ""}`}>
      <div className="oc-main-rules">
        {main.map((section, index) => <section key={index}>
          {section.key === "Specials" && powerSet.specials ? powerSet.specials.map((special, n) => <section className="oc-special" key={n}>
            <h3>{special.title}</h3><OtherscapeText text={special.text} />
          </section>) : <><h3>{section.key === "Tags & Statuses" ? "Базовые теги и статусы" : section.title}</h3><OtherscapeText text={section.text} /></>}
        </section>)}
      </div>
      {powerSet.limits && <aside className="oc-limits" aria-label={powerSet.limits.label}>
        <div className="oc-limit-label">{powerSet.limits.label}</div>
        {powerSet.limits.values.map((limit, index) => <div className="oc-limit-value" key={index}>
          <strong>{displayLimitName(limit.name)}</strong><span>{limit.value}</span>
        </div>)}
        <OtherscapeText text={powerSet.limits.text} />
      </aside>}
    </div>
    {powerSet.sections.filter(section => ["Threats", "Consequences"].includes(section.key)).map((section, index) => <section className="oc-consequences" key={index}>
      <h3>{section.key === "Consequences" ? "Возможные последствия" : "Угрозы — Threats"}</h3><OtherscapeText text={section.text} />
    </section>)}
    {powerSet.original && <details className="oc-original"><summary>Оригинал — Original</summary><div className="oc-original-text"><MentionText text={powerSet.original} /></div></details>}
    {powerSet.related && <div className="oc-related"><MentionText text={powerSet.related} /></div>}
    <OtherscapeSource source={powerSet.source} pages={powerSet.pages} />
  </article>;
}
